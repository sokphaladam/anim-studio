import { comfyHealth, ollamaHealth, ollamaPull, type AIConfig, type Painter, type PullState } from "@anim/ai";
import type { FastifyInstance } from "fastify";

export function healthRoutes(app: FastifyInstance, config: AIConfig, painter: { url: string; dir: string }, swapped?: Painter, cloudVideo: string | null = null, cloudQuote: { budgetUsd: number; retries: number; usdBySeconds: Record<number, number | null> } | null = null) {
  let pull: PullState | null = null;
  let pullModel = config.ollamaModel;

  /** Whether painted scenes can be made: the painter is installed (it starts on demand) or already running. A swapped-in painter (tests) reports what it can do. */
  // cloudVideo: the configured cloud video model ("runway seedance2_5"), or null when cloud video is off
  app.get("/api/health/painter", async () => ({
    ...(swapped ? { installed: true, running: true, video: !!swapped.animate, layered: !!(swapped.removeBackground && swapped.segment && swapped.inpaint) } : await comfyHealth(painter)),
    cloudVideo,
    cloudQuote,
  }));

  app.get("/api/health", async () => {
    if (config.provider === "openai-compatible")
      return config.fallback
        ? { ok: true, provider: "openai-compatible", model: config.fallback.model, message: `Cloud AI ready: ${config.fallback.model.split(",")[0].trim()}` }
        : { ok: false, provider: "openai-compatible", model: "", message: "Cloud AI is not configured", fix: "Set FALLBACK_BASE_URL, FALLBACK_API_KEY and FALLBACK_MODEL in .env" };
    const local = await localHealth();
    // opt-in fallback: say plainly that prompts go to the cloud model while Ollama can't answer
    const fb = config.useFallback && config.fallback;
    return !local.ok && fb ? { ...local, ok: true, provider: "openai-compatible", model: fb.model, message: `Cloud AI standing in: ${fb.model.split(",")[0].trim()}`, fix: `${local.message}. Prompts go to the cloud until Ollama is back.` } : local;
  });

  async function localHealth() {
    // the user picked another model in Settings: forget the old model's download state
    if (pullModel !== config.ollamaModel) [pull, pullModel] = [null, config.ollamaModel];
    const h = await ollamaHealth({ url: config.ollamaUrl, model: config.ollamaModel });
    const base = { provider: "ollama", model: config.ollamaModel, ...h };
    if (!h.reachable) return { ...base, ok: false, message: "Ollama is not running — start it and refresh", fix: `Run npm run setup:ai to install and start Ollama, or check OLLAMA_URL (${config.ollamaUrl})` };
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
      if (pull?.status === "error") return { ...base, ok: false, message: `Model download failed: ${pull.error}`, fix: `Run ollama pull ${config.ollamaModel}, then restart npm run dev` };
      return { ...base, ok: false, message: `Model not found — run ollama pull ${config.ollamaModel}`, fix: `ollama pull ${config.ollamaModel}` };
    }
    pull = null;
    return { ...base, ok: true, message: `Local AI ready: ${config.ollamaModel}` };
  }
}
