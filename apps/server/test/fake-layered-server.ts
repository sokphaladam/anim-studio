// The API with a canned layer plan and the GPU-free fake painter, for scripts/layered-e2e.mjs. Data goes to a temp folder.
// Usage: API_PORT=8799 tsx test/fake-layered-server.ts
import type { Painter, Provider } from "@anim/ai";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";
import { PLAN, painter } from "./fake-painter";

const dir = mkdtempSync(join(tmpdir(), "anim-e2e-"));
process.env.IMAGES_DIR = join(dir, "images");
process.env.EXPORTS_DIR = join(dir, "exports");
const wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 400));
// a little slower than real-time-free, so the progress UI can be seen and screenshotted
const slow: Painter = {
  name: "fake",
  paint: async (a) => wait(await painter.paint(a)),
  removeBackground: async (png) => wait(await painter.removeBackground!(png)),
  segment: async (png, text) => wait(await painter.segment!(png, text)),
  inpaint: async (a) => wait(await painter.inpaint!(a)),
};
const provider: Provider = { name: "mock", model: "canned plan", generateJSON: async () => wait(JSON.stringify(PLAN)) };
const app = buildApp({ provider, painter: slow, store: createStore(join(dir, "e2e.db")), config: { provider: "openai-compatible", ollamaUrl: "", ollamaModel: "", fallback: { baseUrl: "http://127.0.0.1:9", apiKey: "x", model: "canned plan" } } });
await app.listen({ port: Number(process.env.API_PORT ?? 8799), host: "127.0.0.1" });
console.log(`fake layered API on ${process.env.API_PORT ?? 8799}, data in ${dir}`);
