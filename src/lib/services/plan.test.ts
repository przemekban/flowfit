import { describe, expect, it } from "vitest";
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
