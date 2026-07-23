import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { resetUserProfile } from "@/lib/services/profile";
import { hasActiveWorkoutSession } from "@/lib/services/workout-sessions";

export const prerender = false;

const ACTIVE_SESSION_MESSAGE = "Finish or end your active workout before resetting your profile";

// reset_user_profile (supabase/migrations/20260723000000_reset_rpc_hardening.sql) re-checks this
// atomically inside its own transaction and raises 'active_workout_session' if it fails - this
// pre-check is only a fast path, not the enforcement. Never forward a raw RPC/Postgres error
// message to the user; map known exceptions and fall back to a generic message otherwise.
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  active_workout_session: ACTIVE_SESSION_MESSAGE,
};

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  const userId = context.locals.user.id;

  try {
    if (await hasActiveWorkoutSession(supabase, userId)) {
      return context.redirect(`/onboarding?error=${encodeURIComponent(ACTIVE_SESSION_MESSAGE)}`);
    }

    await resetUserProfile(supabase, userId);
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : undefined;
    const message =
      (rawMessage && KNOWN_ERROR_MESSAGES[rawMessage]) ?? "Something went wrong while resetting your profile";
    return context.redirect(`/onboarding?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/onboarding");
};
