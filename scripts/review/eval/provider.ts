import { reviewDiff } from "../../review.ts";

export default class GeminiReviewProvider {
  private modelId: string;

  constructor(options: { config?: { model?: string } }) {
    this.modelId = options.config?.model ?? "gemini-3.1-flash-lite";
  }

  id() {
    return `gemini-review:${this.modelId}`;
  }

  async callApi(prompt: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    const review = await reviewDiff(prompt, apiKey, this.modelId);
    return { output: review };
  }
}
