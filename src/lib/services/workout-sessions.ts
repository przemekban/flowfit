import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";

export async function hasActiveWorkoutSession(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = (await supabase
    .from("workout_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)) as {
    data: { id: string }[] | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }

  return (data?.length ?? 0) > 0;
}
