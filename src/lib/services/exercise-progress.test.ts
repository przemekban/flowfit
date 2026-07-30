import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExerciseBestsMap, TrackingType } from "@/types";
import { aggregateSessionBests, computeImprovements, getPreviousExerciseBests } from "./exercise-progress";

describe("getPreviousExerciseBests", () => {
  it("returns {} without calling .rpc() for an empty exercise id list", async () => {
    const rpcMock = vi.fn();
    const supabase = { rpc: rpcMock } as unknown as SupabaseClient;

    const result = await getPreviousExerciseBests(supabase, [], "session-current");

    expect(result).toEqual({});
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps returned rows into a null-filled record, leaving unmatched ids null", async () => {
    const rpcMock = vi.fn(() =>
      Promise.resolve({
        data: [{ exercise_id: "exercise-1", best_weight_kg: 55, best_duration_seconds: null }],
        error: null,
      }),
    );
    const supabase = { rpc: rpcMock } as unknown as SupabaseClient;

    const result = await getPreviousExerciseBests(supabase, ["exercise-1", "exercise-2"], "session-current");

    expect(rpcMock).toHaveBeenCalledWith("get_previous_exercise_bests", {
      p_exercise_ids: ["exercise-1", "exercise-2"],
      p_before_session_id: "session-current",
    });
    expect(result).toEqual({
      "exercise-1": { best_weight_kg: 55, best_duration_seconds: null },
      "exercise-2": null,
    });
  });

  it("rejects with the PostgrestError unchanged when the RPC call fails", async () => {
    const rpcError = { code: "42883", message: "function does not exist" };
    const rpcMock = vi.fn(() => Promise.resolve({ data: null, error: rpcError }));
    const supabase = { rpc: rpcMock } as unknown as SupabaseClient;

    await expect(getPreviousExerciseBests(supabase, ["exercise-1"], "session-current")).rejects.toEqual(rpcError);
  });
});

describe("aggregateSessionBests", () => {
  it("returns {} for empty input", () => {
    expect(aggregateSessionBests([])).toEqual({});
  });

  it("picks the max weight across multiple sets of the same exercise", () => {
    const result = aggregateSessionBests([
      { exercise_id: "exercise-1", weight_kg: 40, duration_seconds: null },
      { exercise_id: "exercise-1", weight_kg: 60, duration_seconds: null },
      { exercise_id: "exercise-1", weight_kg: 50, duration_seconds: null },
    ]);

    expect(result["exercise-1"]).toEqual({ best_weight_kg: 60, best_duration_seconds: null });
  });

  it("picks the max duration across multiple sets of the same exercise, independently of weight", () => {
    const result = aggregateSessionBests([
      { exercise_id: "exercise-1", weight_kg: null, duration_seconds: 20 },
      { exercise_id: "exercise-1", weight_kg: null, duration_seconds: 45 },
    ]);

    expect(result["exercise-1"]).toEqual({ best_weight_kg: null, best_duration_seconds: 45 });
  });

  it("yields best_weight_kg: null for an all-null-weight (bodyweight) exercise", () => {
    const result = aggregateSessionBests([
      { exercise_id: "exercise-1", weight_kg: null, duration_seconds: null },
      { exercise_id: "exercise-1", weight_kg: null, duration_seconds: null },
    ]);

    expect(result["exercise-1"]).toEqual({ best_weight_kg: null, best_duration_seconds: null });
  });
});

describe("computeImprovements", () => {
  const trackingByExercise: Record<string, TrackingType> = {
    "exercise-reps": "reps",
    "exercise-duration": "duration",
  };

  it("returns true when the current weight strictly exceeds the previous best", () => {
    const current: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 60, best_duration_seconds: null } };
    const previous: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 50, best_duration_seconds: null } };

    const result = computeImprovements(current, previous, { "exercise-reps": "reps" });

    expect(result["exercise-reps"]).toBe(true);
  });

  it("returns false on a tie (strict > rule, never >=)", () => {
    const current: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 50, best_duration_seconds: null } };
    const previous: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 50, best_duration_seconds: null } };

    const result = computeImprovements(current, previous, { "exercise-reps": "reps" });

    expect(result["exercise-reps"]).toBe(false);
  });

  it("returns false when the current weight is lower than the previous best", () => {
    const current: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 40, best_duration_seconds: null } };
    const previous: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 50, best_duration_seconds: null } };

    const result = computeImprovements(current, previous, { "exercise-reps": "reps" });

    expect(result["exercise-reps"]).toBe(false);
  });

  it("returns false when the previous best is null (first-time exercise) even if current is high", () => {
    const current: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 40, best_duration_seconds: null } };
    const previous: ExerciseBestsMap = { "exercise-reps": null };

    const result = computeImprovements(current, previous, { "exercise-reps": "reps" });

    expect(result["exercise-reps"]).toBe(false);
  });

  it("returns false when the current best is null (exercise planned but not yet logged)", () => {
    const current: ExerciseBestsMap = { "exercise-reps": null };
    const previous: ExerciseBestsMap = { "exercise-reps": { best_weight_kg: 40, best_duration_seconds: null } };

    const result = computeImprovements(current, previous, { "exercise-reps": "reps" });

    expect(result["exercise-reps"]).toBe(false);
  });

  it("compares best_duration_seconds only for a duration-tracked exercise, ignoring weight_kg on either side", () => {
    // Weighted-carry edge case: weight_kg can be non-null on a duration-tracked exercise
    // (workout_sets_tracking_xor only constrains reps XOR duration_seconds). A regression in
    // weight_kg (999 -> 1) must not affect the improvement verdict for a duration-tracked exercise.
    const current: ExerciseBestsMap = { "exercise-duration": { best_weight_kg: 1, best_duration_seconds: 45 } };
    const previous: ExerciseBestsMap = { "exercise-duration": { best_weight_kg: 999, best_duration_seconds: 30 } };

    const result = computeImprovements(current, previous, trackingByExercise);

    expect(result["exercise-duration"]).toBe(true);
  });
});
