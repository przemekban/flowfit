# Exercise Scraping Pipeline — SmartWorkout.app

## Cel

Pobranie ~820 ćwiczeń z SmartWorkout.app i wygenerowanie szablonów treningowych. Wynikiem jest `supabase/seed.sql` z trzema blokami INSERT:

1. `INSERT INTO exercises` — ~820 wierszy (scraped + 9 cardio)
2. `INSERT INTO workout_templates` — 8 szablonów
3. `INSERT INTO workout_template_exercises` — ćwiczenia w szablonach

---

## Wymagane kolumny w tabeli exercises (po migracji Phase 2)

| Kolumna | Typ | Źródło |
|---|---|---|
| `name` | TEXT | SmartWorkout — polska nazwa (h1) |
| `muscle_group` | muscle_group_enum | z kontekstu kategorii |
| `difficulty` | experience_level_enum | wnioskowane przez Claude z nazwy + tagów |
| `equipment` | TEXT | wnioskowane przez Claude z nazwy + tagów |
| `description` | TEXT | SmartWorkout — akapit wstępny, kopiowany dosłownie |
| `instructions` | TEXT[] | SmartWorkout — kroki wykonania, kopiowane dosłownie |
| `muscles_primary` | TEXT[] | SmartWorkout — mięśnie główne, kopiowane dosłownie |
| `muscles_secondary` | TEXT[] | SmartWorkout — mięśnie pomocnicze, kopiowane dosłownie |
| `tips` | TEXT[] | SmartWorkout — wskazówki, kopiowane dosłownie |
| `common_mistakes` | TEXT[] | SmartWorkout — typowe błędy, kopiowane dosłownie |

> Pola 5–10 są kopiowane ze strony **bez przetwarzania przez AI** — scraper zapisuje je dokładnie tak jak pojawiają się na SmartWorkout.

---

## Architektura

```
SmartWorkout.app                   scripts/scrape-exercises.mjs        Claude prompt(s)
                                                                              │
listing pages (9 kategorii)  ──►   Krok 1: zbierz URL-e            ──►   Faza 2: exercises SQL
detail pages (~820 stron)          Krok 2: pobierz szczegóły               (equipment + difficulty)
                                   └─ exercises-raw.json
                                                                       ──►  Faza 3: templates SQL
                                                                              (professional trainer)
```

---

## Faza 1: Scraper (scripts/scrape-exercises.mjs)

### Kategorie do pobrania

| URL SmartWorkout | `muscle_group` |
|---|---|
| `/pl/atlas-cwiczen/klatka-piersiowa` | `chest` |
| `/pl/atlas-cwiczen/plecy` | `back` |
| `/pl/atlas-cwiczen/barki` | `shoulders` |
| `/pl/atlas-cwiczen/nogi` | `legs` |
| `/pl/atlas-cwiczen/posladki` | `glutes` |
| `/pl/atlas-cwiczen/biceps` | `arms` |
| `/pl/atlas-cwiczen/triceps` | `arms` |
| `/pl/atlas-cwiczen/przedramiona` | `arms` |
| `/pl/atlas-cwiczen/brzuch` | `core` |

> Brak kategorii `cardio` na SmartWorkout — 9 ćwiczeń cardio dodawanych przez Claude w Fazie 2.

### Krok 1: listing pages → lista URL-i

Z każdej strony kategorii wyciągnij listę `{ detail_url, muscle_group }`.
Wzorzec linków: `<a href="/pl/atlas-cwiczen/<kategoria>/<slug>">`.

### Krok 2: detail pages → pełne dane ćwiczenia

Dla każdego URL (z 500 ms opóźnieniem) wyciągnij:

