---
project: FlowFit
version: 1
status: draft
created: 2026-05-18
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Active people who care about their fitness are not enjoying their workouts. Training plans are boring, repetitive, and poorly matched to the individual — existing tools are either too simple (step counters) or too complex, with steep learning curves that assume the user wants to act as their own coach. The gap lies in between: there is no tool that delivers a genuinely personalized plan without burdening the user with manual configuration or choice paralysis. Friction in the workflow, indecision about which plan to follow, and boredom from repetition drive users away before they see any results.

The insight that makes this product worth building: personalization at the level that previously required a live coach can now be delivered by a software product. This shifts the cost of a tailored training experience from "expensive human expert" to a system that adapts to the individual's stated goal, experience, equipment, and style — on their first login, without manual setup.

## User & Persona

**Primary Persona: Active fitness enthusiast**

An individual who exercises regularly or wants to, but is not a professional trainer or competitive athlete. They know the basics, want to make progress, and have enough motivation to open a training app — but not enough patience to configure it, read documentation, or pick from dozens of plan templates. They experience the core pain at a specific moment: when it is time to plan or start a workout, and they either do not know where to begin or are bored by what they already know.

The product serves individual users, not organizations. Each user has their own account and their own data.

## Success Criteria

### Primary

The user can complete the full end-to-end flow without assistance:

1. Register and log in to their account
2. Complete the onboarding survey (training goal, experience level, available equipment, preferred style, sessions per week)
3. Receive a personalized weekly training plan generated based on their survey profile
4. Launch a workout session and log sets, reps, and weight in real time
5. Finish the workout and see it appear on a chronological history list

The product is considered working when a first-time user can complete this flow from registration to history entry in a single session.

### Secondary

The workout screen (or history view) indicates which exercises the user improved on compared to their most recent previous session — a simple inline signal that a personal record was matched or exceeded.

### Guardrails

- Workout data (sets, reps, weights) must be persistent after a session is saved. Data loss disqualifies the product.
- Each user's data is strictly isolated. No user can view another user's workouts, profile, or results.

## User Stories

### US-01: First Workout After Onboarding

- **Given** a user who has completed the onboarding survey
- **When** they open the "My Plan" section
- **Then** they see a weekly training plan tailored to their stated goal, experience level, and available equipment, with sessions ready to launch

#### Acceptance Criteria

- The plan contains the number of weekly sessions the user specified in the survey
- Each session lists exercises drawn from the exercise library, matched to the user's profile
- The user can launch any session directly from this view

### US-02: Logging Sets During a Workout

- **Given** a user who has launched a workout session
- **When** they complete a set of an exercise
- **Then** they can enter the number of reps and the weight used, and the data is saved immediately

#### Acceptance Criteria

- The input form for reps and weight is reachable in at most two taps from the active exercise
- Data is persisted without requiring a separate explicit save action

### US-03: Browsing Workout History

- **Given** a user who has completed at least one workout
- **When** they open the "History" section
- **Then** they see a chronological list of completed workouts, each showing the date and the recorded results

#### Acceptance Criteria

- The list is sorted newest-first
- Each entry shows the workout date and a summary of recorded data

## Functional Requirements

### Authentication

- **FR-001:** A user can create an account using an email address and password. Priority: must-have
  > Socrates: No counter-argument — auth is necessary; data must be tied to a specific user account. Unchanged.
- **FR-002:** A user can log in to their account (email and password, or via a supported third-party identity provider). Priority: must-have
  > Socrates: Same as FR-001.
- **FR-003:** A user can log out. Priority: must-have
  > Socrates: Same as FR-001.

### Survey & Profiling

- **FR-004:** A user can complete a one-time onboarding survey capturing: training goal, experience level, available equipment, preferred training style, and number of sessions per week. Priority: must-have
  > Socrates: Risk accepted — if the user's goal or equipment changes after the survey, the current plan becomes outdated. No profile editing in MVP; a minimal "reset profile" mechanism may be needed before V2. Tracked as OQ-001.
- **FR-005:** The system saves the user's profile from the survey and uses it as the input for plan generation. Priority: must-have
  > Socrates: Same as FR-004.

### Personalized Planning

- **FR-006:** The system generates a personalized weekly training plan based on the user's survey profile using AI (number of sessions per week = value from the survey). Priority: must-have
  > Socrates: No counter-argument — personalized plan generation is the core value proposition; without it there is no product. Unchanged.

### Exercise Library

- **FR-007:** The system provides a predefined list of exercises categorized by difficulty level and muscle group. The library is seeded by the developer and is not editable by users. Priority: must-have
  > Socrates: No counter-argument — a fixed imported library is sufficient for MVP. Unchanged.

### Workout Screen

- **FR-008:** A user can launch a planned workout session. Priority: must-have
  > Socrates: No counter-argument — launching and logging a session is core MVP. Unchanged.
