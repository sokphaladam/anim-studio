import type { Provider } from "@anim/ai";
import { createRenderer, fixLoop, imageSources, registerImage, validateScene } from "@anim/engine";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createStore } from "../src/db";
import { ffmpegBin } from "../src/images";
import { unzip, zip } from "../src/zip";
import { PLAN, painter } from "./fake-painter";

const dir = mkdtempSync(join(tmpdir(), "anim-package-"));
const provider: Provider = { name: "mock", model: "mock", generateJSON: async () => JSON.stringify(PLAN) };
const config = { provider: "ollama" as const, ollamaUrl: "http://127.0.0.1:9", ollamaModel: "x", fallback: null };
/** An app with its own data folders: "machine" a and b share nothing. */
function machine(name: string) {
  process.env.IMAGES_DIR = join(dir, name, "images");
  process.env.EXPORTS_DIR = join(dir, name, "exports");
  const app = buildApp({ provider, painter, config, store: createStore(join(dir, name, "db.sqlite")) });
  return { app, images: process.env.IMAGES_DIR, exports: process.env.EXPORTS_DIR };
}
const a = machine("a");
const b = machine("b");
let base = "";
let spec: Record<string, unknown>;
let pkg: Buffer;
let pkgName = "";

const post = (url: string, body: unknown) => fetch(`${base}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const events = async (jobId: string) =>
  [...(await (await fetch(`${base}/api/jobs/${jobId}/events`)).text()).matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map((m) => ({ type: m[1], data: JSON.parse(m[2]) as Record<string, unknown> }));
const build = async (s: unknown) => {
  const { jobId } = (await (await post("/api/package", { spec: s, preset: "draft", quality: "draft", fit: "cover" })).json()) as { jobId: string };
  return events(jobId);
};
const check = async (zipped: Buffer, app = a.app) => (await app.inject({ method: "POST", url: "/api/package/check", headers: { "content-type": "application/zip" }, payload: zipped })).json() as { ok: boolean; errors?: string[]; manifest?: Record<string, unknown> };
/** The package with some entries changed (undefined removes one), re-zipped. */
const alter = (changes: Record<string, Buffer | undefined>) => {
  const e = unzip(pkg);
  const out = new Map(e);
  for (const [k, v] of Object.entries(changes)) if (v === undefined) out.delete(k);
  else out.set(k, v);
  return zip([...out].map(([name, data]) => ({ name, data })));
};

beforeAll(async () => {
  a.app.log.level = b.app.log.level = "silent";
  await a.app.listen({ port: 0, host: "127.0.0.1" });
  const ad = a.app.server.address();
  base = `http://127.0.0.1:${typeof ad === "object" && ad ? ad.port : 0}`;
  const { jobId } = (await (await post("/api/generate", { prompt: "A girl is sleeping on a balcony at night. At 3 seconds she wakes up and looks at the clock.", duration: 6, aspect: "16:9" })).json()) as { jobId: string };
  spec = (await events(jobId)).find((e) => e.type === "done")!.data.spec as Record<string, unknown>;
}, 60_000);
afterAll(async () => {
  await a.app.close();
  await b.app.close();
  delete process.env.IMAGES_DIR;
  delete process.env.EXPORTS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

it("a generated scene's loop is checked and reported; fixed, it validates and is packaged with a manifest that matches the MP4", { timeout: 120_000 }, async () => {
  // as generated, the girl turns to the clock and holds it to the end: the loop jumps
  const raw = await build(spec);
  const first = raw.find((e) => e.type === "done")!.data as { manifest: { video: { loopValidated: boolean } }; report: { issues: { kind: string; id: string }[] } };
  expect(first.manifest.video.loopValidated).toBe(false);
  expect(first.report.issues.some((i) => i.kind === "action" && /looks_at/.test(i.id))).toBe(true);

  const v = validateScene(spec);
  if (!v.ok) throw new Error();
  const fixed = fixLoop(v.spec, (w, h) => createCanvas(w, h));
  const ev = await build(fixed.spec);
  expect(ev.filter((e) => e.type === "progress").map((e) => e.data.stage)).toEqual(expect.arrayContaining(["check", "render", "pack"]));
  const done = ev.find((e) => e.type === "done")!.data as { url: string; name: string; manifest: { video: Record<string, unknown>; files: { path: string }[] } };
  pkgName = done.name;
  pkg = Buffer.from(await (await fetch(`${base}${done.url}?download`)).arrayBuffer());
  expect(done.manifest.video).toMatchObject({ codec: "h264", pixelFormat: "yuv420p", colorSpace: "bt709", width: 960, height: 540, fps: 24, frames: 144, duration: 6, audio: false, loop: true, loopValidated: true });

  const entries = unzip(pkg);
  expect([...entries.keys()].slice(0, 1)).toEqual(["manifest.json"]);
  expect([...entries.keys()]).toEqual(expect.arrayContaining(["animation.mp4", "scene.spec.json", "quality-report.json"]));
  // no paths that only mean something on this machine
  const scene = entries.get("scene.spec.json")!.toString();
  expect(scene).not.toMatch(/\/api\/images|[A-Za-z]:\\\\|anim-package-/);
  expect(done.manifest.files.filter((f) => f.path.startsWith("assets/")).length).toBeGreaterThan(5);
  expect((await check(pkg)).ok).toBe(true);

  // the real ffprobe, when installed, agrees with the manifest
  const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_streams", "-of", "json", "-"], { input: entries.get("animation.mp4") });
  if (probe.status === 0) {
    const streams = JSON.parse(probe.stdout.toString()).streams as { codec_type: string; width?: number; height?: number; nb_read_frames?: string; color_space?: string }[];
    expect(streams.filter((s) => s.codec_type === "audio")).toEqual([]);
    expect(streams[0]).toMatchObject({ width: 960, height: 540, nb_read_frames: "144", color_space: "bt709" });
  }
});

it("refuses unsafe, newer, tampered, incomplete or padded packages, saying why", async () => {
  const manifest = JSON.parse(unzip(pkg).get("manifest.json")!.toString());
  const asset = manifest.files.find((f: { path: string }) => f.path.startsWith("assets/")).path as string;
  const cases: [Buffer, RegExp][] = [
    [alter({ "../evil.sh": Buffer.from("x") }), /Unsafe path in the package: "\.\.\/evil\.sh"/],
    [alter({ "C:/Windows/evil.dll": Buffer.from("x") }), /Unsafe path/],
    [alter({ "manifest.json": Buffer.from(JSON.stringify({ ...manifest, version: 99 })) }), /Unsupported package version 99/],
    [alter({ [asset]: Buffer.from("not the image") }), new RegExp(`Checksum mismatch: ${asset}`)],
    [alter({ [asset]: undefined }), new RegExp(`Missing file: ${asset}`)],
    [alter({ "assets/extra.png": Buffer.from("x") }), /Unlisted file in the package: assets\/extra.png/],
    [alter({ "manifest.json": Buffer.from(JSON.stringify({ ...manifest, files: [...manifest.files, { path: "assets/../../x", sha256: "0".repeat(64), bytes: 0 }] })) }), /relative path inside the package/],
    [Buffer.from("not a zip"), /not a ZIP/],
  ];
  for (const [zipped, why] of cases) {
    const r = await check(zipped);
    expect(r.ok, String(why)).toBe(false);
    expect(r.errors!.join("\n")).toMatch(why);
  }
  // a scene pointing outside the package (an absolute path), with its checksum updated so only that is wrong
  const scene = JSON.parse(unzip(pkg).get("scene.spec.json")!.toString().replace(/"assets\/([a-f0-9]{24}\.png)"/, '"/home/me/$1"'));
  const sceneBuf = Buffer.from(JSON.stringify(scene));
  const m2 = { ...manifest, files: manifest.files.map((f: { path: string }) => (f.path === "scene.spec.json" ? { ...f, sha256: createHash("sha256").update(sceneBuf).digest("hex"), bytes: sceneBuf.length } : f)) };
  const r = await check(alter({ "scene.spec.json": sceneBuf, "manifest.json": Buffer.from(JSON.stringify(m2)) }));
  expect(r.errors!.join()).toMatch(/outside the package/);
});

it("imports on another machine with an empty library: the project opens, its images are served, and it renders like the MP4", { timeout: 60_000 }, async () => {
  expect(existsSync(b.images) ? readdirSync(b.images).length : 0).toBe(0);
  const res = await b.app.inject({ method: "POST", url: "/api/package/import", headers: { "content-type": "application/zip" }, payload: pkg });
  expect(res.statusCode).toBe(200);
  const { id } = res.json() as { id: string };
  const opened = (await b.app.inject({ method: "GET", url: `/api/projects/${id}` })).json().spec;
  const v = validateScene(opened);
  if (!v.ok) throw new Error(v.errors.join());
  for (const src of imageSources(v.spec)) {
    expect((await b.app.inject({ method: "GET", url: src })).statusCode).toBe(200);
    registerImage(src, await loadImage(readFileSync(join(b.images, src.split("/").pop()!))));
  }
  const c = createCanvas(960, 540);
  createRenderer(c, v.spec, { createCanvas: (w, h) => createCanvas(w, h) }).render(0, { quality: "draft", fit: "cover" });
  const mp4 = join(dir, "check.mp4");
  writeFileSync(mp4, unzip(pkg).get("animation.mp4")!);
  const frame = new Uint8Array(spawnSync(ffmpegBin, ["-v", "error", "-i", mp4, "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 960 * 540 * 8 }).stdout);
  const px = c.data();
  let d = 0;
  for (let i = 0; i < frame.length; i += 4) d += Math.abs(frame[i] - px[i]) + Math.abs(frame[i + 1] - px[i + 1]) + Math.abs(frame[i + 2] - px[i + 2]);
  expect(d / ((frame.length / 4) * 3)).toBeLessThan(4);
});

it("a cancelled package build leaves nothing behind and doesn't touch the last finished package", { timeout: 60_000 }, async () => {
  const before = createHash("sha256").update(readFileSync(join(a.exports, pkgName))).digest("hex");
  const { jobId } = (await (await post("/api/package", { spec, preset: "draft", quality: "draft" })).json()) as { jobId: string };
  await post(`/api/jobs/${jobId}/cancel`, {});
  const ev = await events(jobId);
  expect(ev.map((e) => e.type)).not.toContain("done");
  const left = readdirSync(a.exports);
  expect(left.filter((f) => f.endsWith(".part") || f.startsWith(".stage-"))).toEqual([]);
  expect(createHash("sha256").update(readFileSync(join(a.exports, pkgName))).digest("hex")).toBe(before);
});