| Pole JSON | Selektor / lokalizacja na stronie SmartWorkout |
|---|---|
| `name` | `<h1>` — polska nazwa |
| `tags` | tagi przy tytule (np. "Siła", "Ciągnące") |
| `description` | pierwszy akapit pod h1 |
| `instructions` | sekcja "Instrukcja wykonania" — tablica stringów (każdy krok osobno) |
| `muscles_primary` | sekcja "Mięśnie" → "Główne" — tablica stringów |
| `muscles_secondary` | sekcja "Mięśnie" → "Pomocnicze" — tablica stringów |
| `tips` | sekcja "Wskazówki" — tablica stringów (każda wskazówka osobno) |
| `common_mistakes` | sekcja "Typowe błędy" — tablica stringów (każdy błąd osobno) |

### Format exercises-raw.json

```json
[
  {
    "name": "Podciąganie nachwytem",
    "muscle_group": "back",
    "tags": ["Siła", "Ciągnące"],
    "description": "Podciąganie nachwytem to ćwiczenie siłowe, które angażuje głównie mięśnie pleców, ramion i przedramion.",
    "instructions": [
      "Stań pod drążkiem i chwyć go nachwytem, dłonie nieco szerzej niż szerokość barków.",
      "Zawieś się na drążku, prostując ramiona i napinając mięśnie brzucha.",
      "Podciągnij się w górę, aż broda znajdzie się powyżej drążka.",
      "Powoli opuść się do pozycji wyjściowej."
    ],
    "muscles_primary": ["Plecy"],
    "muscles_secondary": ["Bicepsy", "Przedramiona", "Barki"],
    "tips": [
      "Utrzymuj napięcie brzucha przez cały ruch.",
      "Unikaj bujania ciałem.",
      "Skup się na pełnym zakresie ruchu."
    ],
    "common_mistakes": [
      "Używanie siły rąk zamiast mięśni pleców.",
      "Niepełny zakres ruchu.",
      "Skrzyżowanie lub zginanie nóg."
    ]
  }
]
```

### Implementacja (pseudokod)

```js
import { writeFileSync } from 'fs'
import { parse } from 'node-html-parser'

const BASE = 'https://smartworkout.app'
const DELAY_MS = 500
const sleep = ms => new Promise(r => setTimeout(r, ms))

const CATEGORIES = [
  { path: '/pl/atlas-cwiczen/klatka-piersiowa', muscle_group: 'chest' },
  { path: '/pl/atlas-cwiczen/plecy',            muscle_group: 'back' },
  { path: '/pl/atlas-cwiczen/barki',            muscle_group: 'shoulders' },
  { path: '/pl/atlas-cwiczen/nogi',             muscle_group: 'legs' },
  { path: '/pl/atlas-cwiczen/posladki',         muscle_group: 'glutes' },
  { path: '/pl/atlas-cwiczen/biceps',           muscle_group: 'arms' },
  { path: '/pl/atlas-cwiczen/triceps',          muscle_group: 'arms' },
  { path: '/pl/atlas-cwiczen/przedramiona',     muscle_group: 'arms' },
  { path: '/pl/atlas-cwiczen/brzuch',           muscle_group: 'core' },
]

const links = []
for (const cat of CATEGORIES) {
  const html = await fetch(BASE + cat.path).then(r => r.text())
  const root = parse(html)
  const hrefs = root.querySelectorAll('a[href^="/pl/atlas-cwiczen/"]')
    .map(a => a.getAttribute('href'))
    .filter(href => href.split('/').length === 5)  // tylko /pl/atlas-cwiczen/<kat>/<slug>
  links.push(...hrefs.map(href => ({ href, muscle_group: cat.muscle_group })))
  await sleep(DELAY_MS)
}

const exercises = []
for (const { href, muscle_group } of links) {
  await sleep(DELAY_MS)
  const html = await fetch(BASE + href).then(r => r.text())
  exercises.push({ ...parseDetail(html), muscle_group })
}

writeFileSync('exercises-raw.json', JSON.stringify(exercises, null, 2))
```

`parseDetail(html)` wyciąga: `name`, `tags`, `description`, `instructions[]`, `muscles_primary[]`, `muscles_secondary[]`, `tips[]`, `common_mistakes[]` — selektory do ustalenia przy inspekcji HTML strony.

