import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostgrestError } from "@supabase/supabase-js";
import { restartSession } from "@/lib/services/session";
import { setupTwoUsers, teardownTwoUsers, type TestIdentity } from "./fixtures/two-users";

function isFulfilled(result: PromiseSettledResult<string>): result is PromiseFulfilledResult<string> {
  return result.status === "fulfilled";
}

describe("restart_workout_session race (Risk #3)", () => {
  let userA: TestIdentity;

  beforeAll(async () => {
    ({ userA } = await setupTwoUsers());
  }, 30_000);

  afterAll(async () => {
    await teardownTwoUsers();
  }, 30_000);

  it("never leaves the caller with zero active sessions, and exactly one active session survives two concurrent restarts", async () => {
    // Real concurrency against a fast local Postgres does not reliably force both calls through
    // the exact window the unique_violation fallback targets (both passing the initial
    // "is active" check before either commits) — depending on statement arrival order at the DB,
    // one call can fully commit before the other's SELECT even runs. That second call then
    // legitimately hits a *different*, pre-existing guard ('existing session is not active') and
    // rejects — which is not the bug this migration fixes, just an ordinary "stale session id"
    // rejection. Both outcomes are valid resolutions of true concurrency, so this test asserts the
    // actual data-integrity invariant the fix guarantees (never zero active sessions, never two),
    // rather than pinning one specific interleaving.
    const results = await Promise.allSettled([
      restartSession(userA.client, userA.id, userA.sessionId, userA.workoutId),
      restartSession(userA.client, userA.id, userA.sessionId, userA.workoutId),
    ]);

    const fulfilled = results.filter(isFulfilled);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    // At least one caller must always come away with a session id — the original bug left the
    // losing caller with an uncaught constraint-violation error and no session at all.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    if (fulfilled.length === 2) {
      expect(fulfilled[0].value).toBe(fulfilled[1].value);
    } else {
      const reason = rejected[0].reason as Error;
      expect(reason.message).toContain("existing session is not active");
    }

    const { data, error } = (await userA.client
      .from("workout_sessions")
      .select("id")
      .eq("workout_id", userA.workoutId)
      .eq("status", "active")) as { data: { id: string }[] | null; error: PostgrestError | null };

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].id).toBe(fulfilled[0].value);
  });
});
