import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const signupSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Invalid submission")}`);
  }

  const result = signupSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid submission";
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
  }
  const { email, password } = result.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
