import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeSession, deleteSet, getSessionOwnership, getSessionWithSets, upsertSet } from "@/lib/services/session";
import { setupTwoUsers, teardownTwoUsers, type TestIdentity } from "./fixtures/two-users";

describe("session ownership RLS (Risk #2)", () => {
  let userA: TestIdentity;
  let userB: TestIdentity;
  let seededExerciseId: string;
  const seededSetNumber = 1;
  const newSetNumber = 2;

  beforeAll(async () => {
    ({ userA, userB } = await setupTwoUsers());
  }, 30_000);

  afterAll(async () => {
    await teardownTwoUsers();
  }, 30_000);

  describe("getSessionOwnership", () => {
    it("rejects with PGRST116 when userB targets userA's session", async () => {
      await expect(getSessionOwnership(userB.client, userA.sessionId)).rejects.toMatchObject({ code: "PGRST116" });
    });

    it("resolves with the row when userA targets their own session", async () => {
      const result = await getSessionOwnership(userA.client, userA.sessionId);
      expect(result.id).toBe(userA.sessionId);
      expect(result.user_id).toBe(userA.id);
    });
  });

  describe("getSessionWithSets", () => {
    it("rejects with PGRST116 when userB targets userA's session", async () => {
      await expect(getSessionWithSets(userB.client, userA.sessionId)).rejects.toMatchObject({ code: "PGRST116" });
    });

    it("resolves with the row and its seeded set when userA targets their own session", async () => {
      const result = await getSessionWithSets(userA.client, userA.sessionId);
      expect(result.id).toBe(userA.sessionId);
      expect(result.sets).toHaveLength(1);
      seededExerciseId = result.sets[0].exercise_id;
      expect(result.sets[0].set_number).toBe(seededSetNumber);
    });
  });

  describe("upsertSet", () => {
    it("rejects when userB targets userA's session", async () => {
      await expect(
        upsertSet(userB.client, userA.sessionId, { exercise_id: seededExerciseId, set_number: newSetNumber, reps: 5 }),
      ).rejects.toBeTruthy();
    });

    it("resolves when userA targets their own session", async () => {
      const result = await upsertSet(userA.client, userA.sessionId, {
        exercise_id: seededExerciseId,
        set_number: newSetNumber,
        reps: 5,
      });
      expect(result.workout_session_id).toBe(userA.sessionId);
      expect(result.set_number).toBe(newSetNumber);
    });
  });

  describe("deleteSet", () => {
    it("resolves without throwing when userB targets userA's seeded set, but the set is unaffected (RLS filters to zero rows)", async () => {
      await expect(
        deleteSet(userB.client, userA.sessionId, seededExerciseId, seededSetNumber),
      ).resolves.toBeUndefined();

      const stillThere = await getSessionWithSets(userA.client, userA.sessionId);
      expect(stillThere.sets.some((s) => s.exercise_id === seededExerciseId && s.set_number === seededSetNumber)).toBe(
        true,
      );
    });

    it("resolves and actually deletes the row when userA targets their own set", async () => {
      await expect(deleteSet(userA.client, userA.sessionId, seededExerciseId, newSetNumber)).resolves.toBeUndefined();

      const afterDelete = await getSessionWithSets(userA.client, userA.sessionId);
      expect(afterDelete.sets.some((s) => s.exercise_id === seededExerciseId && s.set_number === newSetNumber)).toBe(
        false,
      );
    });
  });

  describe("completeSession", () => {
    it("rejects with PGRST116 when userB targets userA's session", async () => {
      await expect(completeSession(userB.client, userA.sessionId)).rejects.toMatchObject({ code: "PGRST116" });
    });

    it("resolves and marks the session completed when userA targets their own session", async () => {
      const result = await completeSession(userA.client, userA.sessionId);
      expect(result.id).toBe(userA.sessionId);
      expect(result.status).toBe("completed");
    });
  });
});
