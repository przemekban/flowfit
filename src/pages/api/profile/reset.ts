import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { resetUserProfile } from "@/lib/services/profile";
import { hasActiveWorkoutSession } from "@/lib/services/workout-sessions";

export const prerender = false;

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
      return context.redirect(
        `/onboarding?error=${encodeURIComponent("Finish or end your active workout before resetting your profile")}`,
      );
    }

    await resetUserProfile(supabase, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reset profile";
    return context.redirect(`/onboarding?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/onboarding");
};
