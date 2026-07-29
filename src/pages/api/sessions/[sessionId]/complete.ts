import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getSessionOwnership, completeSession, loadOwnedSession } from "@/lib/services/session";
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

  try {
    const updated = await completeSession(supabase, sessionId);
    return Response.json(updated, { status: 200 });
  } catch (err) {
    console.error("Failed to complete session", { userId, sessionId, cause: err });
    return Response.json({ error: "db_error" }, { status: 500 });
  }
};
