import type { APIRoute } from "astro";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { getSessionWithSets, completeSession } from "@/lib/services/session";
import type { WorkoutSessionWithSets } from "@/types";

export const prerender = false;

function isPostgrestError(err: unknown): err is PostgrestError {
  return typeof err === "object" && err !== null && "code" in err;
}

async function loadOwnedSession(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
): Promise<WorkoutSessionWithSets | null> {
  try {
    const session = await getSessionWithSets(supabase, sessionId);
    return session.user_id === userId ? session : null;
  } catch (err) {
    if (isPostgrestError(err) && err.code === "PGRST116") {
      return null;
    }
    throw err;
  }
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = context.locals.user.id;

  const sessionId = context.params.sessionId;
  if (!sessionId) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return Response.json({ error: "db_error", message: "Supabase is not configured" }, { status: 500 });
  }

  let session: WorkoutSessionWithSets | null;
  try {
    session = await loadOwnedSession(supabase, sessionId, userId);
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
