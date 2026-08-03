---
title: FlowFit — Anti-Corruption Layer dla dostawcy AI (Gemini / @google/genai)
created: 2026-08-02
type: refactor-plan
---

# Anti-Corruption Layer — dostawca AI generujący plan treningowy

## KROK 0 — Kontekst

Priory przeczytane: `context/foundation/prd.md`, `context/foundation/tech-stack.md`, `context/foundation/roadmap.md`,
`README.md`, `AGENTS.md`, oraz — jako baza domenowa — `context/domain/01-domain-distillation.md` (klasyfikacja
"AI Plan Generation" jako **Core** subdomain, prd.md:111-112) i `context/domain/02-invariant-aggregate-refactor.md`
(niezmienniki `WorkoutSession`, poza zakresem tego dokumentu).

Stack: Astro 6 SSR (`src/pages/api/`), Supabase Postgres (RLS + RPC), warstwa serwisowa `src/lib/services/*.ts`,
Zod (`src/lib/validation/*.ts`), oraz Google Gemini (`@google/genai@^2.11.0`) jako jedyny zewnętrzny dostawca AI
(`package.json:23`). Manifest zależności zewnętrznych sprawdzony w całości (`package.json:17-42`): jedyne
kandydatki na "przeciekającą" zależność biznesową to `@google/genai` i `@supabase/supabase-js`/`@supabase/ssr`.
Supabase jest z góry odrzucony jako kandydat — `02-invariant-aggregate-refactor.md:20-21` opisuje warstwę
serwisową jako _zamierzony_ i już egzekwowany jedyny most do Supabase, bez rozjazdu dokumentacja-vs-kod i bez
udokumentowanego precedensu wymiany dostawcy bazy danych.

**Kluczowe odkrycie z `tech-stack.md` (KROK 0, nie hipoteza z KROK 1):** ORQ-2 ma pełną historię rewizji
(`tech-stack.md:26-29`): pierwotnie wybrano Anthropic SDK bezpośrednio, model `claude-sonnet-5`; **tego samego
dnia (2026-07-10)** decyzję odwrócono na Google Gemini, bo "Anthropic's API is not free... the project requires
a $0 AI provider" (`tech-stack.md:28`). Ten sam fakt jest powtórzony w `roadmap.md:96,152`. To nie jest
deklaracja intencji w stylu "zaprojektuj to jako wymienialne" — to **udokumentowany, już zaszły przypadek
wymiany dostawcy AI pod presją twardego ograniczenia biznesowego (koszt)**. Ryzyko ponownej wymiany (limit
darmowego tier-u Gemini, zmiana cennika, lepsza darmowa alternatywa) jest więc nie hipotetyczne, tylko
empirycznie potwierdzone jako powtarzalne.

---

## KROK 1 — Identyfikacja przeciekających zależności

Sygnał z instrukcji: "ten sam pakiet importowany w wielu warstwach", "zduplikowana rekonstrukcja
obiektów/typów biblioteki w kilku miejscach", "typy biblioteki w sygnaturach domenowych". Wszystkie trzy
sygnały występują jednocześnie dla `@google/genai` / `GoogleGenAI`.

### Pliki, które dziś "znają" `@google/genai` (bezpośredni import typu/wartości)

