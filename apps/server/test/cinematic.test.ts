import { SceneSpecSchema } from "@anim/spec";
import type { Provider, VideoProvider } from "@anim/ai";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";
import { ffmpegBin } from "../src/images";
import { PLAN, painter } from "./fake-painter";

const dir = mkdtempSync(join(tmpdir(), "anim-cinematic-"));
process.env.IMAGES_DIR = join(dir, "images");
// real MP4s, so clips go through the same frame splitting and checks as a provider's: a 6 s test pattern (the default
// shot of the 6 s plan) passes; a 6 s flat colour is blank and fails
const make = (name: string, src: string) => (spawnSync(ffmpegBin, ["-v", "error", "-f", "lavfi", "-i", `${src}s=128x72:d=6:r=24`, "-pix_fmt", "yuv420p", join(dir, name)]), new Uint8Array(readFileSync(join(dir, name))));
const good = make("good.mp4", "testsrc=");
const blank = make("blank.mp4", "color=c=red:");

const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => JSON.stringify(PLAN) };
const config = { provider: "ollama" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null };

/** A fake provider that plays a script, one entry per task: "down" fails to start, "bad" ends failed, else returns that clip. */
function fakeVideo(script: ("down" | "bad" | Uint8Array)[], costUsd = 0.4) {
  const firstFrames: Uint8Array[] = [];
  let n = 0;
  const p: VideoProvider = {
    id: "fake",
    model: "v1",
    async createTask(q) {
      const step = script[Math.min(n, script.length - 1)];
      if (step === "down") {
        n++;
        throw new Error("provider is down");
      }
      firstFrames.push(q.firstFrame);
      return { provider: "fake", providerTaskId: `task-${++n}`, model: "v1", status: "queued", estimatedCostUsd: costUsd };
    },
    async getTask(t) {
      const step = script[Math.min(Number(t.providerTaskId.slice(5)) - 1, script.length - 1)];
      return step === "bad" ? { task: { ...t, status: "failed" }, error: "content moderation" } : { task: { ...t, status: "succeeded" }, bytes: step as Uint8Array };
    },
    cancelTask: async () => {},
  };
  return { p, firstFrames, tasks: () => n };
}

const apps: ReturnType<typeof buildApp>[] = [];
afterAll(async () => {
  for (const a of apps) await a.close();
  delete process.env.IMAGES_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function start(cloudVideo: VideoProvider) {
  const app = buildApp({ provider, painter, config, store: createStore(":memory:"), cloudVideo });
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
const REQ = { prompt: "A girl sleeps on a balcony at night", duration: 6, aspect: "16:9", cinematic: true };
type Shot = { id: string; status: string; attempts: number; review?: string; footage?: { frames: string; count: number }; source: string; taskId?: string; costUsd?: number };
const final = (ev: { type: string; data: Record<string, unknown> }[]) => ev.filter((e) => e.type === "shot" && e.data.status !== "running").map((e) => e.data.shot as Shot);

it("one prompt makes the editable scene, its quality report, then a checked cinematic shot from its first frame", async () => {
  const f = fakeVideo([good]);
  const { app, events } = await start(f.p);
  const ev = await events("/api/generate", REQ);
  const types = ev.map((e) => e.type);
  expect(types).not.toContain("error");
  expect(types.indexOf("done")).toBeLessThan(types.indexOf("quality"));
  expect(types.indexOf("quality")).toBeLessThan(types.indexOf("shot"));
  const [shot] = final(ev);
  expect(shot).toMatchObject({ id: "scene", status: "ready", attempts: 1, source: "fake v1", taskId: "task-1", costUsd: 0.4 });
  expect((await app.inject({ method: "GET", url: `${shot.footage!.frames}001.jpg` })).statusCode).toBe(200);
  // the first frame sent to the provider is the editable scene rendered at the shot's start
  expect(String.fromCharCode(...f.firstFrames[0].slice(1, 4))).toBe("PNG");
  const spec = ev.find((e) => e.type === "done")!.data.spec as Record<string, unknown>;
  expect(SceneSpecSchema.safeParse({ ...spec, cinematic: [shot] }).success).toBe(true);
}, 60_000); // the provider is polled every 5 s

it("retries a failed shot once, then succeeds without touching the scene", async () => {
  const f = fakeVideo(["down", good]);
  const { events } = await start(f.p);
  const [shot] = final(await events("/api/generate", REQ));
  expect(shot).toMatchObject({ status: "ready", attempts: 2 });
}, 60_000);

it("a clip that keeps failing its checks ends as needs-review with the reason, never as ready", async () => {
  const f = fakeVideo([blank]);
  const { events } = await start(f.p);
  const ev = await events("/api/generate", REQ);
  const [shot] = final(ev);
  expect(shot).toMatchObject({ status: "review", attempts: 2 });
  expect(shot.review).toMatch(/Blank frames/);
  expect(ev.map((e) => e.type)).toContain("done"); // the editable scene still arrived
}, 60_000);

it("stops at the job's spend limit: no retry that would go over it", async () => {
  // $3 per task under the default $5 limit: the first try spends $3, so a second $3 try is refused, not started
  const f = fakeVideo(["bad"], 3);
  const { events } = await start(f.p);
  const ev = await events("/api/generate", REQ);
  const [shot] = final(ev);
  expect(shot).toMatchObject({ status: "failed", attempts: 2 });
  expect(shot.review).toMatch(/left to spend/);
  expect(ev.map((e) => e.type)).not.toContain("error");
}, 60_000);

it("redoes only the shots that aren't ready, from their saved prompts", async () => {
  const f = fakeVideo(["down", "down", good]);
  const { events } = await start(f.p);
  const ev = await events("/api/generate", REQ);
  const [failed] = final(ev);
  expect(failed).toMatchObject({ status: "failed", attempts: 2 });
  const spec = { ...(ev.find((e) => e.type === "done")!.data.spec as object), cinematic: [failed, { ...failed, id: "kept", status: "ready" }] };
  const redo = await events("/api/shots/retry", { spec });
  expect(redo.map((e) => e.type)).not.toContain("done"); // no scene is rebuilt
  expect(final(redo)).toEqual([expect.objectContaining({ id: "scene", status: "ready", attempts: 1 })]);
}, 60_000);
