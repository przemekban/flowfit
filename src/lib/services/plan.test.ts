import { describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import type { UserProfile } from "@/types";
import {
  PlanValidationError,
  generateTrainingPlan,
  validatePlanAgainstCandidates,
  type CandidateExercise,
} from "./plan";
import { MIN_EXERCISES_PER_WORKOUT } from "@/lib/validation/plan";
import type { PlanOutput } from "@/lib/validation/plan";

const baseProfile: UserProfile = {
  id: "user-1",
  training_goal: "strength",
  experience_level: "beginner",
  equipment: ["barbell"],
  preferred_style: "full_body",
  sessions_per_week: 3,
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
};

function makeCandidate(overrides: Partial<CandidateExercise> = {}): CandidateExercise {
  return {
    id: "exercise-1",
    name: "Bench Press",
    muscle_group: "chest",
    equipment: "barbell",
    difficulty: "beginner",
    tracking_type: "reps",
    ...overrides,
  };
}

function buildGeminiClient(responseText: string | undefined): GoogleGenAI {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: responseText }),
    },
  } as unknown as GoogleGenAI;
}

const validUuids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];

function buildGenerationPayload(sessionsPerWeek: number, candidateCount: number) {
  return {
    workouts: Array.from({ length: sessionsPerWeek }, (_, workoutIndex) => ({
      name: `Day ${workoutIndex + 1}`,
      exercises: Array.from({ length: MIN_EXERCISES_PER_WORKOUT }, (_, i) => ({
        id: i % candidateCount,
        target_sets: 3,
        target_reps: 10,
      })),
    })),
  };
}

describe("generateTrainingPlan", () => {
  it("rejects with PlanValidationError and never touches the Gemini client when candidates is empty", async () => {
    const stubClient = {} as GoogleGenAI;

    await expect(generateTrainingPlan(stubClient, baseProfile, [])).rejects.toBeInstanceOf(PlanValidationError);
  });

  it("rejects with PlanValidationError at the MIN_EXERCISES_PER_WORKOUT - 1 boundary, never touching the Gemini client", async () => {
    const stubClient = {} as GoogleGenAI;
    const candidates = Array.from({ length: MIN_EXERCISES_PER_WORKOUT - 1 }, (_, i) =>
      makeCandidate({ id: `exercise-${i}` }),
    );

    await expect(generateTrainingPlan(stubClient, baseProfile, candidates)).rejects.toBeInstanceOf(PlanValidationError);
  });

  describe("Gemini response handling", () => {
    const candidates = validUuids.map((id) => makeCandidate({ id }));
    const profile: UserProfile = { ...baseProfile, sessions_per_week: 3 };

    it("golden path: a well-formed response is parsed, remapped to real exercise_ids, and re-validated", async () => {
      const payload = buildGenerationPayload(profile.sessions_per_week, candidates.length);
      const client = buildGeminiClient(JSON.stringify(payload));

      const result = await generateTrainingPlan(client, profile, candidates);

      expect(result.workouts).toHaveLength(profile.sessions_per_week);
      for (const workout of result.workouts) {
        workout.exercises.forEach((exercise, exerciseIndex) => {
          const candidateIndex = exerciseIndex % candidates.length;
          expect(exercise.exercise_id).toBe(candidates[candidateIndex].id);
        });
      }
    });

    it("rejects with PlanValidationError when response.text is empty", async () => {
      const client = buildGeminiClient("");

      await expect(generateTrainingPlan(client, profile, candidates)).rejects.toBeInstanceOf(PlanValidationError);
    });

    it("rejects with PlanValidationError when response.text is undefined", async () => {
      const client = buildGeminiClient(undefined);

      await expect(generateTrainingPlan(client, profile, candidates)).rejects.toBeInstanceOf(PlanValidationError);
    });

    it("rejects with PlanValidationError when response.text is not valid JSON", async () => {
      const client = buildGeminiClient("this is not json{");

      await expect(generateTrainingPlan(client, profile, candidates)).rejects.toBeInstanceOf(PlanValidationError);
    });

    it("rejects with PlanValidationError when an exercise is missing a required field (target_sets)", async () => {
      const payload = buildGenerationPayload(profile.sessions_per_week, candidates.length);
      const { target_sets: _omitted, ...rest } = payload.workouts[0].exercises[0];
      payload.workouts[0].exercises[0] = rest as (typeof payload.workouts)[0]["exercises"][0];
      const client = buildGeminiClient(JSON.stringify(payload));

      await expect(generateTrainingPlan(client, profile, candidates)).rejects.toBeInstanceOf(PlanValidationError);
    });

    it("rejects with PlanValidationError when an exercise references an out-of-range candidate index", async () => {
      const payload = buildGenerationPayload(profile.sessions_per_week, candidates.length);
      payload.workouts[0].exercises[0].id = candidates.length;
      const client = buildGeminiClient(JSON.stringify(payload));

      await expect(generateTrainingPlan(client, profile, candidates)).rejects.toBeInstanceOf(PlanValidationError);
    });

    it("rejects with PlanValidationError when the post-remap plan fails re-validation (candidate id is not a UUID)", async () => {
      const candidatesWithInvalidId = [makeCandidate({ id: "not-a-uuid" }), ...candidates.slice(1)];
      const payload = buildGenerationPayload(profile.sessions_per_week, candidatesWithInvalidId.length);
      const client = buildGeminiClient(JSON.stringify(payload));

      await expect(generateTrainingPlan(client, profile, candidatesWithInvalidId)).rejects.toBeInstanceOf(
        PlanValidationError,
      );
    });
  });
});

