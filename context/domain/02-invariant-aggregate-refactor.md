---
title: FlowFit — WorkoutSession Status-Transition Guard - Invariant/Aggregate Refactor Plan
created: 2026-08-02
type: refactor-plan
---

# WorkoutSession Status-Transition Guard — Refactor Plan

## KROK 0 — Kontekst

Priory przeczytane: `context/foundation/prd.md`, `context/foundation/roadmap.md`, `context/foundation/lessons.md`,
i w szczególności `context/domain/01-domain-distillation.md` — istniejąca dystrybucja domeny FlowFit, której
KROK 3 (§3, `WorkoutSession`) i KROK 5 (ranking, pozycja #1) już zidentyfikowały ten sam niezmiennik jako
najpilniejszy do naprawy. Ten dokument NIE wyprowadza tamtych ustaleń na nowo — buduje na nich i idzie o krok
dalej w diagnozie (patrz sekcja "Odkrycie wykraczające poza `01-domain-distillation.md`" w KROK 3), bo
weryfikacja w kodzie ujawniła, że mechanizm ochronny, który reszta bazy kodu już stosuje gdzie indziej
(RPC + kontrola w transakcji), sam w sobie NIE zamyka drogi obejścia w tym miejscu.

Stack: Astro 6 SSR (API routes `src/pages/api/`) + Supabase Postgres (RLS, RPC-e `SECURITY INVOKER`) +
warstwa serwisowa `src/lib/services/*.ts` jako jedyny most między route'ami a Supabase. Logika biznesowa żyje
w trzech miejscach jednocześnie: Zod (`src/lib/validation/session.ts` — tylko kształt payloadu), route
handlery (`src/pages/api/sessions/[sessionId]/*.ts` — jedyne miejsce, gdzie dziś sprawdzany jest status sesji),
i Postgres (RLS + `CHECK` + RPC — gdzie status sesji nie jest sprawdzany wcale dla ścieżek `complete`/`sets`).

## KROK 1 — Zidentyfikowane niezmienniki (z priorów + weryfikacja w kodzie)

Pełna lista żyje w `01-domain-distillation.md` KROK 3 (4 niezmienniki dla `WorkoutSession`). Potwierdzone
ponownie w tej sesji, bo są bezpośrednio istotne dla wyboru:

1. Co najwyżej jedna **aktywna** sesja na (user, workout) — `supabase/migrations/20260612000000_active_session_uniqueness.sql:3-5` (partial unique index). **Silnie egzekwowany, twardy constraint DB — poza zakresem tego refaktoru.**
2. Każdy `workout_set` ustawia dokładnie jedno z `reps`/`duration_seconds` — DB `CHECK workout_sets_tracking_xor` `supabase/migrations/20260724110000_workout_session_logging_support.sql:12-16` + Zod `src/lib/validation/session.ts:4-26`. **Silnie egzekwowany — poza zakresem.**
3. `(workout_session_id, exercise_id, set_number)` unikalne — DB `UNIQUE` `supabase/migrations/20260529000000_core_schema.sql:153`. **Silnie egzekwowany — poza zakresem.**
4. **Tylko aktywna sesja przyjmuje logowanie setów, completion i restart.** Źródło: prd.md US-02 (logowanie odbywa się "podczas" aktywnej sesji, treść implikowana, nie explicit). Kod: sprawdzenie `session.status !== "active"` istnieje wyłącznie w trzech route handlerach — `src/pages/api/sessions/[sessionId]/complete.ts:37-39`, `restart.ts:43-45`, `sets.ts:56-58,132-134`. **To jest przedmiot tego refaktoru.**

## KROK 2 — Klasyfikacja i wybór #1

| Niezmiennik                               | (a) Rdzeniowość                                                                                                                                 | (b) Rozproszenie                                     | (c) Egzekucja                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jedna aktywna sesja/workout               | Wysoka (chroni Resume/Start-Over UX)                                                                                                            | 1 warstwa (DB constraint)                            | Silna — twardy `UNIQUE INDEX`                                                                                                                           |
| XOR reps/duration na secie                | Średnia                                                                                                                                         | 2 warstwy (DB CHECK + Zod)                           | Silna — podwójnie egzekwowana                                                                                                                           |
| Unikalność (session,exercise,set)         | Średnia                                                                                                                                         | 1 warstwa (DB UNIQUE)                                | Silna                                                                                                                                                   |
| **Tylko aktywna sesja przyjmuje mutacje** | **Najwyższa — chroni roadmap.md:24 "north star" flow: integralność logowania setów jest sednem produktu (prd.md US-02, Success Criteria #4-5)** | **Rozproszony na 3 route handlery, zero warstwy DB** | **Najsłabsza — patrz KROK 3: nie tylko "app-layer only", tabele mają wprost otwarte GRANTy, więc nawet ta app-layer kontrola jest trywialnie omijalna** |

**Wybór: #4 — status-transition guard sesji treningowej.** Jest jednocześnie najbardziej rdzeniowy (to
dosłownie ten sam przepływ, który roadmap nazywa "north star" i który Success Criteria PRD stawiają jako
kroki 4-5 głównej ścieżki) i najsłabiej egzekwowany ze wszystkich czterech — nie tylko rozproszony (trzy
kopiowane sprawdzenia `if (status !== "active")`), ale **realnie obchodzony** przez dowolnego uwierzytelnionego
klienta bez dotykania Astro w ogóle. To dokładnie potwierdza i pogłębia ranking #1 z `01-domain-distillation.md`
KROK 5.

## KROK 3 — Diagnoza

### Gdzie reguła żyje dziś, warstwa po warstwie

| Warstwa               | Plik:linia                                                                                                                                | Co robi                                                                                                                           | Luka                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zod                   | `src/lib/validation/session.ts:4-26`                                                                                                      | Waliduje tylko _kształt_ payloadu (`buildSetLogSchema`)                                                                           | Nie zna pojęcia statusu sesji w ogóle                                                                                                                                                                                |
| Route (complete)      | `src/pages/api/sessions/[sessionId]/complete.ts:37-39`                                                                                    | `if (session.status !== "active") return 409`                                                                                     | TOCTOU — status odczytany, potem osobne wywołanie `completeSession` bez ponownej weryfikacji                                                                                                                         |
| Route (sets PUT/POST) | `src/pages/api/sessions/[sessionId]/sets.ts:56-58`                                                                                        | Ta sama kontrola przed `upsertSet`                                                                                                | Ta sama luka                                                                                                                                                                                                         |
| Route (sets DELETE)   | `src/pages/api/sessions/[sessionId]/sets.ts:132-134`                                                                                      | Ta sama kontrola przed `deleteSet`                                                                                                | Ta sama luka                                                                                                                                                                                                         |
| Route (restart)       | `src/pages/api/sessions/[sessionId]/restart.ts:43-45`                                                                                     | Ta sama kontrola przed `restartSession`                                                                                           | **Częściowo złagodzona** — RPC `restart_workout_session` re-weryfikuje status w swojej transakcji (`supabase/migrations/20260724130000_restart_workout_session_race_fix.sql:37-39`)                                  |
| Service               | `src/lib/services/session.ts:296-315` (`completeSession`), `258-276` (`upsertSet`), `278-294` (`deleteSet`)                               | Surowe `.from("workout_sessions").update(...)` / `.from("workout_sets").upsert()/.delete()`                                       | Zero re-weryfikacji statusu — ufa wyłącznie temu, co sprawdził route                                                                                                                                                 |
| DB — RLS              | `supabase/migrations/20260529000000_core_schema.sql:248-249` (`workout_sessions_update`), `258-266` (`workout_sets_insert/update/delete`) | `USING (auth.uid() = user_id)` / `... = (SELECT user_id FROM workout_sessions ...)`                                               | **Sprawdza wyłącznie własność, nigdy status**                                                                                                                                                                        |
| DB — GRANT            | `supabase/migrations/20260716120000_grant_table_privileges_to_authenticated.sql:16`                                                       | `GRANT SELECT, INSERT, UPDATE, DELETE ON workouts, workout_exercises, user_plan, workout_sessions, workout_sets TO authenticated` | **To jest sedno luki: `authenticated` ma wprost nadane UPDATE/DELETE na `workout_sessions`/`workout_sets`, więc RLS + ten GRANT razem tworzą pełnoprawną, legalną ścieżkę zapisu z pominięciem wszystkiego powyżej** |

### Dowód empiryczny, że luka jest realna (nie teoretyczna)

`tests/integration/session-ownership-rls.test.ts:86-95` — istniejący test integracyjny — woła
`completeSession(userA.client, userA.sessionId)` bezpośrednio (dokładnie to, co zrobiłby klient
wywołujący PostgREST wprost, z pominięciem route'a) i **oczekuje sukcesu**, bez żadnego wcześniejszego
testu negatywnego "already completed → reject". To empirycznie potwierdza: usunięcie route'a z równania
nie napotyka żadnej przeszkody między klientem a mutacją statusu.

### Odkrycie wykraczające poza `01-domain-distillation.md`

`01-domain-distillation.md` KROK 3 §3 nazywa lukę "Weakly enforced — checked only at the Astro API route
layer... No DB-level guard exists". To poprawne, ale niepełne w świetle istniejącego w tym repo precedensu
naprawy: `reset_user_profile` miał identyczny kształt błędu i został naprawiony przenosząc sprawdzenie do
wnętrza transakcji RPC (`supabase/migrations/20260723000000_reset_rpc_hardening.sql:6-14`, komentarz
migracji). Weryfikacja pokazuje jednak, że **ta sama "naprawiona" ścieżka nadal ma otwartą lukę tej samej
klasy**: `reset_user_profile` jest `SECURITY INVOKER` (`...reset_rpc_hardening.sql:52`), a `authenticated`
ma wprost `GRANT DELETE ON user_profiles` (`supabase/migrations/20260717000000_add_user_profiles_delete_policy.sql:13`).
Ponieważ funkcja jest INVOKER (nie DEFINER), jej wewnętrzne `DELETE FROM user_profiles` działa tylko dlatego,
że wołający ma do tego prawo wprost na tabeli — a to znaczy, że **ten sam wołający może pominąć RPC i wywołać
`DELETE /rest/v1/user_profiles?id=eq.<self>` bezpośrednio przez PostgREST**, omijając kontrolę
"`active_workout_session`" całkowicie. Migracja z 2026-07-23 zamknęła wyścig z `save_generated_training_plan`
i wyścig "route → RPC", ale nie rozważyła "RPC → surowa tabela", bo nigdy nie wykonano `REVOKE` na
gruncie tabeli. To ten sam wzorzec luki, który wybrałem jako #1 (KROK 2), i pokazuje, że jest **systemowy**,
nie odosobniony — co wzmacnia uzasadnienie wyboru i bezpośrednio kształtuje projekt w KROK 4 (agregat
musi zamykać obie strony, nie tylko dodać RPC z kontrolą).

Wniosek: kopiowanie istniejącego wzorca (`SECURITY INVOKER` RPC + kontrola w transakcji, bez `REVOKE`)
naprawiłoby TOCTOU, ale **nie zamknęłoby realnej ścieżki obejścia**. Projekt w KROK 4 świadomie odchodzi
od tego wzorca na rzecz `SECURITY DEFINER` + `REVOKE` na tabeli bazowej.

## KROK 4 — Projekt agregatu-strażnika

### Granica agregatu

**`WorkoutSession`** (root) + `WorkoutSet` (encje-dzieci, żyjące i umierające wewnątrz sesji). Jedyny
punkt egzekwowania: trzy funkcje Postgres `SECURITY DEFINER`, którym towarzyszy `REVOKE` bezpośrednich
uprawnień na tabelach bazowych z roli `authenticated`. `SECURITY DEFINER` jest tu świadomym odejściem od
istniejącego stylu `SECURITY INVOKER` w tym repo (patrz KROK 3, "Odkrycie...") — jest wymagany, bo dopiero
funkcja działająca z uprawnieniami właściciela (nie wołającego) może wykonać mutację, gdy tabela bazowa ma
odebrane GRANTy `authenticated`. Sprawdzenie `p_user_id IS DISTINCT FROM auth.uid()` (już używane w tym repo)
przestaje być redundantną obroną w głąb, a staje się **jedynym** mechanizmem autoryzacji pod DEFINER.

Sesje bez zmiany: `createSession` (INSERT) zostaje jak jest — ten invariant (jedna aktywna sesja/workout)
jest już twardo egzekwowany partial unique indexem niezależnie od GRANTów, więc INSERT na `workout_sessions`
zostaje otwarty. `getActiveSessionForWorkout`, `getSessionOwnership`, `getSessionWithSets`,
`getWorkoutSessionHistory`, `getLastLoggedSets` (wszystkie SELECT) — bez zmian, SELECT nie jest revokowany.

### Metody domenowe (sygnatury + pseudokod)

```sql
-- Zastępuje: session.ts:296-315 completeSession() (surowy .update())
CREATE OR REPLACE FUNCTION complete_workout_session(p_user_id uuid, p_session_id uuid)
RETURNS workout_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session workout_sessions%ROWTYPE;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  SELECT * INTO v_session FROM workout_sessions
    WHERE id = p_session_id AND user_id = p_user_id
    FOR UPDATE;                              -- precondition lock

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'session_not_found';      -- named domain error, nie ciche 0-rows
  END IF;

  IF v_session.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'session_not_active';     -- fail-fast, nie update-i-jedź-dalej
  END IF;

  UPDATE workout_sessions
    SET status = 'completed', completed_at = now()
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION complete_workout_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_workout_session(uuid, uuid) TO authenticated;
```

```sql
-- Zastępuje: session.ts:258-276 upsertSet()
CREATE OR REPLACE FUNCTION log_workout_set(
  p_user_id uuid, p_session_id uuid, p_exercise_id uuid, p_set_number smallint,
  p_reps smallint, p_duration_seconds smallint, p_weight_kg numeric, p_notes text
)
RETURNS workout_sets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status workout_status_enum;
  v_set    workout_sets%ROWTYPE;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  SELECT status INTO v_status FROM workout_sessions
    WHERE id = p_session_id AND user_id = p_user_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'session_not_active';
  END IF;

  INSERT INTO workout_sets (workout_session_id, exercise_id, set_number, reps, duration_seconds, weight_kg, notes)
    VALUES (p_session_id, p_exercise_id, p_set_number, p_reps, p_duration_seconds, p_weight_kg, p_notes)
    ON CONFLICT (workout_session_id, exercise_id, set_number) DO UPDATE
      SET reps = EXCLUDED.reps, duration_seconds = EXCLUDED.duration_seconds,
          weight_kg = EXCLUDED.weight_kg, notes = EXCLUDED.notes, logged_at = now()
    RETURNING * INTO v_set;

  RETURN v_set;                               -- workout_sets_tracking_xor CHECK nadal chroni reps/duration
END;
$$;

REVOKE ALL ON FUNCTION log_workout_set(uuid,uuid,uuid,smallint,smallint,smallint,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_workout_set(uuid,uuid,uuid,smallint,smallint,smallint,numeric,text) TO authenticated;
```

```sql
-- Zastępuje: session.ts:278-294 deleteSet() — idempotentny, jak dziś (0 dopasowań = cicha operacja)
CREATE OR REPLACE FUNCTION remove_workout_set(
  p_user_id uuid, p_session_id uuid, p_exercise_id uuid, p_set_number smallint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status workout_status_enum;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  SELECT status INTO v_status FROM workout_sessions
    WHERE id = p_session_id AND user_id = p_user_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'session_not_active';
  END IF;

  DELETE FROM workout_sets
    WHERE workout_session_id = p_session_id AND exercise_id = p_exercise_id AND set_number = p_set_number;
END;
$$;

REVOKE ALL ON FUNCTION remove_workout_set(uuid,uuid,uuid,smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_workout_set(uuid,uuid,uuid,smallint) TO authenticated;
```

```sql
-- Modyfikacja istniejącej: restart_workout_session — INVOKER -> DEFINER (ciało bez zmian, tylko SECURITY)
CREATE OR REPLACE FUNCTION restart_workout_session(p_user_id uuid, p_existing_session_id uuid, p_workout_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER          -- było: SECURITY INVOKER (supabase/migrations/20260724130000...sql:17)
SET search_path = public
AS $$ /* ciało niezmienione względem 20260724130000_restart_workout_session_race_fix.sql:20-60 */ $$;
```

### Repozytorium / warstwa serwisowa

`src/lib/services/session.ts` — trzy funkcje mutujące zamienione z surowych `.from(...)` na `.rpc(...)`,
z mapowaniem nazwanego błędu domenowego z Postgresa na klasę TS (błąd nie jest cicho połykany):

```ts
export class SessionNotFoundError extends Error {}
export class SessionNotActiveError extends Error {}

function mapSessionRpcError(err: PostgrestError): never {
  if (err.message?.includes("session_not_active")) throw new SessionNotActiveError();
  if (err.message?.includes("session_not_found")) throw new SessionNotFoundError();
  throw err;
}

export async function completeSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<WorkoutSession> {
  const { data, error } = await supabase
    .rpc("complete_workout_session", { p_user_id: userId, p_session_id: sessionId })
    .single();
  if (error) mapSessionRpcError(error);
  return data as WorkoutSession;
}
// upsertSet -> log_workout_set, deleteSet -> remove_workout_set: ten sam kształt
```

### Cienkie API/route

`complete.ts` / `sets.ts` (PUT/POST/DELETE) tracą rolę egzekwowania: zamiast samodzielnie odrzucać na
podstawie odczytanego `session.status`, wołają serwis i mapują wyjątek domenowy na odpowiedź — kontrakt
API (kody 409/404, kształt JSON) **pozostaje identyczny**, więc żaden kod klienta nie wymaga zmian:

```ts
try {
  const updated = await completeSession(supabase, userId, sessionId);
  return Response.json(updated, { status: 200 });
} catch (err) {
  if (err instanceof SessionNotActiveError)
    return Response.json({ error: "conflict", message: "Session is not active" }, { status: 409 });
  if (err instanceof SessionNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
  console.error("Failed to complete session", { userId, sessionId, cause: err });
  return Response.json({ error: "db_error" }, { status: 500 });
}
```

Opcjonalny fast-path pre-check (`if (session.status !== "active") return 409` przed wywołaniem RPC) może
zostać jako czysto UX-owy skrót bez round-tripu — dokładnie ten wzorzec, jaki `reset.ts` już stosuje wobec
`reset_user_profile` (`20260723000000_reset_rpc_hardening.sql:6-14`: "app-layer check stays as a fast-path...
but it is no longer the only thing enforcing this"). Nie jest to już jednak jedyny strażnik.

### Wymagane REVOKE (część projektu, nie opcja)

```sql
REVOKE UPDATE, DELETE ON workout_sessions FROM authenticated;   -- INSERT zostaje (createSession, chroniony unique indexem)
REVOKE INSERT, UPDATE, DELETE ON workout_sets FROM authenticated; -- SELECT zostaje
```

Bez tego kroku powyższe funkcje `SECURITY DEFINER` są kosmetyczne — klient nadal mógłby wywołać
`PATCH /rest/v1/workout_sessions?id=eq.<completed>` z `{"status":"active"}` wprost, wskrzeszając ukończoną
sesję i unieważniając cały pattern (patrz KROK 3, "Odkrycie...").

## KROK 5 — Before/after, plan faz, testy

### Before/after

| Miejsce                                                            | Before                                                                                                    | After                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `session.ts:296-315` `completeSession`                             | `.from("workout_sessions").update(...)`, brak re-weryfikacji statusu                                      | `.rpc("complete_workout_session", ...)`, status re-weryfikowany w transakcji DEFINER |
| `session.ts:258-276` `upsertSet`                                   | `.from("workout_sets").upsert(...)`, brak re-weryfikacji statusu                                          | `.rpc("log_workout_set", ...)`                                                       |
| `session.ts:278-294` `deleteSet`                                   | `.from("workout_sets").delete(...)`, brak re-weryfikacji statusu                                          | `.rpc("remove_workout_set", ...)`                                                    |
| `complete.ts:37-39`, `sets.ts:56-58,132-134`                       | Jedyny strażnik, TOCTOU, omijalny przez bezpośredni PostgREST                                             | Fast-path UX (opcjonalny), egzekucja realna przeniesiona do DB                       |
| RLS + GRANT (`core_schema.sql:248-266`, `20260716120000...sql:16`) | `authenticated` ma wprost UPDATE/DELETE na `workout_sessions`/`workout_sets`; RLS sprawdza tylko własność | GRANT UPDATE/DELETE odebrany; jedyna droga mutacji to funkcje DEFINER                |
| `restart_workout_session`                                          | `SECURITY INVOKER`, chroniony wyłącznie dzięki temu, że GRANTy na tabeli są (dziś) otwarte                | `SECURITY DEFINER`, niezależny od GRANTów klienta                                    |

### Plan faz (test-first, zgodnie z dyscypliną CI: `npm run test` → `npm run test:integration` → `npm run test:e2e`)

**Faza 1 — test-first, integracyjne (red).** Rozszerzyć `tests/integration/session-ownership-rls.test.ts`
i/lub nowy `tests/integration/workout-session-status-guard.test.ts` o przypadki poniżej, uruchomione
PRZED napisaniem migracji — muszą być czerwone dziś (bo dziś przechodzą tam, gdzie nie powinny: patrz
dowód w KROK 3).

**Faza 2 — migracja DB.** Nowa migracja `supabase/migrations/<timestamp>_workout_session_status_guard.sql`:
trzy nowe funkcje + `CREATE OR REPLACE` dla `restart_workout_session` (INVOKER→DEFINER) + dwa `REVOKE`.
Weryfikacja: `npx supabase migration up` (nigdy `db reset` — `context/foundation/lessons.md` "Never Prescribe
`supabase db reset`"). Faza 1 powinna zzielenieć tu dla przypadków DB-poziomu.

**Faza 3 — warstwa serwisowa.** `session.ts`: zamiana trzech funkcji na `.rpc(...)`, nowe klasy błędów.
Unit testy `session.test.ts` (istnieje, linia 310 pokazuje istniejący wzorzec testowania `.rpc()` dla
`restartSession` — ten sam wzorzec do powielenia dla trzech nowych wywołań).

**Faza 4 — cienkie route'y.** `complete.ts`, `sets.ts` — zamiana pre-checku na catch błędu domenowego.
Aktualizacja `complete.test.ts`, `sets.test.ts`, `restart.test.ts` (mockują teraz `SessionNotActiveError`/
`SessionNotFoundError` zamiast pola `status` na zwracanym obiekcie sesji).

**Faza 5 — regresja pełnego CI** (`npm run lint` → `test` → `test:integration` → `test:e2e` → `build`),
zgodnie z wymogiem AGENTS.md, że `ci` jest wymaganym status checkiem na `main`.

### Przypadki testowe (legalne / nielegalne przejścia)

| #   | Scenariusz                                                                                                                      | Warstwa      | Oczekiwany wynik                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `log_workout_set` na sesji `active`                                                                                             | integration  | 200 / wiersz zapisany                                                                                                             |
| 2   | `log_workout_set` na sesji `completed`                                                                                          | integration  | reject `session_not_active`                                                                                                       |
| 3   | `log_workout_set` na sesji `abandoned`                                                                                          | integration  | reject `session_not_active`                                                                                                       |
| 4   | `remove_workout_set` na sesji `completed`                                                                                       | integration  | reject `session_not_active`                                                                                                       |
| 5   | `complete_workout_session` wywołane dwukrotnie (drugi raz na już-`completed`)                                                   | integration  | pierwszy: 200; **drugi: reject `session_not_active`** (dokładnie luka z `session-ownership-rls.test.ts:86-95`, dziś nietestowana) |
| 6   | Bezpośredni `PATCH /workout_sessions` (surowy `.update()` z klienta) na cudzej lub własnej `completed` sesji, z pominięciem RPC | integration  | **permission denied** (dowód, że REVOKE zamyka ścieżkę)                                                                           |
| 7   | `complete_workout_session`/`log_workout_set`/`remove_workout_set` z `p_user_id` innym niż `auth.uid()`                          | integration  | reject `user_id mismatch`                                                                                                         |
| 8   | `complete_workout_session` na nieistniejącym `session_id`                                                                       | integration  | reject `session_not_found`                                                                                                        |
| 9   | Route `POST /api/sessions/:id/complete` po naprawie, sesja nieaktywna                                                           | unit (route) | 409 `{error:"conflict"}` — kontrakt niezmieniony                                                                                  |
| 10  | Route `PUT /api/sessions/:id/sets` po naprawie, sesja nieaktywna                                                                | unit (route) | 409 `{error:"conflict"}` — kontrakt niezmieniony                                                                                  |
| 11  | `restart_workout_session` po zmianie INVOKER→DEFINER, dwa równoczesne restarty                                                  | integration  | zachowanie identyczne jak dziś w `tests/integration/restart-session-race.test.ts` (regresja, nie nowy przypadek)                  |

### Nazwy load-bearing do zarejestrowania

- RPC: `complete_workout_session`, `log_workout_set`, `remove_workout_set` (nowe); `restart_workout_session` (zmiana trybu bezpieczeństwa, nie nazwy)
- Błędy domenowe: `session_not_found`, `session_not_active` (stringi `RAISE EXCEPTION` po stronie Postgres) / `SessionNotFoundError`, `SessionNotActiveError` (klasy TS w `session.ts`)
- Kandydat do `context/foundation/lessons.md`: **"Revoke base-table DML grants when a mutation moves behind a `SECURITY DEFINER` RPC"** — kontrapunkt do istniejącej lekcji "Grant table privileges explicitly alongside RLS policies" (`lessons.md:5-10`); bez tego kroku żaden przyszły RPC-guard w tym repo nie jest realną gwarancją, tylko kosmetyką.

## Podsumowanie

Wybrany niezmiennik — "tylko aktywna sesja treningowa przyjmuje logowanie setów, completion i restart" —
jest jednocześnie najbardziej rdzeniowy (chroni "north star" flow z roadmap.md) i najsłabiej egzekwowany z
czterech niezmienników `WorkoutSession` zidentyfikowanych w `01-domain-distillation.md`. Diagnoza pokazała
coś więcej niż "brak DB guard": tabele `workout_sessions`/`workout_sets` mają wprost nadane GRANTy UPDATE/DELETE
dla `authenticated`, więc nawet gdyby dodać RPC w stylu już istniejącego w repo (`SECURITY INVOKER` +
kontrola w transakcji — wzorzec z `reset_user_profile`), luka pozostałaby otwarta, bo klient mógłby nadal
pominąć RPC i uderzyć bezpośrednio w tabelę przez PostgREST — dokładnie tak, jak dziś robi to istniejący
test integracyjny `session-ownership-rls.test.ts`, wołając `completeSession` wprost i oczekując sukcesu
bez żadnej negatywnej asercji. Projekt zamyka to definitywnie: trzy nowe funkcje `SECURITY DEFINER`
(`complete_workout_session`, `log_workout_set`, `remove_workout_set`) plus konwersja `restart_workout_session`
z INVOKER na DEFINER, sparowane z `REVOKE` bezpośrednich uprawnień UPDATE/DELETE na obu tabelach — dopiero ta
kombinacja czyni agregat jedynym możliwym miejscem mutacji, a nie tylko jednym z kilku. Kontrakt API (kody
409/404, kształt JSON) pozostaje niezmieniony, więc refaktor jest niewidoczny dla klienta. Plan faz jest
test-first zgodnie z dyscypliną CI tego repo, z jawnym przypadkiem #5/#6 jako testami, które dziś faktycznie
zawodzą (czerwone z założenia) i staną się zielone dopiero po migracji.
