import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type {
  Exercise,
  LastLoggedSets,
  Workout,
  WorkoutExercise,
  WorkoutSession,
  WorkoutSessionWithSets,
  WorkoutSet,
  WorkoutWithExercises,
} from "@/types";
import type { SetLogInput } from "@/lib/validation/session";

interface WorkoutRow extends Workout {
  workout_exercises: (WorkoutExercise & { exercises: Exercise })[];
}

export async function getWorkoutWithExercises(
  supabase: SupabaseClient,
  userId: string,
  workoutId: string,
): Promise<WorkoutWithExercises | null> {
  const { data, error } = (await supabase
    .from("workouts")
    .select(
      `
      id, user_id, name, description, source, template_id, is_archived, created_at, updated_at,
      workout_exercises (
        id, workout_id, exercise_id, position, target_sets, target_reps, target_duration_seconds,
        exercises ( * )
      )
    `,
    )
    .eq("id", workoutId)
    .eq("user_id", userId)
    .order("position", { referencedTable: "workout_exercises", ascending: true })
    .maybeSingle()) as {
    data: WorkoutRow | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const { workout_exercises, ...workout } = data;
  return {
    ...workout,
    exercises: workout_exercises.map((we) => ({ ...we, exercise: we.exercises })),
  };
}

export async function getActiveSessionForWorkout(
  supabase: SupabaseClient,
  userId: string,
  workoutId: string,
): Promise<WorkoutSession | null> {
  const { data, error } = (await supabase
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("workout_id", workoutId)
    .eq("status", "active")
    .maybeSingle()) as {
    data: WorkoutSession | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }

  return data;
}

export async function createSession(
  supabase: SupabaseClient,
  userId: string,
  workoutId: string,
): Promise<WorkoutSession> {
  const { data, error } = (await supabase
    .from("workout_sessions")
    .insert({ user_id: userId, workout_id: workoutId })
    .select()
    .single()) as {
    data: WorkoutSession | null;
    error: PostgrestError | null;
  };

  if (error) {
    if (error.code === "23505") {
      const existing = await getActiveSessionForWorkout(supabase, userId, workoutId);
      if (existing) {
        return existing;
      }
    }
    throw error;
  }

  if (!data) {
    throw new Error("Insert succeeded but no row was returned");
  }

  return data;
}

function isPostgrestError(err: unknown): err is PostgrestError {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function loadOwnedSession<T extends { user_id: string }>(
  loader: () => Promise<T>,
  userId: string,
): Promise<T | null> {
  try {
    const session = await loader();
    return session.user_id === userId ? session : null;
  } catch (err) {
    if (isPostgrestError(err) && err.code === "PGRST116") {
      return null;
    }
    throw err;
  }
}

export async function getSessionOwnership(supabase: SupabaseClient, sessionId: string): Promise<WorkoutSession> {
  const { data, error } = (await supabase
    .from("workout_sessions")
    .select("id, user_id, workout_id, status, started_at, completed_at")
    .eq("id", sessionId)
    .single()) as {
    data: WorkoutSession | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Session not found");
  }

  return data;
}

interface SessionWithSetsRow extends WorkoutSession {
  workouts: Workout;
  workout_sets: (WorkoutSet & { exercises: Exercise })[];
}

export async function getSessionWithSets(supabase: SupabaseClient, sessionId: string): Promise<WorkoutSessionWithSets> {
  const { data, error } = (await supabase
    .from("workout_sessions")
    .select(
      `
      id, user_id, workout_id, status, started_at, completed_at,
      workouts ( * ),
      workout_sets ( *, exercises ( * ) )
    `,
    )
    .eq("id", sessionId)
    .single()) as {
    data: SessionWithSetsRow | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Session not found");
  }

  const { workouts, workout_sets, ...session } = data;
  return {
    ...session,
    workout: workouts,
    sets: workout_sets.map(({ exercises, ...set }) => ({ ...set, exercise: exercises })),
  };
}

export async function getLastLoggedSets(
  supabase: SupabaseClient,
  userId: string,
  exerciseIds: string[],
  excludeSessionId: string,
): Promise<LastLoggedSets> {
  const result: LastLoggedSets = Object.fromEntries(exerciseIds.map((id) => [id, null]));

  if (exerciseIds.length === 0) {
    return result;
  }

  const { data, error } = (await supabase
    .from("workout_sets")
    .select(
      `
      id, workout_session_id, exercise_id, set_number, reps, weight_kg, duration_seconds, notes, logged_at,
      workout_sessions!inner ( user_id )
    `,
    )
    .in("exercise_id", exerciseIds)
    .eq("workout_sessions.user_id", userId)
    .neq("workout_session_id", excludeSessionId)
    .order("logged_at", { ascending: false })) as {
    data: (WorkoutSet & { workout_sessions: { user_id: string } })[] | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    if (result[row.exercise_id] === null) {
      const { workout_sessions: _workoutSessions, ...set } = row;
      result[row.exercise_id] = set;
    }
  }

  return result;
}

export async function upsertSet(supabase: SupabaseClient, sessionId: string, input: SetLogInput): Promise<WorkoutSet> {
  const { data, error } = (await supabase
    .from("workout_sets")
    .upsert({ workout_session_id: sessionId, ...input }, { onConflict: "workout_session_id,exercise_id,set_number" })
    .select()
    .single()) as {
    data: WorkoutSet | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Upsert succeeded but no row was returned");
  }

  return data;
}

export async function deleteSet(
  supabase: SupabaseClient,
  sessionId: string,
  exerciseId: string,
  setNumber: number,
): Promise<void> {
  const { error } = await supabase
    .from("workout_sets")
    .delete()
    .eq("workout_session_id", sessionId)
    .eq("exercise_id", exerciseId)
    .eq("set_number", setNumber);

  if (error) {
    throw error;
  }
}

export async function completeSession(supabase: SupabaseClient, sessionId: string): Promise<WorkoutSession> {
  const { data, error } = (await supabase
    .from("workout_sessions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", sessionId)
    .select()
    .single()) as {
    data: WorkoutSession | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Update succeeded but no row was returned");
  }

  return data;
}

export async function restartSession(
  supabase: SupabaseClient,
  userId: string,
  existingSessionId: string,
  workoutId: string,
): Promise<string> {
  const { data, error } = (await supabase.rpc("restart_workout_session", {
    p_user_id: userId,
    p_existing_session_id: existingSessionId,
    p_workout_id: workoutId,
  })) as {
    data: string | null;
    error: PostgrestError | null;
  };

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("RPC succeeded but no session id was returned");
  }

  return data;
}
