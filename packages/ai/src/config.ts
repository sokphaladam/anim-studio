import { ollama } from "./providers/ollama";
import { openaiCompatible } from "./providers/openai-compatible";
import { AIError, type Provider } from "./types";

export interface AIConfig {
  provider: "ollama" | "openai-compatible";
  ollamaUrl: string;
  ollamaModel: string;
  /** Download the model in the background when Ollama runs without it (OLLAMA_AUTO_SETUP=0 turns this off). */
  autoPull?: boolean;
  fallback: { baseUrl: string; apiKey: string; model: string } | null;
  /** With provider "ollama": ask the fallback cloud model when Ollama can't answer (AI_FALLBACK=1; off by default, so prompts stay local). */
  useFallback?: boolean;
}

/** Reads AI settings from environment variables (see .env.example). */
export function configFromEnv(env: Record<string, string | undefined>): AIConfig {
  const fb = env.FALLBACK_BASE_URL && env.FALLBACK_API_KEY && env.FALLBACK_MODEL ? { baseUrl: env.FALLBACK_BASE_URL, apiKey: env.FALLBACK_API_KEY, model: env.FALLBACK_MODEL } : null;
  return {
    provider: env.AI_PROVIDER === "openai-compatible" ? "openai-compatible" : "ollama",
    ollamaUrl: env.OLLAMA_URL || "http://localhost:11434",
    ollamaModel: env.OLLAMA_MODEL || "qwen2.5-coder:14b",
    autoPull: env.OLLAMA_AUTO_SETUP !== "0",
    fallback: fb,
    useFallback: env.AI_FALLBACK === "1" && !!fb,
  };
}

export function providerFor(c: AIConfig): Provider {
  if (c.provider === "openai-compatible") {
    if (!c.fallback) throw new Error("AI_PROVIDER=openai-compatible needs FALLBACK_BASE_URL, FALLBACK_API_KEY and FALLBACK_MODEL");
    return openaiCompatible(c.fallback);
  }
  const local = ollama({ url: c.ollamaUrl, model: c.ollamaModel });
  return c.useFallback && c.fallback ? withFallback(local, openaiCompatible(c.fallback)) : local;
}

/** Asks `local` first; only when it can't be reached at all (not running, model missing) asks `cloud`. Bad answers are not retried elsewhere. */
export function withFallback(local: Provider, cloud: Provider): Provider {
  return {
    name: local.name,
    model: local.model,
    vision: local.vision,
    unload: local.unload?.bind(local),
    async generateJSON(args) {
      try {
        return await local.generateJSON(args);
      } catch (e) {
        // a request that needs to see an image can't go to a model that can't
        if (args.signal?.aborted || !(e instanceof AIError && e.unavailable) || (args.image && !cloud.vision)) throw e;
        return cloud.generateJSON(args);
      }
    },
  };
}
