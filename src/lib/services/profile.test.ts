import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/types";
import type { OnboardingInput } from "@/lib/validation/profile";
import { createUserProfile, getUserProfile, resetUserProfile } from "./profile";

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface QueryBuilderMock {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

function createQueryBuilder(result: QueryResult): QueryBuilderMock {
  const builder = {} as QueryBuilderMock;
  const chain = () => builder;

  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));

  return builder;
}

const profile: UserProfile = {
  id: "user-1",
  training_goal: "strength",
  experience_level: "beginner",
  equipment: ["barbell"],
  preferred_style: "full_body",
  sessions_per_week: 3,
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
};

describe("getUserProfile", () => {
  it("calls .select('*').eq(id, userId).maybeSingle() and returns the row", async () => {
    const builder = createQueryBuilder({ data: profile, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getUserProfile(supabase, "user-1");

    expect(builder.select).toHaveBeenCalledWith("*");
    expect(builder.eq).toHaveBeenCalledWith("id", "user-1");
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(result).toEqual(profile);
  });

  it("returns null when no row exists", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    await expect(getUserProfile(supabase, "user-1")).resolves.toBeNull();
  });

  it("rethrows a PostgrestError", async () => {
    const dbError = { code: "500", message: "connection reset" };
    const builder = createQueryBuilder({ data: null, error: dbError });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    await expect(getUserProfile(supabase, "user-1")).rejects.toEqual(dbError);
  });
});

describe("createUserProfile", () => {
  const input: OnboardingInput = {
    training_goal: "strength",
    experience_level: "beginner",
    equipment: ["barbell"],
    preferred_style: "full_body",
    sessions_per_week: 3,
  };

  it("calls .insert({ id: userId, ...input }) and returns the created row on success", async () => {
    const builder = createQueryBuilder({ data: profile, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await createUserProfile(supabase, "user-1", input);

    expect(builder.insert).toHaveBeenCalledWith({ id: "user-1", ...input });
    expect(result).toEqual(profile);
  });

  it("rethrows a 23505 duplicate-insert error unchanged", async () => {
    const conflictError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const builder = createQueryBuilder({ data: null, error: conflictError });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    await expect(createUserProfile(supabase, "user-1", input)).rejects.toEqual(conflictError);
  });
});

describe("resetUserProfile", () => {
  it("calls .rpc('reset_user_profile', { p_user_id: userId })", async () => {
    const rpcMock = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const supabase = { rpc: rpcMock } as unknown as SupabaseClient;

    await resetUserProfile(supabase, "user-1");

    expect(rpcMock).toHaveBeenCalledWith("reset_user_profile", { p_user_id: "user-1" });
  });

  it("rethrows on RPC error", async () => {
    const rpcError = Object.assign(new Error("active_workout_session"), { code: "P0001" });
    const rpcMock = vi.fn(() => Promise.resolve({ data: null, error: rpcError }));
    const supabase = { rpc: rpcMock } as unknown as SupabaseClient;

    await expect(resetUserProfile(supabase, "user-1")).rejects.toEqual(rpcError);
  });
});