| #   | Plik:linia                              | Co robi                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/lib/ai/gemini.ts:1,4,8`            | `import { GoogleGenAI } from "@google/genai"`; fabryka `createGeminiClient(): GoogleGenAI \| null`                                                                                                                                                                                      |
| 2   | `src/lib/services/plan.ts:1,70`         | `import type { GoogleGenAI }`; **sygnatura domenowej funkcji serwisowej** `generateTrainingPlan(client: GoogleGenAI, profile, candidates)` — typ biblioteki wprost w API warstwy serwisowej                                                                                             |
| 3   | `src/lib/services/plan.ts:12,86-96`     | Stała `GEMINI_MODEL = "gemini-3.1-flash-lite"`, wywołanie `client.models.generateContent({...})`, odczyt `response.text` — cały protokół żądania/odpowiedzi Gemini (`systemInstruction`, `responseMimeType`, `responseJsonSchema`) zakodowany wewnątrz serwisu domenowego, nie adaptera |
| 4   | `src/pages/api/plan.ts:3,31-35`         | `import { createGeminiClient }`; zmienna `gemini`; komunikat błędu `"AI provider is not configured"` przy `!gemini`                                                                                                                                                                     |
| 5   | `src/pages/api/plan.ts:55`              | Klasyfikacja błędu `kind = isValidationFailure ? "validation" : "gemini_call"` — nazwa dostawcy wpisana wprost w log strukturalny warstwy API                                                                                                                                           |
| 6   | `src/lib/services/plan.test.ts:2,36-41` | `import type { GoogleGenAI }`; funkcja pomocnicza `buildGeminiClient()` **ręcznie rekonstruuje kształt `GoogleGenAI`** (`{ models: { generateContent: vi.fn()... } } as unknown as GoogleGenAI`)                                                                                        |
| 7   | `src/lib/services/plan.test.ts:66,72`   | Kolejne dwie ręczne rekonstrukcje: `{} as GoogleGenAI`                                                                                                                                                                                                                                  |
| 8   | `src/pages/api/plan.test.ts:10,15,45`   | `vi.mock("@/lib/ai/gemini", ...)`; stub `createGeminiClientMock` zwraca `{}` — trzecia, luźno typowana rekonstrukcja tego samego kształtu                                                                                                                                               |

