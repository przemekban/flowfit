import { z } from "zod";

export const SYSTEM_PROMPT = [
  "You are a precise, constructive code reviewer evaluating a pull request diff.",
  "Score the diff on five criteria, each on a 1-10 scale (1 = severe gaps, 10 = exemplary):",
  "implementation correctness, idiomaticity, complexity, test coverage relative to risk, and security.",
  "Then issue a binding verdict (pass or fail) for the whole change, and include a short summary",
  "(2-3 sentences) in Markdown that the PR author can act on.",
].join(" ");

// Scores are plain z.number(): structured-output APIs commonly reject min/max
// constraints on numeric fields, so the 1-10 range is enforced via the field
// description and system prompt instead of the schema itself.
export const REVIEW_SCHEMA = z.object({
  implementationCorrectness: z
    .number()
    .describe("Implementation correctness: does the code do what it claims to do (scale 1-10)"),
  idiomaticity: z.number().describe("Idiomaticity: adherence to language and project conventions (scale 1-10)"),
  complexity: z.number().describe("Complexity: simplicity of the solution relative to the problem (scale 1-10)"),
  testRiskCoverage: z.number().describe("Test coverage proportional to the risk of the changed paths (scale 1-10)"),
  securitySafety: z.number().describe("Security: absence of vulnerabilities and secret leaks (scale 1-10)"),
  verdict: z.enum(["pass", "fail"]).describe("Binding verdict for the whole change"),
  summary: z.string().describe("Markdown summary, ready to use as a PR comment"),
});

export type Review = z.infer<typeof REVIEW_SCHEMA>;
