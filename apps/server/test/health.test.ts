import { createServer } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";

// Fake Ollama: model missing until /api/pull streams to completion
let pulled = false;
let release: () => void = () => {};
const ollama = createServer((req, res) => {
  if (req.url === "/api/tags") return res.end(JSON.stringify({ models: pulled ? [{ name: "m:1b" }] : [] }));
  if (req.url === "/api/pull") {
    res.write(JSON.stringify({ status: "pulling", total: 100, completed: 40 }) + "\n");
    release = () => {
      pulled = true;
      res.end(JSON.stringify({ status: "success" }) + "\n");
    };
    return;
  }
  res.statusCode = 404;
  res.end();
});
let app: ReturnType<typeof buildApp>;
let base = "";

beforeAll(async () => {
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  const a = ollama.address();
  app = buildApp({ config: { provider: "ollama", ollamaUrl: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, ollamaModel: "m:1b", autoPull: true, fallback: null }, store: createStore(":memory:") });
  app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const s = app.server.address();
  base = `http://127.0.0.1:${typeof s === "object" && s ? s.port : 0}`;
});
afterAll(async () => {
  await app.close();
  ollama.close();
});

const health = async () => (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; pulling?: boolean; message: string };

it("downloads a missing model in the background and reports progress", async () => {
  expect(await health()).toMatchObject({ ok: false, pulling: true });
  await expect.poll(async () => (await health()).message).toBe("Downloading m:1b… 40%");
  release();
  await expect.poll(async () => (await health()).ok).toBe(true);
});

it("with the opt-in cloud fallback, a stopped Ollama reports the cloud model standing in", async () => {
  const cfg = { provider: "ollama" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "m:1b", fallback: { baseUrl: "https://x", apiKey: "k", model: "cloud-m, other" } };
  const on = buildApp({ config: { ...cfg, useFallback: true }, store: createStore(":memory:") });
  const off = buildApp({ config: cfg, store: createStore(":memory:") });
  on.log.level = off.log.level = "silent";
  expect((await on.inject({ url: "/api/health" })).json()).toMatchObject({ ok: true, provider: "openai-compatible", message: "Cloud AI standing in: cloud-m" });
  expect((await off.inject({ url: "/api/health" })).json()).toMatchObject({ ok: false, provider: "ollama" });
  await Promise.all([on.close(), off.close()]);
});
