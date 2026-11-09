import type { Provider } from "@anim/ai";
import { PLAN, painter } from "./fake-painter";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";


const dir = mkdtempSync(join(tmpdir(), "anim-layered-"));
process.env.IMAGES_DIR = join(dir, "images");
const answers: unknown[] = [];
// a short think, so a cancel sent right after starting lands mid-job
const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => (await new Promise((r) => setTimeout(r, 150)), JSON.stringify(answers.shift() ?? PLAN)) };
const config = { provider: "ollama" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null };
const start = () => buildApp({ provider, painter, config, store: createStore(join(dir, "test.db")) });
let app = start();
let base = "";

beforeAll(async () => {
  app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(async () => {
  await app.close();
  delete process.env.IMAGES_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const events = async (jobId: string) =>
  [...(await (await fetch(`${base}/api/jobs/${jobId}/events`)).text()).matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
const REQ = { prompt: "A girl is sleeping on a balcony at night. At 3 seconds she wakes up and looks at the clock.", duration: 6, aspect: "16:9" };

it("a cancelled job ends with an error and never sends a scene", async () => {
  const { jobId } = (await (await post("/api/generate", REQ)).json()) as { jobId: string };
  await post(`/api/jobs/${jobId}/cancel`, {});
  const ev = await events(jobId);
  expect(ev.map((e) => e.type)).not.toContain("done");
  expect(ev.find((e) => e.type === "error")?.data.message).toBe("Cancelled");
});

it("generates a layered scene over SSE, serves its assets, and it survives save, restart and reopen", async () => {
  const { jobId } = (await (await post("/api/generate", REQ)).json()) as { jobId: string };
  const ev = await events(jobId);
  const types = ev.map((e) => e.type);
  expect(types).toEqual(expect.arrayContaining(["plan", "asset", "done", "end"]));
  expect(types).not.toContain("error");
  const spec = ev.find((e) => e.type === "done")!.data.spec as { layers: { id: string; parent?: string; pivot?: number[] }[]; assets: Record<string, { src: string }>; actions: unknown[]; tracks: Record<string, unknown> };
  expect(spec.layers.map((l) => l.id)).toEqual(["balcony_background", "clock", "girl", "girl_body", "girl_head"]);
  for (const a of Object.values(spec.assets)) expect((await fetch(`${base}${a.src}`)).status).toBe(200);

  const { id } = (await (await post("/api/projects", { spec, label: "AI scene" })).json()) as { id: string };
  await app.close();
  app = start();
  app.log.level = "silent";
  await app.ready();
  const got = app.inject({ method: "GET", url: `/api/projects/${id}` });
  const reopened = (await got).json().spec;
  expect(reopened.assets).toEqual(spec.assets);
  expect(reopened.actions).toEqual(spec.actions);
  expect(reopened.tracks).toEqual(spec.tracks);
  expect(reopened.layers.find((l: { id: string }) => l.id === "girl_head")).toMatchObject({ parent: "girl_body", pivot: spec.layers[4].pivot });
  const img = await app.inject({ method: "GET", url: spec.assets.girl_head.src });
  expect(img.statusCode).toBe(200);

  // delete the head in a new version, then restore the previous one: its asset, rig and actions come back and still load
  const assets = Object.fromEntries(Object.entries(spec.assets).filter(([k]) => k !== "girl_head"));
  const cut = { ...spec, assets, layers: spec.layers.filter((l) => l.id !== "girl_head"), actions: [] };
  expect((await app.inject({ method: "PUT", url: `/api/projects/${id}`, payload: { spec: cut } })).statusCode).toBe(200);
  const restored = (await app.inject({ method: "POST", url: `/api/projects/${id}/undo` })).json().spec;
  expect(restored.assets).toEqual(spec.assets);
  expect(restored.actions).toEqual(spec.actions);
  expect(restored.layers.find((l: { id: string }) => l.id === "girl_head")).toMatchObject({ parent: "girl_body" });
  expect((await app.inject({ method: "GET", url: restored.assets.girl_head.src })).statusCode).toBe(200);
});

it("re-cuts a part from its stored source and mask, refuses a cleanup that breaks it, and keeps profiles across generations", async () => {
  // the test before restarts the app without a listener
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const { jobId } = (await (await post("/api/generate", REQ)).json()) as { jobId: string };
  type Spec = { assets: Record<string, { src: string; from?: string; mask?: string; crop?: number[] }>; characters: Record<string, { reference?: string; look: string }> };
  const spec = (await events(jobId)).find((e) => e.type === "done")!.data.spec as Spec;
  const head = spec.assets.girl_head;
  const body = (cleanup: object) => ({ from: spec.assets[head.from!].src, mask: spec.assets[head.mask!].src, cleanup, name: "head" });

  const r = await post("/api/parts/recut", body({ grow: -1, holes: 0, specks: 0, feather: 1 }));
  expect(r.status).toBe(200);
  const cut = (await r.json()) as { src: string; crop: number[]; checks: { name: string }[] };
  expect(cut.crop[0]).toBeGreaterThan(head.crop![0]);
  expect(cut.checks.map((c) => c.name)).toContain("edges");
  expect((await fetch(`${base}${cut.src}`)).status).toBe(200);

  expect((await post("/api/parts/recut", body({ grow: -20, holes: 0, specks: 0, feather: 0 }))).status).toBe(422);
  expect((await post("/api/parts/recut", { ...body({}), from: "/api/images/000000000000000000000000.png" })).status).toBe(404);

  // a second generation, handed the saved profile, keeps it as it was
  const girl = { ...spec.characters.girl, look: "girl, hoodie, green scarf" };
  const again = (await (await post("/api/generate", { ...REQ, characters: { girl }, assets: { [girl.reference!]: spec.assets[girl.reference!] } })).json()) as { jobId: string };
  const next = (await events(again.jobId)).find((e) => e.type === "done")!.data.spec as Spec;
  expect(next.characters.girl.look).toBe("girl, hoodie, green scarf");
  expect(next.assets.girl_reference.src).toBe(spec.assets[girl.reference!].src);
});
