import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createGeminiClient } from "@/lib/ai/gemini";
import { getUserProfile } from "@/lib/services/profile";
import {
  getCandidateExercises,
  generateTrainingPlan,
  validatePlanAgainstCandidates,
  PlanValidationError,
} from "@/lib/services/plan";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = context.locals.user.id;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "db_error", message: "Supabase is not configured" }, { status: 500 });
  }

  const profile = await getUserProfile(supabase, userId);
  if (!profile) {
    return Response.json({ error: "profile_missing" }, { status: 409 });
  }

  const gemini = createGeminiClient();
  if (!gemini) {
    console.error("Gemini client is not configured", { userId });
    return Response.json({ error: "ai_error", message: "AI provider is not configured" }, { status: 502 });
  }

  let candidates: Awaited<ReturnType<typeof getCandidateExercises>>;
  try {
    candidates = await getCandidateExercises(supabase, profile);
  } catch (err) {
    console.error("Candidate exercise lookup failed", { userId, cause: err });
    return Response.json(
      { error: "db_error", message: "Failed to load exercises for your training plan" },
      { status: 500 },
    );
  }

  let planPayload: { workouts: unknown[] };
  try {
    const plan = await generateTrainingPlan(gemini, profile, candidates);
    planPayload = validatePlanAgainstCandidates(plan, candidates);
  } catch (err) {
    const isValidationFailure = err instanceof PlanValidationError;
    const message = isValidationFailure ? err.message : "Failed to generate training plan";
    const kind = isValidationFailure ? "validation" : "gemini_call";
    console.error("Plan generation failed", { userId, kind, cause: err });
    return Response.json({ error: "ai_error", message }, { status: 502 });
  }

  const { error: rpcError } = await supabase.rpc("save_generated_training_plan", {
    p_user_id: userId,
    p_workouts: planPayload,
  });

  if (rpcError) {
    console.error("Plan persistence failed", { userId, cause: rpcError });

    // save_generated_training_plan re-checks profile existence inside its own transaction
    // (supabase/migrations/20260723000000_reset_rpc_hardening.sql) - this fires if the profile
    // was reset concurrently while this request was waiting on the Gemini call above.
    if (rpcError.message === "profile_missing") {
      return Response.json(
        {
          error: "profile_missing",
          message: "Your profile was reset while your plan was generating. Please retake the survey and try again.",
        },
        { status: 409 },
      );
    }

    return Response.json({ error: "db_error", message: "Failed to save your training plan" }, { status: 500 });
  }

  return Response.json({ success: true }, { status: 200 });
};
