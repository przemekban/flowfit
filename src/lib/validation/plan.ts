import { z } from "zod";

export const MIN_EXERCISES_PER_WORKOUT = 4;
export const MAX_EXERCISES_PER_WORKOUT = 8;

const planExerciseSchema = z.object({
  exercise_id: z.uuid(),
  target_sets: z.number().int().min(2).max(5),
  target_reps: z.number().int().min(5).max(20).optional(),
  target_duration_seconds: z.number().int().min(15).max(180).optional(),
});

const planWorkoutSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  exercises: z.array(planExerciseSchema).min(MIN_EXERCISES_PER_WORKOUT).max(MAX_EXERCISES_PER_WORKOUT),
});

export function buildPlanSchema(sessionsPerWeek: number) {
  return z.object({
    workouts: z.array(planWorkoutSchema).length(sessionsPerWeek),
  });
}

export type PlanOutput = z.infer<ReturnType<typeof buildPlanSchema>>;

// Gemini chokes on a large string enum nested inside repeated array items
// (works flat, works nested-small, fails nested-large — verified empirically).
// Have the model reference candidates by array index instead; indices are
// mapped back to real exercise_id values after parsing.
export function buildPlanGenerationSchema(sessionsPerWeek: number, candidateCount: number) {
  const genExerciseSchema = z.object({
    id: z
      .number()
      .int()
      .min(0)
      .max(Math.max(candidateCount - 1, 0)),
    target_sets: z.number().int().min(2).max(5),
    target_reps: z.number().int().min(5).max(20).optional(),
    target_duration_seconds: z.number().int().min(15).max(180).optional(),
  });

  const genWorkoutSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    exercises: z.array(genExerciseSchema).min(MIN_EXERCISES_PER_WORKOUT).max(MAX_EXERCISES_PER_WORKOUT),
  });

  return z.object({
    workouts: z.array(genWorkoutSchema).length(sessionsPerWeek),
  });
}

export type PlanGenerationOutput = z.infer<ReturnType<typeof buildPlanGenerationSchema>>;
