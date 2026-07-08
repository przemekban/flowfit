import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/types";
import type { OnboardingInput } from "@/lib/validation/profile";

export async function getUserProfile(supabase: SupabaseClient, userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle()
    .overrideTypes<UserProfile, { merge: false }>();

  if (error) {
    throw error;
  }

  return data;
}

export async function createUserProfile(
  supabase: SupabaseClient,
  userId: string,
  input: OnboardingInput,
): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("user_profiles")
    .insert({ id: userId, ...input })
    .select()
    .single()
    .overrideTypes<UserProfile, { merge: false }>();

  if (error) {
    throw error;
  }

  return data;
}
