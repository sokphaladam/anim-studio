import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";
import { recommendedModel, writeEnv } from "../src/routes/settings";

const sys = (aiMemoryGb: number) => ({ os: "", cpu: "", cores: 1, ramGb: 0, gpu: null, aiMemoryGb });

it("recommends the largest model that fits the computer", () => {
  expect(recommendedModel(sys(4))).toBe("qwen2.5-coder:3b");
  expect(recommendedModel(sys(8))).toBe("qwen2.5-coder:7b");
  expect(recommendedModel(sys(12))).toBe("qwen2.5-coder:14b");
  expect(recommendedModel(sys(24))).toBe("qwen2.5-coder:32b");
});

it("writeEnv replaces and appends keys, keeping comments", () => {
  const f = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(f, "# note\nOLLAMA_MODEL=old\nOTHER=1\n");
  writeEnv(f, { OLLAMA_MODEL: "qwen2.5-coder:7b", AI_PROVIDER: "ollama" });
  expect(readFileSync(f, "utf8")).toBe("# note\nOLLAMA_MODEL=qwen2.5-coder:7b\nOTHER=1\nAI_PROVIDER=ollama\n");
});

it("PUT /api/settings switches the model at once and rejects bad input", async () => {
  const app = buildApp({ config: { provider: "ollama", ollamaUrl: "http://127.0.0.1:9", ollamaModel: "m:1b", fallback: null }, store: createStore(":memory:") });
  app.log.level = "silent";
  const put = (body: object) => app.inject({ method: "PUT", url: "/api/settings", payload: body });
  expect((await put({ model: "x; rm -rf" })).statusCode).toBe(400);
  expect((await put({ provider: "openai-compatible" })).statusCode).toBe(400); // no cloud AI configured
  expect((await put({ video: "nope" })).statusCode).toBe(400);
  expect((await put({ model: "qwen2.5-coder:7b" })).statusCode).toBe(200);
  const s = (await app.inject({ url: "/api/settings" })).json();
  expect(s.model).toBe("qwen2.5-coder:7b");
  expect(s.ollamaRunning).toBe(false);
  expect((await app.inject({ url: "/api/health" })).json().model).toBe("qwen2.5-coder:7b");
  await app.close();
});

it("Gemini key: rejects junk, never echoes the key, and can be removed", async () => {
  const config = { provider: "openai-compatible" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "m:1b", fallback: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", apiKey: "AQ.secret-key-1234", model: "gemini-2.5-flash" } };
  const app = buildApp({ config, store: createStore(":memory:") });
  app.log.level = "silent";
  const put = (body: object) => app.inject({ method: "PUT", url: "/api/settings", payload: body });
  expect((await put({ gemini: { apiKey: "short\nX=1" } })).statusCode).toBe(400);
  const got = (await app.inject({ url: "/api/settings" })).body;
  expect(got).not.toContain("secret-key");
  expect(JSON.parse(got).geminiKey).toBe("…1234");
  expect((await put({ gemini: null })).statusCode).toBe(200);
  expect(config.fallback).toBeNull();
  expect(config.provider).toBe("ollama");
  await app.close();
});

it("painting model: only an installed checkpoint (or the default) can be picked, and it applies at once", async () => {
  const { paintCheckpoint } = await import("@anim/ai");
  const dir = mkdtempSync(join(tmpdir(), "comfy-"));
  const ckpts = join(dir, "ComfyUI", "models", "checkpoints");
  (await import("node:fs")).mkdirSync(ckpts, { recursive: true });
  for (const f of ["mine-xl.safetensors", "sam3.1_multiplex_fp16.safetensors", "notes.txt"]) writeFileSync(join(ckpts, f), "");
  process.env.COMFY_DIR = dir;
  process.env.COMFY_URL = "http://127.0.0.1:9"; // not running: read the folder
  const app = buildApp({ config: { provider: "ollama", ollamaUrl: "http://127.0.0.1:9", ollamaModel: "m:1b", fallback: null }, store: createStore(":memory:") });
  app.log.level = "silent";
  expect((await app.inject({ url: "/api/settings" })).json().painting.installed).toEqual(["mine-xl.safetensors"]);
  expect((await app.inject({ method: "PUT", url: "/api/settings", payload: { paint: "../../evil\nX=1" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "PUT", url: "/api/settings", payload: { paint: "mine-xl.safetensors" } })).statusCode).toBe(200);
  expect(paintCheckpoint()).toBe("mine-xl.safetensors");
  await app.close();
});

it("install: runs the installer in the background and reports its step, percent and failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inst-"));
  const script = join(dir, "fake-setup.mjs");
  // prints like setup-painter.mjs: a log line, then curl's progress meter, then fails
  writeFileSync(script, `console.log("[setup:painter] downloading animagine …"); process.stderr.write("  42 9500M   42 4000M    0     0  50.0M      0  0:03:10\\r"); setTimeout(() => { console.error("Error: Only 3 GB free\\n    at file:///x.mjs:50:9\\n\\nNode.js v22.18.0"); process.exit(1); }, 300);`);
  process.env.ANIM_PAINTER_SCRIPT = script;
  const app = buildApp({ config: { provider: "ollama", ollamaUrl: "http://127.0.0.1:9", ollamaModel: "m:1b", fallback: null }, store: createStore(":memory:") });
  app.log.level = "silent";
  const inst = (what: string) => app.inject({ method: "POST", url: "/api/settings/install", payload: { what } });
  expect((await inst("../../etc")).statusCode).toBe(400);
  expect((await inst("painter")).statusCode).toBe(200);
  expect((await inst("video")).statusCode).toBe(409); // one install at a time
  const state = async () => (await app.inject({ url: "/api/settings" })).json().components.find((c: { id: string }) => c.id === "painter").install;
  await expect.poll(state).toMatchObject({ status: "running", step: "downloading animagine …", percent: 42 });
  await expect.poll(state).toMatchObject({ status: "error", step: "Only 3 GB free" });
  await app.close();
});

it("pull: downloads a language model through Ollama with progress", async () => {
  const { createServer } = await import("node:http");
  let release = () => {};
  const ollama = createServer((req, res) => {
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [] }));
    res.write(JSON.stringify({ status: "pulling", total: 100, completed: 30 }) + "\n");
    release = () => res.end(JSON.stringify({ status: "success" }) + "\n");
  });
  await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", r));
  const a = ollama.address();
  const app = buildApp({ config: { provider: "ollama", ollamaUrl: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, ollamaModel: "m:1b", fallback: null }, store: createStore(":memory:") });
  app.log.level = "silent";
  expect((await app.inject({ method: "POST", url: "/api/settings/pull", payload: { model: "bad name;" } })).statusCode).toBe(400);
  expect((await app.inject({ method: "POST", url: "/api/settings/pull", payload: { model: "qwen2.5-coder:7b" } })).statusCode).toBe(200);
  const pull = async () => (await app.inject({ url: "/api/settings" })).json().models.find((m: { id: string }) => m.id === "qwen2.5-coder:7b").pull;
  await expect.poll(pull).toMatchObject({ status: "running", percent: 30 });
  release();
  await expect.poll(pull).toMatchObject({ status: "done", percent: 100 });
  await app.close();
  ollama.close();
});