### Uruchomienie

```bash
npm install node-html-parser   # jednorazowo
node scripts/scrape-exercises.mjs
# → exercises-raw.json (~820 wierszy, ~7 min)
```

`.gitignore` — dodaj wpis: `exercises-raw.json`

---

## Faza 2: Claude prompt — exercises SQL

### Co robi Claude

1. Wnioskuje `equipment` z polskiej nazwy ćwiczenia (reguły deterministyczne poniżej)
2. Wnioskuje `difficulty` z nazwy + tagów
3. Generuje INSERT z wszystkimi 10 kolumnami
4. Dodaje 9 ćwiczeń cardio (jako dobry trener personalny — patrz niżej)
5. Usuwa duplikaty (to samo name + muscle_group)

> Pola `description`, `instructions`, `muscles_primary`, `muscles_secondary`, `tips`, `common_mistakes` Claude **przepisuje dosłownie z JSON** — nie modyfikuje ani nie tłumaczy treści ze SmartWorkout.

### Reguły mapowania equipment (przed wysłaniem do Claude)

| Wzorzec w polskiej nazwie | `equipment` |
|---|---|
| sztanga, martwy ciąg, wyciskanie leżąc (bez hantli) | `barbell` |
| hantle, hantla | `dumbbell` |
| wyciąg, linka, kabel, bloczek | `cable` |
| maszyna, suwnica, prasa, hack squat | `machine` |
| kettlebell, odważnik | `kettlebell` |
| taśma, guma oporowa | `resistance_band` |
| pompki, podciąganie, dipy, plank, przysiad (bez sprzętu), brzuszki, zwis | `bodyweight` |
| (niejednoznaczne) | → Claude decyduje |

### Reguły mapowania difficulty

| Wzorzec | `difficulty` |
|---|---|
| dragon flag, muscle-up, przysiad na jednej nodze, podciąganie z obciążeniem, bułgarski przysiad | `advanced` |
| ćwiczenia z maszyną, podstawowe hantle/wyciąg | `intermediate` |
| pompki, przysiady BW, planki, podstawowe brzuszki, tagi `Mobilność` | `beginner` |
| tag `Cardio` + proste ruchy aerobowe | `beginner` |

### Ćwiczenia cardio (9 szt.) — dobrane jak dobry trener personalny

Claude generuje 9 ćwiczeń cardio (3 per difficulty), których brakuje na SmartWorkout. Kryteria doboru:
- Ćwiczenia sprawdzone klinicznie jako efektywne narzędzia kondycyjne
- Progresja: beginner = niski wpływ, bez specjalistycznego sprzętu; intermediate = umiarkowana intensywność, opcjonalnie kettlebell/skakanka; advanced = wysoka intensywność, może wymagać maszyny
- Każde ćwiczenie ma pełne polskie pola: `description`, `instructions[]`, `muscles_primary[]`, `muscles_secondary[]`, `tips[]`, `common_mistakes[]`

Przykładowe propozycje (Claude może zaproponować inne, lepiej dobrane):
- beginner: Marsz z unoszeniem kolan, Pajacyki, Przysiad z wyskokiem (niski)
- intermediate: Burpees, Kettlebell Swing, Bieg w miejscu z wysokim unoszeniem kolan
- advanced: Tabata Burpees, Sprint na rowerku stacjonarnym (interwały), Battle Ropes

### Prompt do Claude

