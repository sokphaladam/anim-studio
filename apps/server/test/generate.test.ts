import type { Provider } from "@anim/ai";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app";

const storyboard = { title: "sky test", mood: "", palette: {}, beats: [{ at: 0, label: "Start" }] };
const spec = { version: 1, meta: { title: "sky test", duration: 6, fps: 30, width: 720, height: 1280 }, layers: [{ id: "bg", type: "paper", params: {} }] };
const answers = [storyboard, spec];
const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => JSON.stringify(answers.shift()) };
const app = buildApp({ provider, config: { provider: "ollama", ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null } });
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

it("streams storyboard then the finished spec over SSE", async () => {
  const r = await fetch(`${base}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "a tall sky", duration: 6, aspect: "9:16" }) });
  const { jobId } = (await r.json()) as { jobId: string };
  const text = await (await fetch(`${base}/api/jobs/${jobId}/events`)).text(); // stream closes on "end"
  const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
  expect(events).toEqual(expect.arrayContaining(["storyboard", "done", "end"]));
  expect(events.indexOf("storyboard")).toBeLessThan(events.indexOf("done"));
  expect(text).toMatch(/"width":720/);
});

it("health explains when Ollama is not running", async () => {
  const h = (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; message: string };
  expect(h).toMatchObject({ ok: false, message: "Ollama is not running — start it and refresh" });
});
