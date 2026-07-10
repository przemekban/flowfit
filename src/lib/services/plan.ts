import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Exercise, UserProfile } from "@/types";
import {
  buildPlanSchema,
  buildPlanGenerationSchema,
  MIN_EXERCISES_PER_WORKOUT,
  type PlanOutput,
} from "@/lib/validation/plan";

const GEMINI_MODEL = "gemini-3.1-flash-lite";

export type CandidateExercise = Pick<
  Exercise,
  "id" | "name" | "muscle_group" | "equipment" | "difficulty" | "tracking_type"
>;

export class PlanValidationError extends Error {}

export async function getCandidateExercises(
  supabase: SupabaseClient,
  profile: UserProfile,
): Promise<CandidateExercise[]> {
  const { data, error } = (await supabase
    .from("exercises")
    .select("id, name, muscle_group, equipment, difficulty, tracking_type")
    .in("equipment", profile.equipment)
    .lte("difficulty", profile.experience_level)) as {
    data: CandidateExercise[] | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }

  return data ?? [];
}

function buildSystemPrompt(): string {
  return [
    "You are a certified strength and conditioning coach building a personalized weekly training plan.",
    "You must select exercises exclusively from the candidate list provided by the user, referencing each one by its numeric id — never invent an id outside the given range.",
    "Respect the user's preferred training style: 'full_body' may reasonably repeat compound lifts across sessions,",
    "while 'push_pull_legs' and 'upper_lower' should specialize each workout by muscle group. Avoid excessive repetition otherwise.",
    "For each exercise, set target_reps if its tracking_type is 'reps', or target_duration_seconds if its tracking_type is 'duration' — never both.",
  ].join(" ");
}

function buildUserPrompt(profile: UserProfile, candidates: CandidateExercise[]): string {
  const candidateList = candidates.map((c, id) => `${id}|${c.name}|${c.muscle_group}|${c.tracking_type}`).join("\n");

  return [
    "User profile:",
    `- training_goal: ${profile.training_goal}`,
    `- experience_level: ${profile.experience_level}`,
    `- equipment: ${profile.equipment.join(", ")}`,
    `- preferred_style: ${profile.preferred_style}`,
    `- sessions_per_week: ${profile.sessions_per_week}`,
    "",
    "Candidate exercises, one per line as id|name|muscle_group|tracking_type (choose id only from this list):",
    candidateList,
    "",
    `Generate exactly ${profile.sessions_per_week} workouts for the week, each with 4-8 exercises.`,
  ].join("\n");
}

export async function generateTrainingPlan(
  client: GoogleGenAI,
  profile: UserProfile,
  candidates: CandidateExercise[],
): Promise<PlanOutput> {
  if (candidates.length < MIN_EXERCISES_PER_WORKOUT) {
    throw new PlanValidationError(
      `Not enough exercises match your equipment and experience level (found ${candidates.length}, need at least ${MIN_EXERCISES_PER_WORKOUT}). Try selecting more equipment types during onboarding.`,
    );
  }

  const generationSchema = buildPlanGenerationSchema(profile.sessions_per_week, candidates.length);
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(generationSchema);
  delete jsonSchema.$schema;

  const userPrompt = buildUserPrompt(profile, candidates);
  const systemPrompt = buildSystemPrompt();
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
    },
  });

  const text = response.text;
  if (!text) {
    throw new PlanValidationError("Gemini response did not include any content");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    throw new PlanValidationError("Gemini response was not valid JSON");
  }

  const generationResult = generationSchema.safeParse(parsedJson);
  if (!generationResult.success) {
    throw new PlanValidationError(
      `Gemini response did not match the expected schema: ${generationResult.error.message}`,
    );
  }

  const plan: PlanOutput = {
    workouts: generationResult.data.workouts.map((workout) => ({
      ...workout,
      exercises: workout.exercises.map(({ id: candidateIndex, ...rest }) => ({
        ...rest,
        exercise_id: candidates[candidateIndex].id,
      })),
    })),
  };

  const result = buildPlanSchema(profile.sessions_per_week).safeParse(plan);
  if (!result.success) {
    throw new PlanValidationError(`Mapped plan did not match the expected schema: ${result.error.message}`);
  }

  return result.data;
}

export function validatePlanAgainstCandidates(plan: PlanOutput, candidates: CandidateExercise[]): PlanOutput {
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  for (const workout of plan.workouts) {
    const seenExerciseIds = new Set<string>();

    for (const exercise of workout.exercises) {
      const candidate = candidateMap.get(exercise.exercise_id);
      if (!candidate) {
        throw new PlanValidationError(`exercise_id ${exercise.exercise_id} is not in the candidate set`);
      }

      if (seenExerciseIds.has(exercise.exercise_id)) {
        throw new PlanValidationError(
          `exercise_id ${exercise.exercise_id} appears more than once in "${workout.name}"`,
        );
      }
      seenExerciseIds.add(exercise.exercise_id);

      if (candidate.tracking_type === "reps") {
        if (exercise.target_reps === undefined || exercise.target_duration_seconds !== undefined) {
          throw new PlanValidationError(
            `exercise_id ${exercise.exercise_id} (reps-tracked) must set target_reps and not target_duration_seconds`,
          );
        }
      } else {
        if (exercise.target_duration_seconds === undefined || exercise.target_reps !== undefined) {
          throw new PlanValidationError(
            `exercise_id ${exercise.exercise_id} (duration-tracked) must set target_duration_seconds and not target_reps`,
          );
        }
      }
    }
  }

  return plan;
}
