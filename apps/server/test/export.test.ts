import type { Provider } from "@anim/ai";
import { createRenderer, imageSources, registerImage, validateScene } from "@anim/engine";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";
import { ffmpegBin } from "../src/images";
import { PLAN, painter } from "./fake-painter";

const dir = mkdtempSync(join(tmpdir(), "anim-export-"));
process.env.IMAGES_DIR = join(dir, "images");
process.env.EXPORTS_DIR = join(dir, "exports");
const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => JSON.stringify(PLAN) };
const config = { provider: "ollama" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null };
const app = buildApp({ provider, painter, config, store: createStore(join(dir, "test.db")) });
let base = "";
let spec: unknown;

const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const events = async (jobId: string) =>
  [...(await (await fetch(`${base}/api/jobs/${jobId}/events`)).text()).matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
const run = async (body: unknown) => events(((await (await post("/api/export", body)).json()) as { jobId: string }).jobId);

/** Frame n of an MP4, decoded to RGBA. */
const frameOf = (file: string, n: number, w: number, h: number) => {
  const r = spawnSync(ffmpegBin, ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n})`, "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: w * h * 8 });
  expect(r.status).toBe(0);
  return new Uint8Array(r.stdout);
};
// ffmpeg prints running "frame= N" totals while decoding; the last one is the count
const countFrames = (file: string) => Number([...spawnSync(ffmpegBin, ["-i", file, "-map", "0:v", "-f", "null", "-"]).stderr.toString().matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]);
/** Mean difference per colour channel, 0–255; video compression keeps this small, a wrong frame does not. */
const diff = (a: Uint8Array, b: Uint8Array) => {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return d / ((a.length / 4) * 3);
};

beforeAll(async () => {
  app.log.level = "silent";
  await app.listen({ port: 0, host: "127.0.0.1" });
  const a = app.server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const { jobId } = (await (await post("/api/generate", { prompt: "A girl is sleeping on a balcony at night. At 3 seconds she wakes up and looks at the clock.", duration: 6, aspect: "16:9" })).json()) as { jobId: string };
  spec = (await events(jobId)).find((e) => e.type === "done")!.data.spec;
});
afterAll(async () => {
  await app.close();
  delete process.env.IMAGES_DIR;
  delete process.env.EXPORTS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

it("exports the layered scene as a playable MP4 with every frame, matching the preview", { timeout: 60_000 }, async () => {
  const ev = await run({ spec, preset: "draft" });
  expect(ev.map((e) => e.type)).not.toContain("error");
  const progress = ev.filter((e) => e.type === "progress").map((e) => e.data.frame as number);
  expect(progress.at(-1)).toBe(144);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  const done = ev.find((e) => e.type === "done")!.data as { url: string; frames: number; width: number; height: number; fps: number };
  expect(done).toMatchObject({ frames: 6 * 24, width: 960, height: 540, fps: 24 });

  const res = await fetch(`${base}${done.url}?download`);
  expect(res.headers.get("content-type")).toBe("video/mp4");
  expect(res.headers.get("content-disposition")).toMatch(/attachment/);
  const file = join(dir, "exports", done.url.split("/").pop()!);
  expect(countFrames(file)).toBe(144);

  // the editor preview draws spec at t with the same engine; frame i of the MP4 must be that picture at t = i / fps
  const s = validateScene(spec);
  if (!s.ok) throw new Error(s.errors.join("; "));
  for (const src of imageSources(s.spec)) registerImage(src, await loadImage(readFileSync(join(dir, "images", src.split("/").pop()!))));
  const canvas = createCanvas(960, 540);
  const r = createRenderer(canvas, s.spec, { createCanvas: (w, h) => createCanvas(w, h) });
  const still = (t: number) => (r.render(t), new Uint8Array(canvas.data()));
  for (const t of [0, 2.9, 3, 4, 5, 5.9]) {
    const n = Math.round(t * 24);
    const got = frameOf(file, n, 960, 540);
    expect(got.length).toBe(960 * 540 * 4);
    expect(diff(got, still(n / 24)), `frame at ${t}s`).toBeLessThan(3);
  }
  // and the head really turned: the start and the end of the look differ by more than compression noise
  expect(diff(still(2.9), still(5))).toBeGreaterThan(0);
});

it("letterboxes a scene into a preset of another shape instead of stretching it", { timeout: 60_000 }, async () => {
  const wide = { version: 1, meta: { title: "Bars", duration: 1, fps: 30, width: 1280, height: 720 }, palette: {}, layers: [{ id: "bg", type: "paper", params: { color: "#ffffff" } }] };
  const ev = await run({ spec: wide, preset: "vertical" });
  const done = ev.find((e) => e.type === "done")!.data as { url: string; frames: number };
  expect(done.frames).toBe(30);
  const f = frameOf(join(dir, "exports", done.url.split("/").pop()!), 0, 1080, 1920);
  const px = (x: number, y: number) => f[(y * 1080 + x) * 4];
  // a 16:9 scene in a 9:16 frame: 1080×608 of picture centred, black above and below
  expect(px(540, 100)).toBeLessThan(20);
  expect(px(540, 960)).toBeGreaterThan(235);
  expect(px(540, 1820)).toBeLessThan(20);
});

it("rejects bad input, and a cancelled export leaves no file behind", async () => {
  expect((await post("/api/export", { spec, preset: "imax" })).status).toBe(400);
  expect((await post("/api/export", { spec: { nope: 1 }, preset: "draft" })).status).toBe(400);
  // an image src is read from disk, so one pointing outside the images folder must not be
  const s = spec as { assets: Record<string, { src: string }> };
  const broken = { ...s, assets: { ...s.assets, clock: { ...s.assets.clock, src: "/api/images/../test.db" } } };
  const bad = await run({ spec: broken, preset: "draft" });
  expect(bad.find((e) => e.type === "error")?.data.message).toMatch(/outside the library/);

  const { jobId } = (await (await post("/api/export", { spec, preset: "youtube" })).json()) as { jobId: string };
  await post(`/api/jobs/${jobId}/cancel`, {});
  const ev = await events(jobId);
  expect(ev.find((e) => e.type === "error")?.data.message).toBe("Cancelled");
  expect(ev.map((e) => e.type)).not.toContain("done");
  expect(readdirSync(join(dir, "exports")).filter((f) => f.includes("youtube"))).toEqual([]);
  expect(existsSync(join(dir, "exports"))).toBe(true);
});
