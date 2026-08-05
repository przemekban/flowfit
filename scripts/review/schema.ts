import { z } from "zod";

export const SYSTEM_PROMPT = [
  "You are a precise, constructive code reviewer evaluating a pull request diff for FlowFit,",
  "an Astro 6 SSR + React 19 islands + Supabase + Cloudflare Workers app.",
  "Score the diff on five criteria, each on a 1-10 scale (1 = severe gaps, 10 = exemplary):",
  "",
  "- implementationCorrectness: does the code do what the PR claims, including edge cases;",
  "  new API routes must export `prerender = false` (its absence breaks SSR and scores 1-2).",
  "- idiomaticity: adherence to project conventions — `@/*` path alias over cross-directory",
  "  relative imports, `cn()` for conditional Tailwind classes, no Next.js directives",
  '  (`"use client"`/`"use server"`) in this Astro codebase, React only where client',
  "  interactivity is actually needed.",
  "- complexity: simplest solution for the problem — no premature abstraction, and no",
  "  duplicated business logic where an existing helper/service (e.g. `src/lib/services/`)",
  "  should have been reused instead.",
  "- testRiskCoverage: test coverage proportional to the risk of the changed paths (auth,",
  "  RLS-protected queries, critical flows), regardless of test layer (unit/integration/e2e);",
  "  cosmetic changes need no new tests.",
  "- securitySafety: zero-tolerance for any violation of these hard rules, even partial ones",
  "  — score 1-2 regardless of severity: (a) a new Supabase table without RLS enabled, or RLS",
  "  enabled but missing a per-operation/per-role policy; (b) a server secret imported",
  "  directly instead of via `astro:env/server`; (c) a new protected path not added to",
  "  `PROTECTED_ROUTES` in `src/middleware.ts`; (d) any leaked secret/token in the diff;",
  "  (e) other vulnerability patterns (SQL injection, XSS). A 10 requires full RLS coverage,",
  "  secrets only via `astro:env/server`, all protected paths registered, and no vulnerability",
  "  patterns.",
  "",
  "Then issue a binding verdict (pass or fail) for the whole change — any securitySafety",
  "score of 1-2 must result in verdict: fail — and include a short summary (2-3 sentences)",
  "in Markdown that the PR author can act on.",
].join("\n");

// Scores are plain z.number(): structured-output APIs commonly reject min/max
// constraints on numeric fields, so the 1-10 range is enforced via the field
// description and system prompt instead of the schema itself.
export const REVIEW_SCHEMA = z.object({
  implementationCorrectness: z
    .number()
    .describe(
      "Implementation correctness: does the code do what it claims to do, including " +
        "prerender=false on new API routes (scale 1-10)",
    ),
  idiomaticity: z
    .number()
    .describe(
      "Idiomaticity: adherence to project conventions (@/* alias, cn(), no Next.js " +
        "directives, React only where needed) (scale 1-10)",
    ),
  complexity: z
    .number()
    .describe(
      "Complexity: simplicity of the solution relative to the problem, including absence " +
        "of duplicated logic that should reuse an existing service/helper (scale 1-10)",
    ),
  testRiskCoverage: z.number().describe("Test coverage proportional to the risk of the changed paths (scale 1-10)"),
  securitySafety: z
    .number()
    .describe(
      "Security: zero-tolerance score for RLS, PROTECTED_ROUTES, astro:env/server " +
        "violations and other vulnerabilities/secret leaks — any violation caps at 1-2 (scale 1-10)",
    ),
  verdict: z.enum(["pass", "fail"]).describe("Binding verdict for the whole change"),
  summary: z.string().describe("Markdown summary, ready to use as a PR comment"),
});

export type Review = z.infer<typeof REVIEW_SCHEMA>;
