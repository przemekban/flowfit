// ENUM union types — values must match migration ENUMs exactly

export type TrainingGoal = "strength" | "hypertrophy" | "cardio_endurance" | "fat_loss" | "general_fitness";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";

export type PreferredStyle = "full_body" | "push_pull_legs" | "upper_lower" | "circuit";

export type MuscleGroup = "chest" | "back" | "shoulders" | "arms" | "core" | "legs" | "glutes" | "cardio";

export type WorkoutStatus = "active" | "completed" | "abandoned";

export type WorkoutSource = "ai" | "template" | "custom";

export type TrackingType = "reps" | "duration";

// Entity interfaces — field names match column names, types match DB types

export interface UserProfile {
  id: string;
  training_goal: TrainingGoal;
  experience_level: ExperienceLevel;
  equipment: string[];
  preferred_style: PreferredStyle;
  sessions_per_week: number;
  created_at: string;
  updated_at: string;
}

export interface Exercise {
  id: string;
  name: string;
  muscle_group: MuscleGroup;
  difficulty: ExperienceLevel;
  equipment: string;
  tracking_type: TrackingType;
  created_at: string;
  description: string | null;
  instructions: string[] | null;
  muscles_primary: string[] | null;
  muscles_secondary: string[] | null;
  tips: string[] | null;
  common_mistakes: string[] | null;
}

export interface WorkoutTemplate {
  id: string;
  name: string;
  description: string | null;
  target_goal: TrainingGoal | null;
  difficulty: ExperienceLevel | null;
  created_at: string;
}

export interface WorkoutTemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  position: number;
  target_sets: number | null;
  target_reps: number | null;
  target_duration_seconds: number | null;
}

export interface Workout {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  source: WorkoutSource;
  template_id: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkoutExercise {
  id: string;
  workout_id: string;
  exercise_id: string;
  position: number;
  target_sets: number | null;
  target_reps: number | null;
  target_duration_seconds: number | null;
}

export interface UserPlanItem {
  id: string;
  user_id: string;
  workout_id: string;
  position: number;
  created_at: string;
}

export interface WorkoutSession {
  id: string;
  user_id: string;
  workout_id: string;
  status: WorkoutStatus;
  started_at: string;
  completed_at: string | null;
}

export interface WorkoutSet {
  id: string;
  workout_session_id: string;
  exercise_id: string;
  set_number: number;
  reps: number | null;
  weight_kg: number | null;
  duration_seconds: number | null;
  notes: string | null;
  logged_at: string;
}

// DTO types for common API response shapes

export type WorkoutWithExercises = Workout & {
  exercises: (WorkoutExercise & { exercise: Exercise })[];
};

export type ActivePlanWorkout = WorkoutWithExercises & { position: number };

export type WorkoutSessionWithSets = WorkoutSession & {
  workout: Workout;
  sets: (WorkoutSet & { exercise: Exercise })[];
};

export type LastLoggedSets = Record<string, WorkoutSet | null>;

export interface PreviousExerciseBest {
  best_weight_kg: number | null;
  best_duration_seconds: number | null;
}

export type ExerciseBestsMap = Record<string, PreviousExerciseBest | null>;

export type ExerciseImprovementMap = Record<string, boolean>;
