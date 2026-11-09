// M12 hardening: no paid request when cloud is off, restarts, corrupt media. Never calls a real provider.
import type { Provider, VideoProvider } from "@anim/ai";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";
import { ffmpegBin } from "../src/images";
import { PLAN, painter } from "./fake-painter";

const dir = mkdtempSync(join(tmpdir(), "anim-hardening-"));
process.env.IMAGES_DIR = join(dir, "images");
spawnSync(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=128x72:d=6:r=24", "-pix_fmt", "yuv420p", join(dir, "good.mp4")]);
const good = new Uint8Array(readFileSync(join(dir, "good.mp4")));
const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => JSON.stringify(PLAN) };
const config = { provider: "ollama" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null };
const REQ = { prompt: "A girl sleeps on a balcony at night", duration: 6, aspect: "16:9", cinematic: true };

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  for (const a of apps) await a.close();
  delete process.env.IMAGES_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function start(o: Parameters<typeof buildApp>[0] = {}) {
  const app = buildApp({ provider, painter, config, store: createStore(":memory:"), pollMs: 1, ...o });
  apps.push(app);
  app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  const base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const events = async (url: string, payload: Record<string, unknown>) => {
    const { jobId } = (await app.inject({ method: "POST", url, payload })).json() as { jobId: string };
    const text = await (await fetch(`${base}/api/jobs/${jobId}/events`)).text();
    return [...text.matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
  };
  return { app, events };
}

/** A fake provider whose every task finishes with `bytes`. */
const fakeVideo = (bytes: Uint8Array): VideoProvider => ({
  id: "fake",
  model: "v1",
  createTask: async () => ({ provider: "fake", providerTaskId: "task-1", model: "v1", status: "queued", estimatedCostUsd: 0.4 }),
  getTask: async (t) => ({ task: { ...t, status: "succeeded" }, bytes }),
  cancelTask: async () => {},
});

it("makes no paid request when cloud video is off, even with a key in the environment", async () => {
  vi.stubEnv("RUNWAY_API_KEY", "key_should_not_be_used");
  vi.stubEnv("CLOUD_VIDEO_ENABLED", "0");
  const real = globalThis.fetch;
  const runwayCalls: string[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => (String(url).includes("runwayml") && runwayCalls.push(String(url)), real(url, init)));
  try {
    const { app, events } = await start();
    expect((await app.inject({ method: "GET", url: "/api/health/painter" })).json()).toMatchObject({ cloudVideo: null, cloudQuote: null });
    const ev = await events("/api/generate", REQ);
    expect(ev.map((e) => e.type)).toContain("done"); // the editable scene is still made
    expect(ev.find((e) => e.type === "warning")?.data.message).toMatch(/No video model/);
    expect(runwayCalls).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
}, 60_000);

it("a corrupt clip from the provider fails the shot with a reason, never the editable scene", async () => {
  const { events } = await start({ cloudVideo: fakeVideo(new TextEncoder().encode("<html>not a video</html>")) });
  const ev = await events("/api/generate", REQ);
  expect(ev.map((e) => e.type)).not.toContain("error");
  expect(ev.map((e) => e.type)).toContain("done");
  const shot = ev.filter((e) => e.type === "shot" && e.data.status !== "running").at(-1)!.data.shot as { status: string; attempts: number; review: string };
  expect(shot).toMatchObject({ status: "failed", attempts: 2 });
  expect(shot.review).toMatch(/Couldn't split the video/);
}, 60_000);

it("after a restart, collects the clip of a cloud task that was still running and lists it", async () => {
  // what a crash mid-generation leaves behind: a journaled task, already paid for
  writeFileSync(join(dir, "cloud-tasks.json"), JSON.stringify([{ task: { provider: "fake", providerTaskId: "task-9", model: "v1", status: "running", estimatedCostUsd: 1.2 }, fps: 24, prompt: "rain", startedAt: 1, status: "running" }]));
  const { app } = await start({ cloudVideo: fakeVideo(good) });
  let list: { taskId: string; footage?: { frames: string; count: number } }[] = [];
  for (let i = 0; i < 100 && !list.length; i++) {
    await new Promise((ok) => setTimeout(ok, 50));
    list = (await app.inject({ method: "GET", url: "/api/video/recovered" })).json();
  }
  expect(list).toMatchObject([{ taskId: "task-9", costUsd: 1.2, prompt: "rain", footage: { count: 144 } }]);
  expect((await app.inject({ method: "GET", url: `${list[0].footage!.frames}001.jpg` })).statusCode).toBe(200);
  // a second restart doesn't fetch it again, and a corrupt journal doesn't stop the server
  expect(JSON.parse(readFileSync(join(dir, "cloud-tasks.json"), "utf8"))[0].status).toBe("recovered");
  writeFileSync(join(dir, "cloud-tasks.json"), "{not json");
  const again = await start({ cloudVideo: fakeVideo(good) });
  expect((await again.app.inject({ method: "GET", url: "/api/video/recovered" })).json()).toEqual([]);
}, 60_000);

it("a saved project with a cinematic shot reopens after a restart with all its frames", async () => {
  const file = join(dir, "restart.db");
  const first = await start({ store: createStore(file), cloudVideo: fakeVideo(good) });
  const ev = await first.events("/api/generate", REQ);
  const spec = ev.find((e) => e.type === "done")!.data.spec as Record<string, unknown>;
  const shot = ev.filter((e) => e.type === "shot" && e.data.status === "done").at(-1)!.data.shot as { footage: { frames: string; count: number } };
  const { id } = (await first.app.inject({ method: "POST", url: "/api/projects", payload: { spec: { ...spec, cinematic: [shot] }, label: "with shot" } })).json() as { id: string };
  await first.app.close();

  const second = await start({ store: createStore(file), cloudVideo: null });
  const got = (await second.app.inject({ method: "GET", url: `/api/projects/${id}` })).json() as { spec: { cinematic: { footage: { frames: string; count: number } }[] } };
  const f = got.spec.cinematic[0].footage;
  expect(f).toEqual(shot.footage);
  for (const i of [1, Math.ceil(f.count / 2), f.count]) expect((await second.app.inject({ method: "GET", url: `${f.frames}${String(i).padStart(3, "0")}.jpg` })).statusCode).toBe(200);
}, 60_000);
