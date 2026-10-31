import { comfyHealth, ollamaHealth, ollamaPull, type AIConfig, type PullState } from "@anim/ai";
import type { FastifyInstance } from "fastify";

export function healthRoutes(app: FastifyInstance, config: AIConfig, painter: { url: string; dir: string }) {
  let pull: PullState | null = null;

  /** Whether painted scenes can be made: the painter is installed (it starts on demand) or already running. */
  app.get("/api/health/painter", async () => comfyHealth(painter));

  app.get("/api/health", async () => {
    if (config.provider === "openai-compatible")
      return config.fallback
        ? { ok: true, provider: "openai-compatible", model: config.fallback.model, message: `Cloud AI ready: ${config.fallback.model.split(",")[0].trim()}` }
        : { ok: false, provider: "openai-compatible", model: "", message: "Cloud AI is not configured", fix: "Set FALLBACK_BASE_URL, FALLBACK_API_KEY and FALLBACK_MODEL in .env" };
    const h = await ollamaHealth({ url: config.ollamaUrl, model: config.ollamaModel });
    const base = { provider: "ollama", model: config.ollamaModel, ...h };
    if (!h.reachable) return { ...base, ok: false, message: "Ollama is not running — start it and refresh", fix: `Run pnpm setup:ai to install and start Ollama, or check OLLAMA_URL (${config.ollamaUrl})` };
    if (!h.modelPulled) {
      // First check that finds the model missing starts the download; later checks report its progress
      if (config.autoPull && !pull) {
        pull = { status: "pulling", percent: 0 };
        void ollamaPull({ url: config.ollamaUrl, model: config.ollamaModel }, (s) => {
          pull = s;
          if (s.status === "error") app.log.warn(`Model pull failed: ${s.error}`);
        });
      }
      if (pull?.status === "pulling") return { ...base, ok: false, pulling: true, percent: pull.percent, message: `Downloading ${config.ollamaModel}… ${pull.percent}%`, fix: "The model downloads once (several GB); generation unlocks when it finishes" };
      if (pull?.status === "error") return { ...base, ok: false, message: `Model download failed: ${pull.error}`, fix: `Run ollama pull ${config.ollamaModel}, then restart pnpm dev` };
      return { ...base, ok: false, message: `Model not found — run ollama pull ${config.ollamaModel}`, fix: `ollama pull ${config.ollamaModel}` };
    }
    pull = null;
    return { ...base, ok: true, message: `Local AI ready: ${config.ollamaModel}` };
  });
}
