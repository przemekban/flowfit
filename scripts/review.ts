import { fileURLToPath } from "node:url";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { isStepCount, Output, ToolLoopAgent } from "ai";
import { REVIEW_SCHEMA, SYSTEM_PROMPT, type Review } from "./review/schema.ts";

const GEMINI_MODEL = "gemini-3.1-flash-lite";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function reviewDiff(diff: string, apiKey: string, model: string = GEMINI_MODEL): Promise<Review> {
  const google = createGoogleGenerativeAI({ apiKey });

  const reviewer = new ToolLoopAgent({
    model: google(model),
    instructions: SYSTEM_PROMPT,
    tools: {},
    output: Output.object({ schema: REVIEW_SCHEMA }),
    stopWhen: isStepCount(2),
  });

  const { output } = await reviewer.generate({
    prompt: `Review this diff:\n\n${diff}`,
  });

  return output;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const diff = (await readStdin()).trim();
    if (!diff) {
      console.error("No diff provided on stdin. Pipe a diff in, e.g.: git diff | npm run review");
      process.exit(1);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is not set. Add it to .env (see .env.example).");
      process.exit(1);
    }

    const review = await reviewDiff(diff, apiKey);
    console.log(JSON.stringify(review, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Review failed: ${message}`);
    process.exit(1);
  }
}
