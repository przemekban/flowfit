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

  let planPayload: { workouts: unknown[] };
  try {
    const candidates = await getCandidateExercises(supabase, profile);
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
    return Response.json({ error: "db_error", message: rpcError.message }, { status: 500 });
  }

  return Response.json({ success: true }, { status: 200 });
};
