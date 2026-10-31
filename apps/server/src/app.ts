import { comfyui, configFromEnv, providerFor, type AIConfig, type Painter, type Provider } from "@anim/ai";
import Fastify from "fastify";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, type Store } from "./db";
import { imageStore } from "./images";
import { generateRoutes } from "./routes/generate";
import { healthRoutes } from "./routes/health";
import { projectRoutes } from "./routes/projects";

const DATA = fileURLToPath(new URL("../../../data/", import.meta.url));

/** Builds the API. `provider`, `painter` and `store` can be swapped in tests. */
export function buildApp(opts: { config?: AIConfig; provider?: Provider; painter?: Painter; store?: Store } = {}) {
  const config = opts.config ?? configFromEnv(process.env);
  const dbPath = process.env.DB_PATH || join(DATA, "anim-studio.db");
  const store = opts.store ?? createStore(dbPath);
  const images = imageStore(process.env.IMAGES_DIR || join(dirname(dbPath), "images"));
  const painterCfg = { url: process.env.COMFY_URL || "http://127.0.0.1:8188", dir: process.env.COMFY_DIR || join(DATA, "comfyui") };
  const painter = opts.painter ?? comfyui(painterCfg);
  // hand-drawn scenes carry every stroke point, so specs can be several MB
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 50 * 1024 * 1024 });
  const provider = () => opts.provider ?? providerFor(config);
  generateRoutes(app, provider, images.paintWith(painter), images.animateWith(painter), (src) => images.read(src));
  images.routes(app, provider);
  projectRoutes(app, store, provider);
  healthRoutes(app, config, painterCfg);
  app.addHook("onClose", async () => store.close());
  return app;
}
