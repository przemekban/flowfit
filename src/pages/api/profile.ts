import type { APIRoute } from "astro";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { onboardingSchema } from "@/lib/validation/profile";
import { createUserProfile } from "@/lib/services/profile";

function isPostgrestError(err: unknown): err is PostgrestError {
  return typeof err === "object" && err !== null && "code" in err;
}

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(`/onboarding?error=${encodeURIComponent("Invalid submission")}`);
  }

  const payload = {
    training_goal: form.get("training_goal"),
    experience_level: form.get("experience_level"),
    equipment: form.getAll("equipment"),
    preferred_style: form.get("preferred_style"),
    sessions_per_week: form.get("sessions_per_week"),
  };

  const result = onboardingSchema.safeParse(payload);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid submission";
    return context.redirect(`/onboarding?error=${encodeURIComponent(message)}`);
  }

  try {
    await createUserProfile(supabase, context.locals.user.id, result.data);
  } catch (err) {
    if (isPostgrestError(err) && err.code === "23505") {
      console.error("Duplicate profile submission", { userId: context.locals.user.id });
      return context.redirect("/dashboard");
    }
    const message = err instanceof Error ? err.message : "Failed to save profile";
    return context.redirect(`/onboarding?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/dashboard?saved=1");
};
