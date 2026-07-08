import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";
import { getUserProfile } from "@/lib/services/profile";

const PROTECTED_ROUTES = ["/dashboard", "/onboarding"];
const PROFILE_REQUIRED_ROUTES = ["/dashboard"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (
    context.locals.user &&
    supabase &&
    PROFILE_REQUIRED_ROUTES.some((route) => context.url.pathname.startsWith(route))
  ) {
    const profile = await getUserProfile(supabase, context.locals.user.id);
    if (!profile) {
      return context.redirect("/onboarding");
    }
  }

  return next();
});