describe("validatePlanAgainstCandidates", () => {
  const repsCandidate = makeCandidate({ id: "exercise-reps", tracking_type: "reps" });
  const durationCandidate = makeCandidate({ id: "exercise-duration", tracking_type: "duration" });
  const candidates = [repsCandidate, durationCandidate];

  it("passes a valid plan through unchanged", () => {
    const plan: PlanOutput = {
      workouts: [
        {
          name: "Day 1",
          exercises: [
            { exercise_id: "exercise-reps", target_sets: 3, target_reps: 10 },
            { exercise_id: "exercise-duration", target_sets: 3, target_duration_seconds: 30 },
          ],
        },
      ],
    };

    expect(validatePlanAgainstCandidates(plan, candidates)).toEqual(plan);
  });

  it("throws when an exercise_id is not in the candidate set", () => {
    const plan: PlanOutput = {
      workouts: [
        {
          name: "Day 1",
          exercises: [{ exercise_id: "not-a-candidate", target_sets: 3, target_reps: 10 }],
        },
      ],
    };

    expect(() => validatePlanAgainstCandidates(plan, candidates)).toThrow(PlanValidationError);
  });

  it("throws when an exercise_id appears more than once within one workout", () => {
    const plan: PlanOutput = {
      workouts: [
        {
          name: "Day 1",
          exercises: [
            { exercise_id: "exercise-reps", target_sets: 3, target_reps: 10 },
            { exercise_id: "exercise-reps", target_sets: 3, target_reps: 8 },
          ],
        },
      ],
    };

    expect(() => validatePlanAgainstCandidates(plan, candidates)).toThrow(PlanValidationError);
  });

  it("throws when a reps-tracked exercise sets target_duration_seconds instead of target_reps", () => {
    const plan: PlanOutput = {
      workouts: [
        {
          name: "Day 1",
          exercises: [{ exercise_id: "exercise-reps", target_sets: 3, target_duration_seconds: 30 }],
        },
      ],
    };

    expect(() => validatePlanAgainstCandidates(plan, candidates)).toThrow(PlanValidationError);
  });

  it("throws when a duration-tracked exercise sets target_reps instead of target_duration_seconds", () => {
    const plan: PlanOutput = {
      workouts: [
        {
          name: "Day 1",
          exercises: [{ exercise_id: "exercise-duration", target_sets: 3, target_reps: 10 }],
        },
      ],
    };

    expect(() => validatePlanAgainstCandidates(plan, candidates)).toThrow(PlanValidationError);
  });
});
