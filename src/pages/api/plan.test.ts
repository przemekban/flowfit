import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const getUserProfileMock = vi.fn();
const getCandidateExercisesMock = vi.fn();
const generateTrainingPlanMock = vi.fn();
const validatePlanAgainstCandidatesMock = vi.fn();
const rpcMock = vi.fn();
const createClientMock = vi.fn(() => ({ rpc: rpcMock }));
const createGeminiClientMock = vi.fn(() => ({}));

class MockPlanValidationError extends Error {}

vi.mock("@/lib/supabase", () => ({ createClient: createClientMock }));
vi.mock("@/lib/ai/gemini", () => ({ createGeminiClient: createGeminiClientMock }));
vi.mock("@/lib/services/profile", () => ({ getUserProfile: getUserProfileMock }));
vi.mock("@/lib/services/plan", () => ({
  getCandidateExercises: getCandidateExercisesMock,
  generateTrainingPlan: generateTrainingPlanMock,
  validatePlanAgainstCandidates: validatePlanAgainstCandidatesMock,
  PlanValidationError: MockPlanValidationError,
}));

const { POST } = await import("./plan");

function buildContext(user: APIContext["locals"]["user"]): APIContext {
  return {
    locals: { user },
    request: new Request("http://test", { method: "POST" }),
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

const authedUser = { id: "user-1" } as APIContext["locals"]["user"];

describe("POST /api/plan", () => {
  beforeEach(() => {
    getUserProfileMock.mockReset();
    getCandidateExercisesMock.mockReset();
    generateTrainingPlanMock.mockReset();
    validatePlanAgainstCandidatesMock.mockReset();
    rpcMock.mockReset();
    createClientMock.mockClear();
    createGeminiClientMock.mockClear();
    createGeminiClientMock.mockReturnValue({});
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    const context = buildContext(null);

    const response = await POST(context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns 409 profile_missing before touching Gemini/candidates when getUserProfile resolves null", async () => {
    getUserProfileMock.mockResolvedValue(null);
    const context = buildContext(authedUser);

    const response = await POST(context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "profile_missing" });
    expect(createGeminiClientMock).not.toHaveBeenCalled();
    expect(getCandidateExercisesMock).not.toHaveBeenCalled();
  });

  it("returns 409 with the reset-mid-flow message when save_generated_training_plan rejects with profile_missing", async () => {
    getUserProfileMock.mockResolvedValue({ id: "user-1", sessions_per_week: 3 });
    getCandidateExercisesMock.mockResolvedValue([]);
    generateTrainingPlanMock.mockResolvedValue({ workouts: [] });
    validatePlanAgainstCandidatesMock.mockReturnValue({ workouts: [] });
    rpcMock.mockResolvedValue({ error: Object.assign(new Error("profile_missing"), { code: "P0001" }) });
    const context = buildContext(authedUser);

    const response = await POST(context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "profile_missing",
      message: "Your profile was reset while your plan was generating. Please retake the survey and try again.",
    });
  });

  it("returns 502 ai_error echoing the guard message when generateTrainingPlan rejects with a PlanValidationError", async () => {
    getUserProfileMock.mockResolvedValue({ id: "user-1", sessions_per_week: 3 });
    getCandidateExercisesMock.mockResolvedValue([]);
    generateTrainingPlanMock.mockRejectedValue(new MockPlanValidationError("Not enough exercises match"));
    const context = buildContext(authedUser);

    const response = await POST(context);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "ai_error", message: "Not enough exercises match" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
