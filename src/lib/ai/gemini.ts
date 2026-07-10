import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY } from "astro:env/server";

export function createGeminiClient(): GoogleGenAI | null {
  if (!GEMINI_API_KEY) {
    return null;
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}
