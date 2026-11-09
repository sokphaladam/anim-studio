import type { Provider } from "@anim/ai";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";

const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => "{}" };
const app = buildApp({ provider, store: createStore(":memory:"), config: { provider: "ollama", ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null } });
let base = "";

beforeAll(async () => {
  app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => app.close());

it("POST /api/generate validates the body", async () => {
  const r = await fetch(`${base}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "x", duration: 99, aspect: "4:3" }) });
  expect(r.status).toBe(400);
});

it("health explains when Ollama is not running", async () => {
  const h = (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; message: string };
  expect(h).toMatchObject({ ok: false, message: "Ollama is not running — start it and refresh" });
});

it("POST /api/direct validates the body and needs a rigged character", async () => {
  const post = (body: unknown) => fetch(`${base}/api/direct`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await post({ intent: "x" })).status).toBe(400);
  const spec = { version: 1, meta: { title: "t", duration: 4, width: 100, height: 100 }, layers: [] };
  const r = await post({ spec, intent: "she dances" });
  expect(r.status).toBe(422);
  expect(((await r.json()) as { error: string }).error).toMatch(/no rigged character/);
});