- **FR-009:** A user can enter the number of sets, reps, and weight for each exercise during a session. Priority: must-have
  > Socrates: Same as FR-008.
- **FR-010:** A user can finish and save a completed workout session. Priority: must-have
  > Socrates: Same as FR-008.

### History

- **FR-011:** A user can view a chronological list of their completed workout sessions. Priority: must-have
  > Socrates: No counter-argument — history is required as proof the product works and closes the primary success flow. Unchanged.
- **FR-012:** The system highlights exercises in which the user improved their result compared to the most recent previous session in which that exercise appeared. Priority: nice-to-have
  > Socrates: No counter-argument against including at nice-to-have priority. Remains in scope.

## Non-Functional Requirements

- Workout actions (logging a set, loading history): p95 response time under 1 second, as perceived by the user.
- Any operation taking longer than 2 seconds must provide continuous visible progress feedback to the user for the full duration of the wait.
- The product must be usable on the current release of Chrome and Safari.

## Business Logic

The system selects the exercise set, session sequence, and difficulty level for each weekly session based on the user's training goal, experience level, available equipment, and preferred training style.

The rule consumes five user-supplied inputs: stated training goal (e.g., strength, hypertrophy, cardio endurance, fat loss); experience level (beginner, intermediate, advanced); available equipment (e.g., full gym, home dumbbells, bodyweight only); preferred training style (e.g., full-body, push-pull-legs, circuit); and the number of sessions per week the user can commit to.

The rule's output is a weekly plan: N personal workouts (where N is the user's stated sessions-per-week), each containing an ordered list of exercises from the exercise library, matched to the user's profile. The plan is stored as an ordered rotation — the app suggests the next workout in the sequence each time the user opens it, based on which workout was completed last, not on the calendar day. In the MVP, the plan is derived solely from the profile captured during onboarding. Historical workout performance is not an input to plan generation in the MVP — adapting the plan based on what the user actually did is scoped to a future version.

## Access Control

Users authenticate with an email address and password. Login via a supported third-party identity provider is also available as an alternative to password-based sign-in.

The role model is flat: all authenticated users have identical permissions. Each user can read and write only their own profile, plan, and workout history. No user can access another user's data.

There is no admin panel in the MVP. The exercise library is seeded by the developer directly, outside the application's user-facing flows.

Unauthenticated requests to any protected route are rejected and redirected to the login screen.

## Future Vision (Post-MVP)

The following capabilities are out of MVP scope but inform architecture decisions — particularly the database schema in F-01. Recording them here ensures that MVP design choices remain compatible with the intended product direction.

- **Editable profile:** The onboarding survey can be re-taken or updated at any time. Changing the profile may trigger a new plan generation. The schema is designed to support this; the UI is deferred. (Resolves OQ-001 at V2.)
- **Workout template library:** A curated set of workout templates seeded by the developer (e.g., "Push Day A", "Full Body Beginner"). Users can browse and copy any template to their personal workout list.
- **Personal workout library:** Users maintain their own list of workouts — copies from the template library, AI-generated workouts, or workouts built from scratch. Each personal workout is fully editable (add/remove exercises, change sets/reps targets).
- **Workout-first navigation:** The primary entry point is a workout list, not a plan page. At the top is the suggested next workout (next in the user's rotation). The user can also pick any workout from their personal library or the system library.
- **Adaptive AI plan generation:** The AI considers workout history (completed sessions, logged weights, progression signals) alongside the survey profile when generating or updating the training plan.

## Non-Goals

- **Adaptive planning (V2):** The system does not analyze workout history to adjust plans or suggest weight progression. This is explicitly scoped to a future version. See Future Vision.
- **Calendar view:** No visual monthly or weekly calendar grid. A simple chronological list is the complete history interface in MVP.
- **Social features:** No workout sharing, friend activity feeds, or competitive leaderboards. The product is private and single-user in its social model.
- **Monetization:** No in-app purchases, subscription paywalls, or advertising. The product is intended to remain free and private.
- **Profile editing:** No in-app form to update onboarding survey answers in MVP. The schema supports it; the UI is deferred to V2. See OQ-001 and Future Vision.
- **Workout template library browser:** The `workout_templates` table is created in F-01 for architectural readiness, but the UI to browse and copy templates is deferred to V2.
- **Personal workout editing UI:** Users cannot edit their workout exercises in MVP — the plan is executed as generated. Editing UI is deferred to V2.

## Open Questions

1. **OQ-001 — Profile update mechanism:** If a user's training goal or available equipment changes after the onboarding survey, the current plan becomes outdated. The MVP has no profile editing flow. A minimal "reset profile and retake survey" option may be needed before the product is viable for users beyond the initial developer-test phase. Owner: product decision. Resolution recommended before shipping to external users.
