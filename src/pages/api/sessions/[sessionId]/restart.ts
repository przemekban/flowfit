import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import {
  getSessionOwnership,
  getSessionWithSets,
  getWorkoutWithExercises,
  getLastLoggedSets,
  restartSession,
  loadOwnedSession,
} from "@/lib/services/session";
import type { WorkoutSession } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = context.locals.user.id;

  const sessionIdResult = z.uuid().safeParse(context.params.sessionId);
  if (!sessionIdResult.success) {
    return Response.json({ error: "validation_error", message: "sessionId must be a UUID" }, { status: 400 });
  }
  const existingSessionId = sessionIdResult.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "db_error", message: "Supabase is not configured" }, { status: 500 });
  }

  let existingSession: WorkoutSession | null;
  try {
    existingSession = await loadOwnedSession(() => getSessionOwnership(supabase, existingSessionId), userId);
  } catch (err) {
    console.error("Failed to load session", { userId, sessionId: existingSessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
  if (!existingSession) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (existingSession.status !== "active") {
    return Response.json({ error: "conflict", message: "Session is not active" }, { status: 409 });
  }

  try {
    const workoutPromise = getWorkoutWithExercises(supabase, userId, existingSession.workout_id);
    const newSessionId = await restartSession(supabase, userId, existingSessionId, existingSession.workout_id);
    const workout = await workoutPromise;

    const exerciseIds = workout?.exercises.map((we) => we.exercise_id) ?? [];
    const [newSession, lastLoggedSets] = await Promise.all([
      getSessionWithSets(supabase, newSessionId),
      getLastLoggedSets(supabase, userId, exerciseIds, newSessionId),
    ]);

    return Response.json({ session: newSession, lastLoggedSets }, { status: 200 });
  } catch (err) {
    console.error("Failed to restart session", { userId, sessionId: existingSessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
};