To jest dokładnie wzorzec "duplikowana rekonstrukcja obiektu biblioteki w kilku miejscach": kształt klienta
Gemini jest odtwarzany ręcznie **trzy razy** w testach (#6, #7, #8), bo żaden z nich nie ma wspólnego,
wąskiego interfejsu do zaimplementowania.

### Pośredni przeciek — kontrakt "wire shape" Gemini w pliku walidacji domenowej

`src/lib/validation/plan.ts:27-52` — funkcja `buildPlanGenerationSchema()`, poprzedzona komentarzem
`// Gemini chokes on a large string enum nested inside repeated array items ... Have the model reference
candidates by array index instead` (`validation/plan.ts:27-30`). To nie jest reguła domenowa (domena nie ma
pojęcia "candidate index") — to obejście konkretnego ograniczenia `responseJsonSchema` w SDK Gemini,
umieszczone w pliku, który jednocześnie definiuje prawdziwy kontrakt domenowy `PlanOutput`
(`buildPlanSchema`, `validation/plan.ts:19-25`). Dwa różne poziomy abstrakcji (kontrakt domenowy vs. obejście
konkretnego SDK) współdzielą dziś jeden plik i moduł eksportów.

### Czy to "groźny" przeciek (biblioteka serwerowa w bundlu klienta)?

Nie w tym sensie — `@google/genai` jest importowany wyłącznie po stronie serwera (API route + serwis +
adapter), `GEMINI_API_KEY` jest ładowany przez `astro:env/server` zgodnie z regułą AGENTS.md, więc nie ma
przecieku sekretu ani kodu SDK do bundla klienta. Groźba tutaj jest innego rodzaju: **brak jakiegokolwiek
szwu (seam)** między "co robi Gemini" a "co robi domena", w sytuacji gdy dokumentacja projektu dowodzi, że
wymiana dostawcy AI już raz nastąpiła i może nastąpić ponownie.

---

## KROK 2 — Klasyfikacja i wybór #1

| Oś                                              | `@google/genai` (AI provider)                                                                                                                                              | `@supabase/supabase-js` (DB/auth)                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| (a) Liczba warstw/plików dotkniętych            | **8 plików / 5 miejsc kodu produkcyjnego + 3 miejsca testowe**, obejmuje adapter, serwis, walidację domenową i route                                                       | Skoncentrowane w warstwie serwisowej (`src/lib/services/*.ts`) — zgodnie z zamierzoną architekturą, patrz `02-...md:20-21` |
| (b) Ryzyko/koszt wymiany dziś                   | **Wysokie** — trzeba dotknąć prompt-building, parsowanie odpowiedzi, workaround indeksów, nazwę modelu, komunikaty błędów w route, i przepisać 3 ręczne stuby testowe      | Niskie/oczekiwane — Supabase jest architektonicznym fundamentem (RLS, RPC, auth), nigdy nie zadeklarowano zamiaru wymiany  |
| (c) Rozjazd dokument-vs-kod / precedens wymiany | **Tak, empirycznie potwierdzony** — `tech-stack.md:26-29`, `roadmap.md:96,152`: dostawca AI już raz był wymieniony pod presją kosztu, tego samego dnia co pierwsza decyzja | Brak — żaden dokument nie sugeruje wymiany bazy/auth                                                                       |

**Wybór: `@google/genai` / typ `GoogleGenAI`.** To najgorszy przeciek z dwóch kandydatów na wszystkich trzech
osiach jednocześnie: najszerszy (5 warstw kodu produkcyjnego), najkosztowniejszy do wymiany dziś (logika
protokołu Gemini rozsmarowana po serwisie, walidacji i route'cie), i jedyny, dla którego rozjazd
intencja-vs-kod nie jest teoretyczny — już się zmaterializował raz, udokumentowany w `tech-stack.md` jako
"revision history", nie jako futurystyczna klauzula projektowa.

---

## KROK 3 — Diagnoza

### Duplikacja (cytaty plik:linia)

1. **Kształt klienta Gemini rekonstruowany 3×** zamiast raz za interfejsem: `plan.test.ts:36-41`
   (`{ models: { generateContent: vi.fn()... } }`), `plan.test.ts:66,72` (`{} as GoogleGenAI` ×2),
   `pages/api/plan.test.ts:10,45` (`createGeminiClientMock` → `{}`). Żaden z trzech nie gwarantuje zgodności
   z prawdziwym `GoogleGenAI` poza rzutowaniem `as unknown as` — typowy objaw braku wąskiego portu.
2. **Nazwa dostawcy wpisana w kontrakt logowania błędów warstwy API**: `pages/api/plan.ts:55`,
   `kind: "gemini_call"` — trafia do `console.error` jako pole strukturalne. Gdyby jutro dostawcą był
   Anthropic (jak było pierwotnie, `tech-stack.md:27`), ten log musiałby zostać ręcznie przemianowany, bo
   route zna nazwę dostawcy, a nie powinien.
3. **Kontrakt wire-shape Gemini (workaround indeksów) współdzieli plik z prawdziwym kontraktem domenowym**:
   `validation/plan.ts:27-52` (`buildPlanGenerationSchema`) obok `validation/plan.ts:19-25`
   (`buildPlanSchema`, prawdziwy `PlanOutput`). Komentarz na linii 27-30 wprost nazywa Gemini — to dowód, że
   ten fragment nie jest regułą domenową, tylko wiedzą o konkretnym SDK, błędnie umieszczoną w pliku
   domenowej walidacji.
4. **Protokół żądania/odpowiedzi Gemini żyje w warstwie serwisowej**, nie w adapterze:
   `services/plan.ts:80-123` — budowanie `jsonSchema` z `z.toJSONSchema`, wywołanie
   `client.models.generateContent`, parsowanie `response.text`, remapping indeks→`exercise_id`. Serwis, który
   z definicji powinien być "provider-agnostic" (przyjmuje `UserProfile`, `CandidateExercise[]`, zwraca
   `PlanOutput`), dziś zna każdy szczegół protokołu jednego konkretnego SDK.

### Przecieki przez granice warstw

Ścieżka danych dziś: `route (pages/api/plan.ts)` → tworzy konkretny `GoogleGenAI` przez `createGeminiClient()`
→ przekazuje **surowy typ biblioteki** do `services/plan.ts:generateTrainingPlan(client: GoogleGenAI, ...)` →
serwis woła `client.models.generateContent` bezpośrednio. Trzy warstwy (route, adapter, serwis) znają
konkretny typ `GoogleGenAI`; żadna nie zna tylko interfejsu. To odwrotność ACL: zamiast "serwis zna port,
adapter zna bibliotekę", tu **serwis też zna bibliotekę** — adapter (`gemini.ts`) redukuje się do samej
konstrukcji klienta, a cała logika protokołu ucieka do serwisu.

### Rozjazd dokument-vs-kod

`tech-stack.md:26-29` (cytat): _"1. Original (closed): Anthropic SDK direct... 2. Reversed same day
(2026-07-10): Anthropic's API is not free; the project requires a $0 AI provider... chose Google Gemini."_
Kod nie ma dziś żadnej struktury, która sprawiałaby, że powtórka tej decyzji (np. powrót do Anthropic, albo
migracja na OpenRouter/Groq — wszystkie ewaluowane wtedy per `tech-stack.md:28`) byłaby zmianą lokalną. Dowód:
wymiana dostawcy dziś wymagałaby edycji `gemini.ts`, `services/plan.ts` (sygnatura + całe ciało 80-123),
`validation/plan.ts` (usunięcie `buildPlanGenerationSchema` lub jego przepisanie pod nowy SDK), `pages/api/plan.ts`
(zmienna `gemini`, komunikat błędu, `kind: "gemini_call"`), oraz dwóch plików testowych.

---

## KROK 4 — Projekt ACL

### Value object / kontrakt domenowy — już istnieje, tylko trzeba go oczyścić

`PlanOutput` (`src/lib/validation/plan.ts:19-25`, `z.infer<ReturnType<typeof buildPlanSchema>>`) **już jest**
poprawnym, provider-agnostic value objectem: uuid-based `exercise_id`, bez śladu typu biblioteki, dokładnie
w kształcie, jakiego oczekuje RPC `save_generated_training_plan`. Nie trzeba go wynajdywać na nowo — trzeba
**wyprowadzić z jego sąsiedztwa** wszystko, co nim nie jest: `buildPlanGenerationSchema` (Gemini-owy
workaround indeksów) przenosi się do adaptera, bo to wiedza o SDK, nie o domenie.

### Wąski port (interfejs domenowy)

Właściciel portu: warstwa serwisowa (`src/lib/services/plan.ts`) — domena definiuje, czego potrzebuje;
adapter dostarcza implementację. Zero importu `@google/genai` w tym pliku po refaktorze.

```ts
// src/lib/services/plan.ts — port + błędy domenowe (BEZ importu "@google/genai")

export interface TrainingPlanGenerator {
  generate(profile: UserProfile, candidates: CandidateExercise[]): Promise<PlanOutput>;
}

export class PlanValidationError extends Error {} // istnieje dziś — zostaje: strażnik liczby
// kandydatów + reguła biznesowa "kształt planu"
export class PlanGenerationFailedError extends Error {} // NOWY — awaria dostawcy (sieć, konfiguracja,
// odpowiedź nie do sparsowania), provider-agnostic

export async function generateTrainingPlan(
  generator: TrainingPlanGenerator,
  profile: UserProfile,
  candidates: CandidateExercise[],
): Promise<PlanOutput> {
  if (candidates.length < MIN_EXERCISES_PER_WORKOUT) {
    throw new PlanValidationError(
      `Not enough exercises match your equipment and experience level ` +
        `(found ${candidates.length}, need at least ${MIN_EXERCISES_PER_WORKOUT}).`,
    );
  }
  try {
    return await generator.generate(profile, candidates); // kontrakt portu: zawsze PlanOutput albo throw
  } catch (err) {
    if (err instanceof PlanValidationError) throw err; // adapter może zgłosić złą postać odpowiedzi AI
    throw new PlanGenerationFailedError("Failed to generate training plan", { cause: err });
  }
}
```

`validatePlanAgainstCandidates` (`services/plan.ts:133-169`) zostaje bez zmian — to reguła biznesowa
niezależna od dostawcy (sprawdza wynik względem `candidates`, nie względem żadnego SDK) i już dziś nie zna
typu biblioteki.

### Adapter — jedyne miejsce, które wolno importować `@google/genai`

```ts
// src/lib/ai/gemini.ts — JEDYNY plik w repo z importem "@google/genai"
import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "astro:env/server";
import { z } from "zod";
import type { TrainingPlanGenerator } from "@/lib/services/plan";
import { PlanValidationError } from "@/lib/services/plan";
import { buildPlanSchema, MIN_EXERCISES_PER_WORKOUT } from "@/lib/validation/plan";
import type { UserProfile } from "@/types";
import type { CandidateExercise } from "@/lib/services/plan";

const GEMINI_MODEL = "gemini-3.1-flash-lite"; // przeniesione z services/plan.ts:12

// Przeniesione z src/lib/validation/plan.ts:31-52 — to kontrakt WIRE Gemini
// (workaround "duży string enum w zagnieżdżonej tablicy"), nie kontrakt domenowy.
function buildGenerationSchema(sessionsPerWeek: number, candidateCount: number) {
  /* body bez zmian */
}
function buildSystemPrompt(): string {
  /* bez zmian, z services/plan.ts:41-49 */
}
function buildUserPrompt(profile: UserProfile, candidates: CandidateExercise[]): string {
  /* bez zmian */
}

export class GeminiTrainingPlanGenerator implements TrainingPlanGenerator {
  constructor(private readonly client: GoogleGenAI) {}

  async generate(profile: UserProfile, candidates: CandidateExercise[]): Promise<PlanOutput> {
    const generationSchema = buildGenerationSchema(profile.sessions_per_week, candidates.length);
    const jsonSchema: Record<string, unknown> = z.toJSONSchema(generationSchema);
    delete jsonSchema.$schema;

    const response = await this.client.models.generateContent({
      model: GEMINI_MODEL,
      contents: buildUserPrompt(profile, candidates),
      config: {
        systemInstruction: buildSystemPrompt(),
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
      },
    });

    const text = response.text;
    if (!text) throw new PlanValidationError("Gemini response did not include any content");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new PlanValidationError("Gemini response was not valid JSON");
    }

    const generationResult = generationSchema.safeParse(parsedJson);
    if (!generationResult.success) {
      throw new PlanValidationError(
        `Gemini response did not match the expected schema: ${generationResult.error.message}`,
      );
    }

    // JEDYNE miejsce w repo, które konwertuje kształt biblioteki (index-based) na kształt domeny (uuid-based)
    const plan: PlanOutput = {
      workouts: generationResult.data.workouts.map((workout) => ({
        ...workout,
        exercises: workout.exercises.map(({ id: candidateIndex, ...rest }) => ({
          ...rest,
          exercise_id: candidates[candidateIndex].id,
        })),
      })),
    };

    const result = buildPlanSchema(profile.sessions_per_week).safeParse(plan);
    if (!result.success) {
      throw new PlanValidationError(`Mapped plan did not match the expected schema: ${result.error.message}`);
    }
    return result.data; // port contract: gwarantowany PlanOutput, zero typu biblioteki na zewnątrz
  }
}

export function createTrainingPlanGenerator(): TrainingPlanGenerator | null {
  if (!GEMINI_API_KEY) return null;
  return new GeminiTrainingPlanGenerator(new GoogleGenAI({ apiKey: GEMINI_API_KEY }));
}
```

Cały protokół Gemini (nazwa modelu, prompt, `responseJsonSchema`, workaround indeksów, parsowanie) jest teraz
w jednym pliku. Reszta repo widzi wyłącznie `TrainingPlanGenerator`.

### Cienki route

```ts
// src/pages/api/plan.ts — zero wzmianek o "Gemini" po refaktorze
import { createTrainingPlanGenerator } from "@/lib/ai/gemini";
import { generateTrainingPlan, validatePlanAgainstCandidates, PlanValidationError } from "@/lib/services/plan";
...
const planGenerator = createTrainingPlanGenerator();
if (!planGenerator) {
  console.error("Training plan generator is not configured", { userId });
  return Response.json({ error: "ai_error", message: "AI provider is not configured" }, { status: 502 });
}
...
try {
  const plan = await generateTrainingPlan(planGenerator, profile, candidates);
  planPayload = validatePlanAgainstCandidates(plan, candidates);
} catch (err) {
  const isValidationFailure = err instanceof PlanValidationError;
  const kind = isValidationFailure ? "validation" : "generation_failed";  // było: "gemini_call"
  console.error("Plan generation failed", { userId, kind, cause: err });
  return Response.json({ error: "ai_error", message: isValidationFailure ? err.message : "Failed to generate training plan" }, { status: 502 });
}
```

Zmienna `gemini` → `planGenerator`; żaden identyfikator w tym pliku nie nazywa dostawcy.

### Rozstrzygnięcie otwartej kwestii kontraktu biblioteki (KROK 5 wymaga tego tutaj, bo dotyczy KROK 4)

Otwarta kwestia: SDK Gemini rzuca różne rodzaje błędów (sieć, limit zapytań, autoryzacja) — dzisiejszy kod
nie rozróżnia ich, tylko zbiera wszystko do jednego `catch` w route (`pages/api/plan.ts:52-58`, `kind:
"gemini_call"` dla wszystkiego, co nie jest `PlanValidationError`). Decyzja: **ACL zachowuje ten sam poziom
szczegółowości** (jeden generyczny `PlanGenerationFailedError` dla wszystkiego, co nie jest jawnym błędem
walidacji kształtu) — nic w PRD ani dotychczasowym kodzie nie uzasadnia dziś bogatszej taksonomii błędów
(np. osobnej obsługi rate-limit). Zakodowane w adapterze (`gemini.ts`, przez to, co `catch` w
`generateTrainingPlan` mapuje na `PlanGenerationFailedError`), **nie** w route — dokładnie zgodnie z
ograniczeniem z promptu. Jeśli w przyszłości pojawi się potrzeba np. osobnego zachowania przy rate-limit,
miejscem kodowania tej decyzji jest `GeminiTrainingPlanGenerator.generate` (rzucenie precyzyjniejszego
podtypu błędu domenowego), nie warstwa API.

---

## KROK 5 — Dowód izolacji + before/after

### Dowód: wymiana dostawcy dotyka wyłącznie adaptera

Gdyby jutro trzeba było wrócić do Anthropic (dokładnie scenariusz z `tech-stack.md:26-27`) albo przejść na
OpenRouter/Groq (oba explicit ewaluowane, `tech-stack.md:28`):

| Plik                                                                                    | Dotyczy wymiany dostawcy?                                                                                                 |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai/gemini.ts` (lub nowy `src/lib/ai/anthropic.ts` implementujący ten sam port) | **Tak — jedyny plik z realną zmianą logiki**                                                                              |
| `src/lib/services/plan.ts`                                                              | Nie — zna tylko `TrainingPlanGenerator`                                                                                   |
| `src/lib/validation/plan.ts`                                                            | Nie — `buildPlanGenerationSchema` przeniesiony do adaptera, zostaje tylko `buildPlanSchema` (prawdziwy kontrakt domenowy) |
| `src/pages/api/plan.ts`                                                                 | Nie — zna tylko `createTrainingPlanGenerator()` i `TrainingPlanGenerator`                                                 |
| `supabase/migrations/*` (`save_generated_training_plan`)                                | Nie — RPC widziało i widzi wyłącznie `PlanOutput`-owy JSON                                                                |
| UI (`src/components/plan/*`, `dashboard.astro`)                                         | Nie — nigdy nie widziało typu biblioteki                                                                                  |
| `src/lib/services/plan.test.ts`                                                         | Nie — testuje `generateTrainingPlan` przez stub `TrainingPlanGenerator`, niezależny od SDK                                |
| `src/pages/api/plan.test.ts`                                                            | Nie — mockuje `createTrainingPlanGenerator`, zwraca stub zgodny z portem                                                  |

Kryterium sukcesu (KROK 6) spełnione: zmiana dostawcy = nowy plik/edycja w `src/lib/ai/` + jedna linijka w
miejscu, gdzie dziś `pages/api/plan.ts` importuje `createTrainingPlanGenerator` (import path), zero zmian
poza tym katalogiem.

### Before/after dla zduplikowanych miejsc (KROK 1/3)

| Miejsce                                           | Before                                                                                | After                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `services/plan.ts:generateTrainingPlan` sygnatura | `(client: GoogleGenAI, profile, candidates)`                                          | `(generator: TrainingPlanGenerator, profile, candidates)`                                                         |
| `services/plan.ts:80-123`                         | Zna protokół Gemini (model, prompt, `responseJsonSchema`, remap indeksów)             | Deleguje do `generator.generate(...)`, zna tylko `PlanOutput`                                                     |
| `validation/plan.ts:27-52`                        | `buildPlanGenerationSchema` (workaround Gemini) obok prawdziwego kontraktu domenowego | Usunięte stąd, żyje w `lib/ai/gemini.ts`                                                                          |
| `pages/api/plan.ts:31,55`                         | Zmienna `gemini`, `kind: "gemini_call"`                                               | Zmienna `planGenerator`, `kind: "generation_failed"`                                                              |
| `services/plan.test.ts:36-41,66,72`               | 3× ręczna rekonstrukcja `GoogleGenAI`-kształtu (`as unknown as`)                      | Stub `{ generate: vi.fn() }` zgodny z `TrainingPlanGenerator`, bez rzutowań                                       |
| `pages/api/plan.test.ts:10,45`                    | Stub `{}` dla `createGeminiClientMock`                                                | Stub `{ generate: vi.fn() }` — typowany interfejsem portu                                                         |
| Nowy: `src/lib/ai/gemini.test.ts`                 | (nie istniał)                                                                         | Testy specyficzne dla Gemini (index-remap, malformed JSON, brak `text`) przeniesione tu z `services/plan.test.ts` |

**Warstwa UI dostaje gotowe dane domenowe, nie surowy obiekt biblioteki** — to było prawdą już przed
refaktorem (`PlanDisplay.astro` czyta wyłącznie `ActivePlanWorkout`/DB-persisted dane, nigdy `PlanOutput`
bezpośrednio z Gemini), więc nie zmienia się; wymieniony jest wyłącznie szew między route/serwisem a SDK.

---

## KROK 6 — Weryfikacja i plan faz

### Kryterium sukcesu (grep)

Po refaktorze:

```
grep -rn "@google/genai\|GoogleGenAI" src/
```

powinno zwrócić wyłącznie `src/lib/ai/gemini.ts` i `src/lib/ai/gemini.test.ts` (nowy plik testowy adaptera).
Dodatkowo, `grep -rin "\bgemini\b" src/pages src/lib/services src/lib/validation` (poza katalogiem
`src/lib/ai/`) powinno zwrócić **zero trafień** — dziś zwraca `services/plan.ts:12,44` (komentarz),
`validation/plan.ts:27` (komentarz), `pages/api/plan.ts` (przez `createGeminiClient`, `kind: "gemini_call"`).

### Pliki, które dziś znają zależność → po refaktorze

| Plik                               | Dziś                                               | Po refaktorze                                                         |
| ---------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `src/lib/ai/gemini.ts`             | Zna                                                | Zna (to jest ACL)                                                     |
| `src/lib/services/plan.ts`         | Zna (typ w sygnaturze + całe ciało protokołu)      | **Nie zna** — tylko `TrainingPlanGenerator`                           |
| `src/lib/validation/plan.ts`       | Zna pośrednio (`buildPlanGenerationSchema`)        | **Nie zna**                                                           |
| `src/pages/api/plan.ts`            | Zna (import, nazwa zmiennej, log)                  | **Nie zna**                                                           |
| `src/lib/services/plan.test.ts`    | Zna (3× ręczna rekonstrukcja)                      | **Nie zna** — stub portu                                              |
| `src/pages/api/plan.test.ts`       | Zna pośrednio (mock modułu `gemini.ts`, stub `{}`) | Zna tylko nazwę modułu do zamockowania (import path), nie kształt SDK |
| `src/lib/ai/gemini.test.ts` (nowy) | —                                                  | Zna (test adaptera)                                                   |

### Plan faz (test-first, zgodnie z dyscypliną CI: `npm run test` → `test:integration` → `test:e2e` → `build`)

**Faza 1 — port + błędy domenowe (red→green, jednostkowe).** Dodać `TrainingPlanGenerator`,
`PlanGenerationFailedError` do `services/plan.ts`; zmienić sygnaturę `generateTrainingPlan` na przyjmowanie
portu zamiast `GoogleGenAI`; usunąć z tego pliku cały protokół Gemini (linie 12, 41-131 dziś). Zaktualizować
`services/plan.test.ts`, by stubował `TrainingPlanGenerator`, nie `GoogleGenAI`.

**Faza 2 — adapter.** Przenieść `buildGenerationSchema` z `validation/plan.ts:27-52` oraz
`buildSystemPrompt`/`buildUserPrompt`/logikę `generateContent`/parsowania/remapu z `services/plan.ts` do
`lib/ai/gemini.ts` jako `GeminiTrainingPlanGenerator implements TrainingPlanGenerator`. Nowy
`lib/ai/gemini.test.ts` przejmuje testy specyficzne dla kształtu odpowiedzi Gemini (dziś częściowo w
`services/plan.test.ts` — np. przypadki "invalid JSON", "missing text", schema mismatch).

**Faza 3 — route.** `pages/api/plan.ts`: `createGeminiClient` → `createTrainingPlanGenerator`, zmienna
`gemini` → `planGenerator`, `kind: "gemini_call"` → `kind: "generation_failed"`. Zaktualizować
`pages/api/plan.test.ts` (mock zwraca `{ generate: vi.fn() }` zamiast `{}`).

**Faza 4 — regresja pełnego CI** (`npm run lint` → `test` → `test:integration` → `test:e2e` → `build`),
zgodnie z wymogiem AGENTS.md, że `ci` jest wymaganym status checkiem na `main`. Weryfikacja grep-em z KROK 6
jako ostatni krok manualny przed PR.

### Nazwy load-bearing do zarejestrowania

- Port: `TrainingPlanGenerator` (`src/lib/services/plan.ts`) — jedyny kontrakt, jaki route/serwis/testy poza
  `src/lib/ai/` mogą znać.
- Adapter: `GeminiTrainingPlanGenerator` + fabryka `createTrainingPlanGenerator()` (`src/lib/ai/gemini.ts`).
- Błędy domenowe: `PlanValidationError` (istnieje, zostaje), `PlanGenerationFailedError` (nowy — zastępuje
  nienazwaną gałąź `else` w `pages/api/plan.ts:52-58`).
- Kandydat do `context/foundation/lessons.md`: **"Zewnętrzny SDK dostawcy AI wchodzi wyłącznie przez wąski
  port zdefiniowany przez domenę (`TrainingPlanGenerator`); żaden typ SDK, nazwa modelu ani wire-shape
  workaround nie przekracza granicy `src/lib/ai/`"** — uzasadnione udokumentowanym w `tech-stack.md`
  precedensem jednodniowej wymiany dostawcy AI (Anthropic → Gemini, 2026-07-10).

---

## Podsumowanie

Wybrany przeciek — typ `GoogleGenAI` z `@google/genai` — jest jednocześnie najszerszy (8 miejsc w 5 plikach
produkcyjnych/testowych, obejmujących adapter, serwis, walidację domenową i route) i ma jedyny w tym repo
udokumentowany precedens realnej wymiany dostawcy: `tech-stack.md`'s ORQ-2 revision history pokazuje, że
Anthropic → Gemini nastąpiło tego samego dnia pod presją kosztu, więc ryzyko kolejnej wymiany jest
potwierdzone, nie hipotetyczne. Diagnoza pokazała cztery miejsca duplikacji/przecieku: trzy niezależne, luźno
typowane rekonstrukcje kształtu `GoogleGenAI` w testach, nazwę dostawcy wpisaną w strukturalny log błędów
route'a, oraz — najbardziej istotne — kontrakt wire-shape Gemini (`buildPlanGenerationSchema`) mieszkający w
tym samym pliku co prawdziwy kontrakt domenowy `PlanOutput`. Projekt ACL nie wymyśla nowego value objectu, bo
`PlanOutput` już poprawnie pełni tę rolę — zamiast tego definiuje wąski port `TrainingPlanGenerator`
(właściciel: `services/plan.ts`) i przenosi całą wiedzę o SDK (nazwa modelu, prompt, `responseJsonSchema`,
workaround indeksów, parsowanie i mapowanie index→uuid) do jedynego adaptera `lib/ai/gemini.ts`. Dowód
izolacji: tabela plik-po-plik pokazuje, że po refaktorze wymiana dostawcy dotyka wyłącznie katalogu
`src/lib/ai/`, przy niezmienionym kontrakcie RPC (`save_generated_training_plan`), UI i publicznym kształcie
API `POST /api/plan`. Kryterium sukcesu jest sprawdzalne grepem: `@google/genai`/`GoogleGenAI` po refaktorze
występuje wyłącznie w dwóch plikach katalogu `src/lib/ai/`. Plan faz jest test-first i zgodny z dyscypliną CI
tego repo, z jawnym rozdzieleniem testów "port/serwis" (provider-agnostic) od nowych testów adaptera
(Gemini-specific).
