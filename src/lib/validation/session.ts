import { z } from "zod";
import type { TrackingType } from "@/types";

export function buildSetLogSchema(trackingType: TrackingType) {
  const base = {
    exercise_id: z.uuid(),
    set_number: z.number().int().positive(),
    weight_kg: z.number().nonnegative().optional(),
  };

  if (trackingType === "reps") {
    return z
      .object({
        ...base,
        reps: z.number().int().positive(),
      })
      .strict();
  }

  return z
    .object({
      ...base,
      duration_seconds: z.number().int().positive(),
    })
    .strict();
}

export type SetLogInput = z.infer<ReturnType<typeof buildSetLogSchema>>;
