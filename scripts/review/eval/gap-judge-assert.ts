import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Review } from "../schema.ts";

const KNOWN_GAP =
  "checkout.ts calls applyDiscountUnsafe(), which — unlike the sibling applyDiscount() — " +
  "skips the 0-100 bounds check on a user-controlled discountPercent, allowing an " +
  "out-of-range or negative discount to be applied.";

const JUDGE_SCHEMA = z.object({
  identifiesGap: z.boolean(),
  reasoning: z.string(),
});

export default async function gapJudgeAssert(output: Review) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const google = createGoogleGenerativeAI({ apiKey });

  const { output: judgement } = await generateText({
    model: google("gemini-3.1-flash-lite"),
    output: Output.object({ schema: JUDGE_SCHEMA }),
    instructions:
      "You are grading whether a code review summary correctly identifies a known bug. " +
      "Answer only based on whether the summary's content names this specific gap.",
    prompt: [
      `Known gap: ${KNOWN_GAP}`,
      "",
      `Review summary to grade:\n${output.summary}`,
      "",
      "Does the review summary identify this specific gap (not just a generic security/validation concern)?",
    ].join("\n"),
  });

  return {
    pass: judgement.identifiesGap,
    score: judgement.identifiesGap ? 1 : 0,
    reason: judgement.reasoning,
  };
}
