import { comfyHealth, comfyui, configFromEnv, providerFor, type AIConfig, type Painter, type Provider } from "@anim/ai";
import Fastify from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, type Store } from "./db";
import { imageStore } from "./images";
import { exportRoutes } from "./routes/export";
import { generateRoutes } from "./routes/generate";
import { healthRoutes } from "./routes/health";
import { projectRoutes } from "./routes/projects";
import { packageRoutes } from "./routes/package";

const DATA = fileURLToPath(new URL("../../../data/", import.meta.url));

/** Builds the API. `provider`, `painter` and `store` can be swapped in tests. */
export function buildApp(opts: { config?: AIConfig; provider?: Provider; painter?: Painter; store?: Store } = {}) {
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
  generateRoutes(app, provider, images.animateWith(painter), (src) => images.read(src), layered);
  images.routes(app, provider);
  projectRoutes(app, store, provider);
  const exportsDir = process.env.EXPORTS_DIR || join(dirname(dbPath), "exports");
  exportRoutes(app, imagesDir, exportsDir);
  packageRoutes(app, store, imagesDir, exportsDir, images.save);
  healthRoutes(app, config, painterCfg, opts.painter);
  app.addHook("onClose", async () => store.close());
  return app;
}
