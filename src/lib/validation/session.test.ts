import { describe, expect, it } from "vitest";
import { buildSetLogSchema } from "./session";

const exerciseId = "11111111-1111-4111-8111-111111111111";

describe("buildSetLogSchema", () => {
  it("accepts a valid reps-tracked input", () => {
    const schema = buildSetLogSchema("reps");
    const result = schema.safeParse({ exercise_id: exerciseId, set_number: 1, weight_kg: 40, reps: 10 });
    expect(result.success).toBe(true);
  });

  it("accepts a valid duration-tracked input", () => {
    const schema = buildSetLogSchema("duration");
    const result = schema.safeParse({ exercise_id: exerciseId, set_number: 1, duration_seconds: 30 });
    expect(result.success).toBe(true);
  });

  it("rejects reps-tracked input with duration_seconds set", () => {
    const schema = buildSetLogSchema("reps");
    const result = schema.safeParse({
      exercise_id: exerciseId,
      set_number: 1,
      reps: 10,
      duration_seconds: 30,
    });
    expect(result.success).toBe(false);
  });

  it("rejects reps-tracked input missing reps", () => {
    const schema = buildSetLogSchema("reps");
    const result = schema.safeParse({ exercise_id: exerciseId, set_number: 1, weight_kg: 40 });
    expect(result.success).toBe(false);
  });

  it("rejects negative weight_kg", () => {
    const schema = buildSetLogSchema("reps");
    const result = schema.safeParse({ exercise_id: exerciseId, set_number: 1, reps: 10, weight_kg: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects input missing exercise_id", () => {
    const schema = buildSetLogSchema("reps");
    const result = schema.safeParse({ set_number: 1, reps: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects input missing set_number", () => {
    const schema = buildSetLogSchema("reps");
    const result = schema.safeParse({ exercise_id: exerciseId, reps: 10 });
    expect(result.success).toBe(false);
  });
});