```
Jesteś generatorem danych SQL dla aplikacji fitness. Działasz jak doświadczony trener personalny
z certyfikatem NSCA-CSCS.

SCHEMAT TABELI exercises:
  name TEXT, muscle_group muscle_group_enum, difficulty experience_level_enum,
  equipment TEXT, description TEXT, instructions TEXT[], muscles_primary TEXT[],
  muscles_secondary TEXT[], tips TEXT[], common_mistakes TEXT[]

DOZWOLONE WARTOŚCI:
- muscle_group: chest | back | shoulders | arms | core | legs | glutes | cardio
- difficulty: beginner | intermediate | advanced
- equipment: barbell | dumbbell | bodyweight | machine | cable | resistance_band | kettlebell

ZASADY:
1. Dla każdego ćwiczenia z JSON:
   - Przepisz dosłownie: description, instructions, muscles_primary, muscles_secondary, tips, common_mistakes
   - Wywnioskuj equipment (reguły w plikach projektowych) i difficulty (z nazwy + tagów)
   - Użyj pola `name` z JSON (polska nazwa)
   - Pomiń ćwiczenia z niejednoznacznym equipment (których nie możesz sklasyfikować)
   - Usuń duplikaty (to samo name + muscle_group)
2. Dodaj dokładnie 9 ćwiczeń cardio (muscle_group='cardio', 3×beginner/intermediate/advanced)
   jako ekspert: wybierz ćwiczenia sprawdzone w treningu kardio, z pełnymi polami po polsku

WEJŚCIE (JSON, partie po 200 wierszy):
<wklej fragment exercises-raw.json>

WYJŚCIE — wyłącznie poprawny SQL, bez komentarzy:
INSERT INTO exercises (name, muscle_group, difficulty, equipment, description,
  instructions, muscles_primary, muscles_secondary, tips, common_mistakes) VALUES
(
  'Podciąganie nachwytem',
  'back',
  'advanced',
  'bodyweight',
  'Podciąganie nachwytem to ćwiczenie siłowe...',
  ARRAY['Stań pod drążkiem...', 'Zawieś się...'],
  ARRAY['Plecy'],
  ARRAY['Bicepsy', 'Przedramiona'],
  ARRAY['Utrzymuj napięcie brzucha...'],
  ARRAY['Używanie siły rąk zamiast mięśni pleców...']
),
...;
```

---

## Faza 3: Claude prompt — workout_templates SQL

### Dlaczego Claude, nie scraping

SmartWorkout's plany treningowe są wyłącznie za paywallem aplikacji mobilnej. Strona nie udostępnia żadnych szablonów publicznie.

### 8 szablonów treningowych (dobór jak profesjonalny trener personalny)

Szablony muszą reprezentować programy, które certyfikowany trener personalny (NSCA/ACE/NASM) by przepisał swoim klientom: uzasadniony dobór ćwiczeń, odpowiednia objętość i intensywność dla podanego poziomu, zbilansowane pokrycie grup mięśniowych.

| Nazwa | target_goal | preferred_style | difficulty |
|---|---|---|---|
| Siłowy — Pełne Ciało (Początkujący) | strength | full_body | beginner |
| Hipertrofia — Push Pull Nogi | hypertrophy | push_pull_legs | intermediate |
| Ogólna Sprawność — Obwodowy (Początkujący) | general_fitness | circuit | beginner |
| Redukcja — Pełne Ciało (Średniozaawansowany) | fat_loss | full_body | intermediate |
| Siłowy — Góra/Dół (Średniozaawansowany) | strength | upper_lower | intermediate |
| Hipertrofia — Pełne Ciało (Zaawansowany) | hypertrophy | full_body | advanced |
| Wytrzymałość Cardio — Obwodowy | cardio_endurance | circuit | intermediate |
| Siłowy — Push Pull Nogi (Zaawansowany) | strength | push_pull_legs | advanced |

Każdy szablon: 6–8 ćwiczeń z `target_sets` i `target_reps` dostosowanymi do celu (np. strength: 3–5 × 3–6 rep; hypertrophy: 3–4 × 8–12 rep; circuit: 3 × 15–20 rep).

### Prompt do Claude

