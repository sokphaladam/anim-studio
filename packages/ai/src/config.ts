import { ollama } from "./providers/ollama";
import { openaiCompatible } from "./providers/openai-compatible";
import type { Provider } from "./types";

export interface AIConfig {
  provider: "ollama" | "openai-compatible";
  ollamaUrl: string;
  ollamaModel: string;
  fallback: { baseUrl: string; apiKey: string; model: string } | null;
}

/** Reads AI settings from environment variables (see .env.example). */
export function configFromEnv(env: Record<string, string | undefined>): AIConfig {
  const fb = env.FALLBACK_BASE_URL && env.FALLBACK_API_KEY && env.FALLBACK_MODEL ? { baseUrl: env.FALLBACK_BASE_URL, apiKey: env.FALLBACK_API_KEY, model: env.FALLBACK_MODEL } : null;
  return {
    provider: env.AI_PROVIDER === "openai-compatible" ? "openai-compatible" : "ollama",
    ollamaUrl: env.OLLAMA_URL || "http://localhost:11434",
    ollamaModel: env.OLLAMA_MODEL || "qwen2.5-coder:14b",
    fallback: fb,
  };
}

export function providerFor(c: AIConfig): Provider {
  if (c.provider === "openai-compatible") {
    if (!c.fallback) throw new Error("AI_PROVIDER=openai-compatible needs FALLBACK_BASE_URL, FALLBACK_API_KEY and FALLBACK_MODEL");
    return openaiCompatible(c.fallback);
  }
  return ollama({ url: c.ollamaUrl, model: c.ollamaModel });
}
