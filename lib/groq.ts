import "server-only";

import Groq from "groq-sdk";

export const GROQ_MODEL = "openai/gpt-oss-120b";

export function createGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY. Add it to your .env.local file.");
  }

  return new Groq({ apiKey });
}