```
Jesteś certyfikowanym trenerem personalnym (NSCA-CSCS) z 10-letnim doświadczeniem.
Wygenerujesz SQL dla tabel workout_templates i workout_template_exercises.

SCHEMATY:
- workout_templates: name TEXT, description TEXT, target_goal training_goal_enum, difficulty experience_level_enum
- workout_template_exercises: template_id UUID, exercise_id UUID, position SMALLINT, target_sets SMALLINT, target_reps SMALLINT

SZABLONY DO WYGENEROWANIA: [tabela 8 szablonów powyżej]

DOSTĘPNE ĆWICZENIA (pełna lista z bazy po seed exercises):
[wklej: SELECT name, muscle_group FROM exercises ORDER BY muscle_group, name]

ZASADY DOBORU ĆWICZEŃ:
- Każdy szablon: 6–8 ćwiczeń logicznie dobranych do celu i stylu
- full_body: równomierne pokrycie wszystkich głównych grup mięśniowych
- push_pull_legs: odpowiedni podział pushing/pulling/nogi per sesja (użyj 2-3 sesje)
- upper_lower: górna połowa / dolna połowa per sesja
- circuit: ćwiczenia o umiarkowanej intensywności, różne grupy na przemian (minimalne przerwy)
- strength: ćwiczenia wielostawowe (compound), niskie powtórzenia, wysokie obciążenie
- hypertrophy: mix compound + izolacja, średnie powtórzenia
- fat_loss/cardio_endurance: wyższe powtórzenia, krótkie przerwy, cardio-friendly
- Używaj tylko ćwiczeń dostępnych w bazie (SELECT powyżej)

WAŻNE: FK przez podzapytania — NIE hardcoduj UUID.

WYJŚCIE — wyłącznie poprawny SQL:
INSERT INTO workout_templates (name, description, target_goal, difficulty) VALUES
('Siłowy — Pełne Ciało (Początkujący)', 'Plan treningowy...', 'strength', 'beginner'),
...;

INSERT INTO workout_template_exercises (template_id, exercise_id, position, target_sets, target_reps) VALUES
(
  (SELECT id FROM workout_templates WHERE name = 'Siłowy — Pełne Ciało (Początkujący)'),
  (SELECT id FROM exercises WHERE name = 'Przysiad ze sztangą'),
  1, 3, 5
),
...;
```

---

## Kolejność bloków w seed.sql

```sql
-- Blok 1: exercises (~820 wierszy)
INSERT INTO exercises (...) VALUES ...;

-- Blok 2: workout_templates (8 wierszy)
INSERT INTO workout_templates (...) VALUES ...;

-- Blok 3: workout_template_exercises (48–64 wierszy)
INSERT INTO workout_template_exercises (...) VALUES ...;
```

---

## Weryfikacja po db reset

```sql
SELECT COUNT(*) FROM exercises;
-- oczekiwane: ≥ 820

SELECT muscle_group, difficulty, COUNT(*)
FROM exercises GROUP BY 1, 2 ORDER BY 1, 2;
-- każda z 24 komórek: ≥ 3 wiersze

SELECT DISTINCT equipment FROM exercises;
SELECT DISTINCT difficulty FROM exercises;
-- tylko dozwolone wartości (CHECK constraint odrzuci błędne)

SELECT COUNT(*) FROM workout_templates;
-- oczekiwane: 8

SELECT wt.name, COUNT(wte.id) as cwiczenia
FROM workout_templates wt
JOIN workout_template_exercises wte ON wte.template_id = wt.id
GROUP BY wt.name ORDER BY wt.name;
-- każdy szablon: 6–8 ćwiczeń
```

---

## Pliki do stworzenia / zmodyfikowania

| Plik | Akcja |
|---|---|
| `supabase/migrations/20260529000001_exercise_detail_fields.sql` | Nowa migracja (Phase 2 planu) |
| `scripts/scrape-exercises.mjs` | Nowy scraper |
| `exercises-raw.json` | Tymczasowy output (dodaj do .gitignore) |
| `supabase/seed.sql` | Finalna wersja (3 bloki INSERT) |
| `src/types.ts` | Aktualizacja interfejsu Exercise (Phase 4 planu) |
