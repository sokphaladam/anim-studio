import { comfyHealth, comfyui, configFromEnv, generateVideo, providerFor, runway, type AIConfig, type AnimateFn, type Painter, type Provider, type VideoProvider, type VideoTask } from "@anim/ai";
import Fastify from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudTaskJournal } from "./cloudTasks";
import { createStore, type Store } from "./db";
import { renderPng } from "./export";
import { imageStore } from "./images";
import { exportRoutes } from "./routes/export";
import { generateRoutes, type SpendOpts } from "./routes/generate";
import type { SceneSpec } from "@anim/spec";
import { healthRoutes } from "./routes/health";
import { projectRoutes } from "./routes/projects";
import { packageRoutes } from "./routes/package";

const DATA = fileURLToPath(new URL("../../../data/", import.meta.url));

/** Builds the API. `provider`, `painter` and `store` can be swapped in tests. */
export function buildApp(opts: { config?: AIConfig; provider?: Provider; painter?: Painter; store?: Store; cloudVideo?: VideoProvider | null; pollMs?: number } = {}) {
  const config = opts.config ?? configFromEnv(process.env);
  const dbPath = process.env.DB_PATH || join(DATA, "anim-studio.db");
  const store = opts.store ?? createStore(dbPath);
  const imagesDir = process.env.IMAGES_DIR || join(dirname(dbPath), "images");
  const images = imageStore(imagesDir);
  const painterCfg = { url: process.env.COMFY_URL || "http://127.0.0.1:8188", dir: process.env.COMFY_DIR || join(DATA, "comfyui") };
  const painter = opts.painter ?? comfyui(painterCfg);
  // hand-drawn scenes carry every stroke point, so specs can be several MB
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 50 * 1024 * 1024 });
  const provider = () => opts.provider ?? providerFor(config);
  // a painter swapped in (tests) is taken as ready; the real one needs its segmentation models on disk
  const layered = { tools: images.layeredWith(painter), ready: async () => !!opts.painter || (await comfyHealth(painterCfg)).layered };
  // cloud video is opt-in (CLOUD_VIDEO_ENABLED=1); the key stays in this process
  const env = process.env;
  const maxCostUsd = Number(env.RUNWAY_MAX_COST_USD || 5);
  const cloudVideo = opts.cloudVideo !== undefined ? opts.cloudVideo : env.CLOUD_VIDEO_ENABLED === "1" && env.RUNWAY_API_KEY ? runway({ apiKey: env.RUNWAY_API_KEY, model: env.RUNWAY_VIDEO_MODEL || "seedance2_5" }) : null;
  // beside the images folder, so it moves with the media it refers to (and tests keep it in their temp folder)
  const journal = cloudTaskJournal(join(dirname(imagesDir), "cloud-tasks.json"));
  const cloud = cloudVideo && {
    name: `${cloudVideo.id} ${cloudVideo.model}`,
    estimateUsd: (seconds: number) => cloudVideo.estimateUsd?.({ durationSeconds: seconds, resolution: "720p" }),
    // the provider task (id, cost) is kept with the clip, so a shot's origin and price stay on record
    async animate(args: Parameters<AnimateFn>[0], signal?: AbortSignal, spend: SpendOpts = {}) {
      let task: VideoTask | undefined;
      const footage = await images.animateWith(async (a) => {
        const q = { prompt: a.positive, firstFrame: a.image, durationSeconds: a.frames / a.fps, aspect: a.width === a.height ? "1:1" : a.width > a.height ? "16:9" : "9:16", resolution: "720p", seed: a.seed, audio: "none" } as const;
        let counted: VideoTask | undefined;
        // each started task counts against the job's limit once, even if it fails later; it is journaled until it ends,
        // so a restart in between can still collect the clip
        const onTask = (t: VideoTask) => {
          if (!counted) {
            spend.onCost?.(t.estimatedCostUsd ?? 0);
            journal.started(t, a.fps, a.positive);
          }
          counted = t;
        };
        const r = await generateVideo(cloudVideo, q, { signal: a.signal, maxCostUsd: Math.min(spend.maxCostUsd ?? Infinity, maxCostUsd), onTask, pollMs: opts.pollMs }).finally(() => counted && journal.finished(counted.providerTaskId));
        task = r.task;
        app.log.info({ provider: task.provider, model: task.model, taskId: task.providerTaskId, costUsd: task.estimatedCostUsd }, "cloud video done");
        return r.bytes;
      })!(args, signal);
      return { footage, taskId: task?.providerTaskId, costUsd: task?.estimatedCostUsd };
    },
  };
  const local = images.animateWith(painter.animate?.bind(painter));
  // RUNWAY_MAX_COST_USD caps a whole job's cloud spend (every shot and retry); retries apply to local video too
  const media = {
    // a fade-in would hand the video model a black first frame, and the clip would start from black
    frame: (spec: SceneSpec, t: number) => renderPng({ ...spec, overlays: spec.overlays.filter((o) => o.type !== "fade") }, t, imagesDir),
    stats: images.clipStats,
    still: images.still,
    retries: Math.max(0, Number(env.RUNWAY_MAX_RETRIES ?? 1)),
    budgetUsd: cloud ? maxCostUsd : Infinity,
  };
  // clips of cloud tasks left running by a restart are collected in the background and listed here
  if (cloudVideo)
    void journal.resume(cloudVideo, (bytes, fps) => images.animateWith(async () => bytes)!({ fps } as Parameters<AnimateFn>[0]), (msg, data) => app.log.info(data, msg), opts.pollMs);
  app.get("/api/video/recovered", async () => journal.list().filter((e) => e.status === "recovered").map(({ task, prompt, footage, recoveredAt }) => ({ taskId: task.providerTaskId, model: task.model, costUsd: task.estimatedCostUsd, prompt, footage, recoveredAt })));
  generateRoutes(app, provider, local, (src) => images.read(src), layered, cloud || undefined, media);
  images.routes(app, provider);
  projectRoutes(app, store, provider);
  const exportsDir = process.env.EXPORTS_DIR || join(dirname(dbPath), "exports");
  exportRoutes(app, imagesDir, exportsDir);
  packageRoutes(app, store, imagesDir, exportsDir, images.save);
  // what the start page quotes before paid work: the price of a shot of each allowed length, and the job's limit
  const quote = cloud && { budgetUsd: maxCostUsd, retries: media.retries, usdBySeconds: Object.fromEntries([4, 5, 6, 7, 8, 9, 10].map((s) => [s, cloud.estimateUsd(s) ?? null])) };
  healthRoutes(app, config, painterCfg, opts.painter, cloud ? cloud.name : null, quote || null);
  app.addHook("onClose", async () => store.close());
  return app;
}
