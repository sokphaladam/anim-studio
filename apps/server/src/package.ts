// Portable animation packages (the Anim Studio → CR Content contract in @anim/spec): a ZIP with the silent looping MP4,
// manifest.json, the scene with every image path made relative, the images, and the loop report. Building one is atomic
// (a failed or cancelled build never replaces a finished package); checking one trusts nothing in it.
import { loopReport, validateScene, type LoopReport } from "@anim/engine";
import { PACKAGE_SCHEMA, PACKAGE_VERSION, PackageManifestSchema, PackagePath, type PackageManifest, type SceneSpec } from "@anim/spec";
import { createCanvas } from "@napi-rs/canvas";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportMp4, loadImages, type Preset } from "./export";
import { ffmpegBin } from "./images";
import { unzip, zip } from "./zip";

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const IMAGE = /^\/api\/images\/([a-f0-9]{24}\.png)$/;
const CLIP = /^\/api\/images\/([a-f0-9]{24})\/$/;
const FRAME = /^\d{3}\.jpg$/;

/** Every string in a value, replaced by `fn` (structure kept). */
function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === "string") return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, fn)]));
  return v;
}
function eachString(v: unknown, fn: (s: string) => void) {
  mapStrings(v, (s) => (fn(s), s));
}

/** What an MP4 really is, from ffmpeg's own reading of it (not from its name or our records). */
export function probeMp4(file: string) {
  const info = spawnSync(ffmpegBin, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr;
  const video = /Stream #\d+:\d+[^:]*: Video: (\w+)[^,]*, (\w+)(\([^)]*\))?[^\n]*?, (\d+)x(\d+)[^\n]*?, ([\d.]+) fps/.exec(info);
  const counted = spawnSync(ffmpegBin, ["-hide_banner", "-i", file, "-map", "0:v", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const frames = Number([...counted.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1] ?? 0);
  return {
    codec: video?.[1] ?? "unknown",
    pixelFormat: video?.[2] ?? "unknown",
    colorSpace: /bt709/.test(video?.[3] ?? "") ? "bt709" : "unknown",
    width: Number(video?.[4] ?? 0),
    height: Number(video?.[5] ?? 0),
    fps: Number(video?.[6] ?? 0),
    frames,
    audio: /Stream #\d+:\d+[^:]*: Audio:/.test(info),
  };
}

export type PackageResult = { name: string; manifest: PackageManifest; report: LoopReport };

/**
 * Builds a package for `spec` into exportsDir/<name>.zip: checks the loop, renders the MP4, gathers every image the scene
 * refers to (paintings, cut-outs, masks, sources, footage frames), makes their paths relative, and writes the manifest
 * from the rendered file itself. Everything is staged and the ZIP renamed into place only when complete.
 */
export async function buildPackage(
  spec: SceneSpec,
  opts: { preset: Preset; quality: "draft" | "balanced" | "final"; fit: "contain" | "cover"; sceneId?: string },
  imagesDir: string,
  exportsDir: string,
  progress: (stage: "check" | "render" | "pack", done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<PackageResult> {
  mkdirSync(exportsDir, { recursive: true });
  const slug = spec.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "scene";
  const name = `${slug}-package-${randomBytes(3).toString("hex")}.zip`;
  const stage = mkdtempSync(join(exportsDir, ".stage-"));
  const part = join(exportsDir, `${name}.part`);
  try {
    progress("check", 0, 1);
    await loadImages(spec, imagesDir);
    const report = loopReport(spec, { make: (w, h) => createCanvas(w, h), render: true });
    progress("check", 1, 1);
    signal?.throwIfAborted();

    const mp4 = join(stage, "animation.mp4");
    await exportMp4(spec, opts.preset, imagesDir, mp4, (done, total) => progress("render", done, total), signal, { quality: opts.quality, fit: opts.fit });
    signal?.throwIfAborted();

    progress("pack", 0, 1);
    // every stored image the scene names, under assets/ with the same (content-hash) name
    const files = new Map<string, Uint8Array>();
    const fail = (src: string) => {
      throw new Error(`An image the scene uses is missing: ${src}`);
    };
    eachString(spec, (s) => {
      const img = IMAGE.exec(s), clip = CLIP.exec(s);
      if (img) files.set(`assets/${img[1]}`, existsSync(join(imagesDir, img[1])) ? readFileSync(join(imagesDir, img[1])) : fail(s));
      else if (clip) {
        const dir = join(imagesDir, clip[1]);
        if (!existsSync(dir)) fail(s);
        for (const f of readdirSync(dir).filter((x) => FRAME.test(x))) files.set(`assets/${clip[1]}/${f}`, readFileSync(join(dir, f)));
      }
    });
    const portable = mapStrings(spec, (s) => (IMAGE.test(s) || CLIP.test(s) ? s.replace(/^\/api\/images\//, "assets/") : s));
    files.set("scene.spec.json", Buffer.from(JSON.stringify(portable, null, 2)));
    files.set("quality-report.json", Buffer.from(JSON.stringify(report, null, 2)));
    files.set("animation.mp4", readFileSync(mp4));

    const v = probeMp4(mp4);
    if (v.codec !== "h264" || v.pixelFormat !== "yuv420p" || v.audio) throw new Error(`The rendered video isn't what the package promises (${v.codec}, ${v.pixelFormat}${v.audio ? ", with audio" : ""})`);
    const manifest: PackageManifest = {
      schema: PACKAGE_SCHEMA,
      version: PACKAGE_VERSION,
      title: spec.meta.title,
      ...(opts.sceneId && { sceneId: opts.sceneId }),
      exportedAt: new Date().toISOString(),
      video: { file: "animation.mp4", codec: "h264", pixelFormat: "yuv420p", colorSpace: "bt709", width: v.width, height: v.height, fps: v.fps, frames: v.frames, duration: +(v.frames / v.fps).toFixed(6), audio: false, loop: true, loopValidated: report.ok },
      scene: "scene.spec.json",
      report: "quality-report.json",
      files: [...files].map(([path, data]) => ({ path, sha256: sha256(data), bytes: data.length })),
    };
    PackageManifestSchema.parse(manifest);
    writeFileSync(part, zip([{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...[...files].map(([n, data]) => ({ name: n, data }))]));
    signal?.throwIfAborted();
    renameSync(part, join(exportsDir, name));
    progress("pack", 1, 1);
    return { name, manifest, report };
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export type Checked = { ok: true; manifest: PackageManifest; scene: SceneSpec; files: Map<string, Buffer> } | { ok: false; errors: string[] };

/**
 * Checks a package without trusting it: safe paths only, a manifest of a supported version, every listed file present
 * with its checksum and size, nothing unlisted, a valid scene whose images are all inside, and a video that really is
 * what the manifest says (codec, size, fps, frame count, no audio).
 */
export function checkPackage(buf: Buffer): Checked {
  let entries: Map<string, Buffer>;
  try {
    entries = unzip(buf);
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
  const errors: string[] = [];
  for (const n of entries.keys()) if (!PackagePath.safeParse(n).success) errors.push(`Unsafe path in the package: "${n}"`);
  if (errors.length) return { ok: false, errors };
  const raw = entries.get("manifest.json");
  if (!raw) return { ok: false, errors: ["The package has no manifest.json"] };
  let json: unknown;
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, errors: ["manifest.json is not valid JSON"] };
  }
  const head = json as { schema?: unknown; version?: unknown };
  if (head.schema !== PACKAGE_SCHEMA) return { ok: false, errors: [`Not an Anim Studio package (schema "${String(head.schema)}")`] };
  if (typeof head.version !== "number" || head.version > PACKAGE_VERSION) return { ok: false, errors: [`Unsupported package version ${String(head.version)}; this app reads version ${PACKAGE_VERSION}`] };
  const m = PackageManifestSchema.safeParse(json);
  if (!m.success) return { ok: false, errors: m.error.issues.map((i) => `manifest.${i.path.join(".")}: ${i.message}`) };
  const manifest = m.data;
  const listed = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const data = entries.get(f.path);
    if (!data) errors.push(`Missing file: ${f.path}`);
    else if (data.length !== f.bytes || sha256(data) !== f.sha256) errors.push(`Checksum mismatch: ${f.path}`);
  }
  for (const n of entries.keys()) if (n !== "manifest.json" && !listed.has(n)) errors.push(`Unlisted file in the package: ${n}`);
  for (const p of [manifest.video.file, manifest.scene, manifest.report]) if (!listed.has(p)) errors.push(`The manifest names ${p} but doesn't list it`);
  if (errors.length) return { ok: false, errors };

  let scene: SceneSpec | null = null;
  try {
    const v = validateScene(JSON.parse(entries.get(manifest.scene)!.toString("utf8")));
    if (!v.ok) errors.push(...v.errors.slice(0, 5).map((e) => `scene: ${e}`));
    else scene = v.spec;
  } catch {
    errors.push("The scene is not valid JSON");
  }
  if (scene)
    eachString(scene, (s) => {
      if (/^(\/|[A-Za-z]:|\\\\|file:)/.test(s) || s.includes("/api/images/")) errors.push(`The scene refers to a path outside the package: ${s}`);
      else if (/^assets\//.test(s) && !listed.has(s) && !(s.endsWith("/") && [...listed].some((f) => f.startsWith(s)))) errors.push(`The scene uses ${s}, which isn't in the package`);
    });
  if (errors.length || !scene) return { ok: false, errors };

  // the video, as it really is
  const tmp = mkdtempSync(join(tmpdir(), "anim-pkg-"));
  try {
    const file = join(tmp, "v.mp4");
    writeFileSync(file, entries.get(manifest.video.file)!);
    const v = probeMp4(file), want = manifest.video;
    if (v.codec !== want.codec || v.pixelFormat !== want.pixelFormat) errors.push(`The video is ${v.codec}/${v.pixelFormat}, not ${want.codec}/${want.pixelFormat}`);
    if (v.width !== want.width || v.height !== want.height) errors.push(`The video is ${v.width}×${v.height}, not ${want.width}×${want.height}`);
    if (Math.abs(v.fps - want.fps) > 0.01) errors.push(`The video is ${v.fps} fps, not ${want.fps}`);
    if (v.frames !== want.frames) errors.push(`The video has ${v.frames} frames, not ${want.frames}`);
    if (Math.abs(want.frames / want.fps - want.duration) > 0.01) errors.push(`The manifest's duration ${want.duration}s doesn't match ${want.frames} frames at ${want.fps} fps`);
    if (v.audio) errors.push("The video has audio; packages are silent");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return errors.length ? { ok: false, errors } : { ok: true, manifest, scene, files: entries };
}

/**
 * Brings a checked package's images into this machine's image library (their content-hash names are re-derived, never
 * taken on trust) and returns its scene pointing at them.
 */
export function importPackage(p: Extract<Checked, { ok: true }>, imagesDir: string, save: (png: Uint8Array) => string): SceneSpec {
  const map = new Map<string, string>();
  for (const [path, data] of p.files) {
    const png = /^assets\/([a-f0-9]{24}\.png)$/.exec(path), frame = /^assets\/([a-f0-9]{24})\/(\d{3}\.jpg)$/.exec(path);
    if (png) map.set(path, save(data));
    else if (frame) {
      // footage frames keep their clip folder and frame names (the folder name is checked to be a plain hash above)
      mkdirSync(join(imagesDir, frame[1]), { recursive: true });
      writeFileSync(join(imagesDir, frame[1], frame[2]), data);
      map.set(`assets/${frame[1]}/`, `/api/images/${frame[1]}/`);
    }
  }
  const scene = mapStrings(p.scene, (s) => map.get(s) ?? s) as SceneSpec;
  const v = validateScene(scene);
  if (!v.ok) throw new Error(`The imported scene isn't valid: ${v.errors[0]}`);
  return v.spec;
}
