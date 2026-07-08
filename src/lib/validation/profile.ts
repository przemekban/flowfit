import { z } from "zod";
import {
  TRAINING_GOALS,
  EXPERIENCE_LEVELS,
  PREFERRED_STYLES,
  EQUIPMENT_OPTIONS,
  SESSIONS_PER_WEEK_MIN,
  SESSIONS_PER_WEEK_MAX,
} from "@/lib/onboarding-options";

const trainingGoalValues = TRAINING_GOALS.map((o) => o.value);
const experienceLevelValues = EXPERIENCE_LEVELS.map((o) => o.value);
const preferredStyleValues = PREFERRED_STYLES.map((o) => o.value);
const equipmentValues = EQUIPMENT_OPTIONS.map((o) => o.value);

export const onboardingSchema = z.object({
  training_goal: z.enum(trainingGoalValues),
  experience_level: z.enum(experienceLevelValues),
  equipment: z.array(z.enum(equipmentValues)).min(1),
  preferred_style: z.enum(preferredStyleValues),
  sessions_per_week: z.coerce.number().int().min(SESSIONS_PER_WEEK_MIN).max(SESSIONS_PER_WEEK_MAX),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
