// Single source of truth for onboarding survey vocabulary — consumed by the
// zod schema (src/lib/validation/profile.ts) and the UI components
// (src/components/onboarding/*). Values must match src/types.ts unions and
// the DB CHECK constraints in supabase/migrations/20260529000000_core_schema.sql.

export const TRAINING_GOALS = [
  { value: "strength", label: "Strength" },
  { value: "hypertrophy", label: "Hypertrophy" },
  { value: "cardio_endurance", label: "Cardio & Endurance" },
  { value: "fat_loss", label: "Fat Loss" },
  { value: "general_fitness", label: "General Fitness" },
] as const;

export const EXPERIENCE_LEVELS = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
] as const;

export const PREFERRED_STYLES = [
  { value: "full_body", label: "Full Body" },
  { value: "push_pull_legs", label: "Push / Pull / Legs" },
  { value: "upper_lower", label: "Upper / Lower" },
  { value: "circuit", label: "Circuit" },
] as const;

export const EQUIPMENT_OPTIONS = [
  { value: "barbell", label: "Barbell" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "bodyweight", label: "Bodyweight" },
  { value: "machine", label: "Machine" },
  { value: "cable", label: "Cable" },
  { value: "resistance_band", label: "Resistance Band" },
  { value: "kettlebell", label: "Kettlebell" },
] as const;

export const SESSIONS_PER_WEEK_MIN = 1;
export const SESSIONS_PER_WEEK_MAX = 7;
