import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { ExerciseBestsMap, ExerciseImprovementMap, TrackingType } from "@/types";

interface PreviousExerciseBestRow {
  exercise_id: string;
  best_weight_kg: number | null;
  best_duration_seconds: number | null;
}

export async function getPreviousExerciseBests(
  supabase: SupabaseClient,
  exerciseIds: string[],
  beforeSessionId: string,
): Promise<ExerciseBestsMap> {
  const result: ExerciseBestsMap = Object.fromEntries(exerciseIds.map((id) => [id, null]));

  if (exerciseIds.length === 0) {
    return result;
  }

  const { data, error } = (await supabase.rpc("get_previous_exercise_bests", {
    p_exercise_ids: exerciseIds,
    p_before_session_id: beforeSessionId,
  })) as { data: PreviousExerciseBestRow[] | null; error: PostgrestError | null };

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    result[row.exercise_id] = { best_weight_kg: row.best_weight_kg, best_duration_seconds: row.best_duration_seconds };
  }

  return result;
}

interface BestableSet {
  exercise_id: string;
  weight_kg: number | null;
  duration_seconds: number | null;
}

function maxNullable(next: number | null, prev: number | null): number | null {
  if (next == null) return prev;
  return prev == null ? next : Math.max(next, prev);
}

export function aggregateSessionBests(sets: BestableSet[]): ExerciseBestsMap {
  const result: ExerciseBestsMap = {};

  for (const set of sets) {
    const existing = result[set.exercise_id] ?? { best_weight_kg: null, best_duration_seconds: null };
    result[set.exercise_id] = {
      best_weight_kg: maxNullable(set.weight_kg, existing.best_weight_kg),
      best_duration_seconds: maxNullable(set.duration_seconds, existing.best_duration_seconds),
    };
  }

  return result;
}

export function computeImprovements(
  currentBests: ExerciseBestsMap,
  previousBests: ExerciseBestsMap,
  trackingByExercise: Record<string, TrackingType>,
): ExerciseImprovementMap {
  const result: ExerciseImprovementMap = {};

  for (const [exerciseId, trackingType] of Object.entries(trackingByExercise)) {
    const current = currentBests[exerciseId];
    const previous = previousBests[exerciseId];
    const currentValue = trackingType === "reps" ? current?.best_weight_kg : current?.best_duration_seconds;
    const previousValue = trackingType === "reps" ? previous?.best_weight_kg : previous?.best_duration_seconds;

    result[exerciseId] = currentValue != null && previousValue != null && currentValue > previousValue;
  }

  return result;
}
