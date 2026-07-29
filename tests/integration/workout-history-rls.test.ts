import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkoutSessionHistory } from "@/lib/services/session";
import { seedSession, seedSet, setupTwoUsers, teardownTwoUsers, type TestIdentity } from "./fixtures/two-users";

describe("workout history RLS & filtering (S-04)", () => {
  let userA: TestIdentity;
  let userB: TestIdentity;
  let admin: SupabaseClient;

  let oldestSessionId: string;
  let midSessionId: string;
  let newestSessionId: string;

  beforeAll(async () => {
    ({ userA, userB, admin } = await setupTwoUsers());

    // userA already has one 'active' session from seedUser() — it must never appear in history
    // results. Add three non-active sessions with distinct started_at values to assert ordering,
    // status filtering, and pagination against known data.
    oldestSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-06-01T08:00:00.000Z",
      completedAt: "2026-06-01T08:45:00.000Z",
    });
    // Insert sets out of set_number order to prove the query sorts them, not the insert order.
    await seedSet(admin, { sessionId: oldestSessionId, exerciseId: userA.exerciseId, setNumber: 2, reps: 8 });
    await seedSet(admin, { sessionId: oldestSessionId, exerciseId: userA.exerciseId, setNumber: 1, reps: 10 });

    midSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "abandoned",
      startedAt: "2026-06-15T09:00:00.000Z",
      completedAt: null,
    });

    newestSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-06-20T07:00:00.000Z",
      completedAt: "2026-06-20T07:30:00.000Z",
    });
  }, 30_000);

  afterAll(async () => {
    await teardownTwoUsers();
  }, 30_000);

  it("excludes active sessions and returns exactly the seeded completed/abandoned sessions", async () => {
    const { sessions } = await getWorkoutSessionHistory(userA.client, userA.id, 10, 0);

    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.status !== "active")).toBe(true);
    expect(sessions.map((s) => s.id).sort()).toEqual([oldestSessionId, midSessionId, newestSessionId].sort());
  });

  it("orders sessions by started_at DESC", async () => {
    const { sessions } = await getWorkoutSessionHistory(userA.client, userA.id, 10, 0);

    expect(sessions.map((s) => s.id)).toEqual([newestSessionId, midSessionId, oldestSessionId]);
  });

  it("orders nested sets by set_number ASC regardless of insertion order", async () => {
    const { sessions } = await getWorkoutSessionHistory(userA.client, userA.id, 10, 0);

    const oldest = sessions.find((s) => s.id === oldestSessionId);
    expect(oldest?.sets.map((s) => s.set_number)).toEqual([1, 2]);
  });

  it("enforces RLS: caller cannot fetch another user's session history regardless of the userId argument", async () => {
    const { sessions: fromUserB } = await getWorkoutSessionHistory(userB.client, userA.id, 10, 0);
    expect(fromUserB).toEqual([]);

    const { sessions: fromUserA } = await getWorkoutSessionHistory(userA.client, userB.id, 10, 0);
    expect(fromUserA).toEqual([]);
  });

  it("paginates via range with a hasMore indicator", async () => {
    const firstPage = await getWorkoutSessionHistory(userA.client, userA.id, 2, 0);
    expect(firstPage.sessions.map((s) => s.id)).toEqual([newestSessionId, midSessionId]);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await getWorkoutSessionHistory(userA.client, userA.id, 2, 2);
    expect(secondPage.sessions.map((s) => s.id)).toEqual([oldestSessionId]);
    expect(secondPage.hasMore).toBe(false);
  });
});
