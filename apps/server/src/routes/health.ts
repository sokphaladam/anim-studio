import { ollamaHealth, type AIConfig } from "@anim/ai";
import type { FastifyInstance } from "fastify";

export function healthRoutes(app: FastifyInstance, config: AIConfig) {
  app.get("/api/health", async () => {
    if (config.provider === "openai-compatible")
      return config.fallback
        ? { ok: true, provider: "openai-compatible", model: config.fallback.model, message: `Cloud AI ready: ${config.fallback.model}` }
        : { ok: false, provider: "openai-compatible", model: "", message: "Cloud AI is not configured", fix: "Set FALLBACK_BASE_URL, FALLBACK_API_KEY and FALLBACK_MODEL in .env" };
    const h = await ollamaHealth({ url: config.ollamaUrl, model: config.ollamaModel });
    const base = { provider: "ollama", model: config.ollamaModel, ...h };
    if (!h.reachable) return { ...base, ok: false, message: "Ollama is not running — start it and refresh", fix: `Start Ollama, or check OLLAMA_URL (${config.ollamaUrl})` };
    if (!h.modelPulled) return { ...base, ok: false, message: `Model not found — run ollama pull ${config.ollamaModel}`, fix: `ollama pull ${config.ollamaModel}` };
    return { ...base, ok: true, message: `Local AI ready: ${config.ollamaModel}` };
  });
}
