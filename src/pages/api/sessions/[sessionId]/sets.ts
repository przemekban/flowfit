import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { buildSetLogSchema } from "@/lib/validation/session";
import {
  getSessionOwnership,
  getWorkoutWithExercises,
  upsertSet,
  deleteSet,
  loadOwnedSession,
} from "@/lib/services/session";
import type { WorkoutSession } from "@/types";

export const prerender = false;

const identifyingFieldsSchema = z.object({
  exercise_id: z.uuid(),
  set_number: z.number().int().positive(),
});

function extractExerciseId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const value = (body as Record<string, unknown>).exercise_id;
  return typeof value === "string" ? value : null;
}

const handleSetWrite: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = context.locals.user.id;

  const sessionIdResult = z.uuid().safeParse(context.params.sessionId);
  if (!sessionIdResult.success) {
    return Response.json({ error: "validation_error", message: "sessionId must be a UUID" }, { status: 400 });
  }
  const sessionId = sessionIdResult.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "db_error", message: "Supabase is not configured" }, { status: 500 });
  }

  let session: WorkoutSession | null;
  try {
    session = await loadOwnedSession(() => getSessionOwnership(supabase, sessionId), userId);
  } catch (err) {
    console.error("Failed to load session", { userId, sessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
  if (!session) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (session.status !== "active") {
    return Response.json({ error: "conflict", message: "Session is not active" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const exerciseId = extractExerciseId(body);
  if (!exerciseId) {
    return Response.json({ error: "validation_error", message: "exercise_id is required" }, { status: 400 });
  }

  let workout: Awaited<ReturnType<typeof getWorkoutWithExercises>>;
  try {
    workout = await getWorkoutWithExercises(supabase, userId, session.workout_id);
  } catch (err) {
    console.error("Failed to load workout", { userId, sessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
  const match = workout?.exercises.find((we) => we.exercise_id === exerciseId);
  if (!match) {
    return Response.json(
      { error: "validation_error", message: "exercise_id is not part of this workout" },
      { status: 400 },
    );
  }

  const schema = buildSetLogSchema(match.exercise.tracking_type);
  const result = schema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: "validation_error", issues: result.error.issues }, { status: 400 });
  }

  try {
    const savedSet = await upsertSet(supabase, sessionId, result.data);
    return Response.json(savedSet, { status: 200 });
  } catch (err) {
    console.error("Failed to save set", { userId, sessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
};

export const PUT = handleSetWrite;
export const POST = handleSetWrite;

export const DELETE: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = context.locals.user.id;

  const sessionIdResult = z.uuid().safeParse(context.params.sessionId);
  if (!sessionIdResult.success) {
    return Response.json({ error: "validation_error", message: "sessionId must be a UUID" }, { status: 400 });
  }
  const sessionId = sessionIdResult.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "db_error", message: "Supabase is not configured" }, { status: 500 });
  }

  let session: WorkoutSession | null;
  try {
    session = await loadOwnedSession(() => getSessionOwnership(supabase, sessionId), userId);
  } catch (err) {
    console.error("Failed to load session", { userId, sessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
  if (!session) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (session.status !== "active") {
    return Response.json({ error: "conflict", message: "Session is not active" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = identifyingFieldsSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: "validation_error", issues: result.error.issues }, { status: 400 });
  }

  try {
    await deleteSet(supabase, sessionId, result.data.exercise_id, result.data.set_number);
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error("Failed to delete set", { userId, sessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
};
