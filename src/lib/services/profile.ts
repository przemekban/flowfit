import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { UserProfile } from "@/types";
import type { OnboardingInput } from "@/lib/validation/profile";

export async function getUserProfile(supabase: SupabaseClient, userId: string): Promise<UserProfile | null> {
  const { data, error } = (await supabase.from("user_profiles").select("*").eq("id", userId).maybeSingle()) as {
    data: UserProfile | null;
    error: PostgrestError | null;
  };

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
  const { data, error } = (await supabase
    .from("user_profiles")
    .insert({ id: userId, ...input })
    .select()
    .single()) as {
    data: UserProfile | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Insert succeeded but no row was returned");
  }

  return data;
}
