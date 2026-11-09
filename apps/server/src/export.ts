// MP4 export: renders every frame with the same engine as the editor preview, headless, and pipes the pixels into ffmpeg.
import { createRenderer, imageSources, registerImage, type Quality } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import { readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ffmpegBin } from "./images";

export const PRESETS = {
  youtube: { label: "YouTube", width: 1920, height: 1080, fps: 30 },
  vertical: { label: "Shorts / Reels / TikTok", width: 1080, height: 1920, fps: 30 },
  square: { label: "Square", width: 1080, height: 1080, fps: 30 },
  draft: { label: "Draft (fast)", width: 960, height: 540, fps: 24 },
} as const;
export type Preset = keyof typeof PRESETS;

/** Frames in an export: one per 1/fps of the scene, so frame i shows time i / fps (the same t the preview shows). */
export const frameCount = (duration: number, fps: number) => Math.round(duration * fps);

// the fonts the browser loads for text objects (ENGINE_FONTS); without them headless text would not match the preview
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  const req = createRequire(import.meta.url);
  for (const [pkg, file, family] of [
    ["@fontsource-variable/fraunces", "fraunces-latin-wght-italic.woff2", "Fraunces Variable"],
    ["@fontsource/figtree", "figtree-latin-400-normal.woff2", "Figtree"],
  ]) {
    // read the bytes (not the path) so this also works from inside the desktop app's archive
    GlobalFonts.register(readFileSync(join(req.resolve(`${pkg}/package.json`), "..", "files", file)), family);
  }
}

/** Loads every image the scene uses from the images folder; a src outside it, or a missing file, is an error naming it. */
export async function loadImages(spec: SceneSpec, imagesDir: string) {
  for (const src of imageSources(spec)) {
    const file = resolve(imagesDir, src.replace(/^\/api\/images\//, ""));
    const rel = relative(imagesDir, file);
    if (!src.startsWith("/api/images/") || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`The scene refers to an image outside the library: ${src}`);
    try {
      registerImage(src, await loadImage(readFileSync(file)));
    } catch {
      throw new Error(`An image the scene uses is missing: ${src}`);
    }
  }
}

/** One frame of `spec` at time `t`, at the scene's own size, as PNG (the first frame of a cinematic shot). */
export async function renderPng(spec: SceneSpec, t: number, imagesDir: string) {
  loadFonts();
  await loadImages(spec, imagesDir);
  const canvas = createCanvas(spec.meta.width, spec.meta.height);
  createRenderer(canvas, spec, { createCanvas: (w, h) => createCanvas(w, h) }).render(t, { quality: "final", fit: "contain" });
  return new Uint8Array(canvas.toBuffer("image/png"));
}

/**
 * Renders `spec` at the preset's size and fps into `file`: a scene of another shape is letterboxed (contain) or fills
 * the frame around the camera's focus (cover); it is never stretched.
 * Writes to a temp file first, so a failed or cancelled export never leaves a broken MP4 behind.
 */
export async function exportMp4(spec: SceneSpec, preset: Preset, imagesDir: string, file: string, onFrame: (done: number, total: number) => void, signal?: AbortSignal, opts: { quality?: Quality; fit?: "contain" | "cover" } = {}) {
  const { width, height, fps } = PRESETS[preset];
  loadFonts();
  await loadImages(spec, imagesDir);
  const canvas = createCanvas(width, height);
  const r = createRenderer(canvas, spec, { createCanvas: (w, h) => createCanvas(w, h) });
  const total = frameCount(spec.meta.duration, fps);
  const tmp = `${file}.part`;
  const enc = spawn(ffmpegBin, ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-crf", "18", "-movflags", "+faststart", "-f", "mp4", tmp], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  enc.stderr.on("data", (d: Buffer) => (err = (err + d).slice(-500)));
  const closed = new Promise<number | null>((ok) => enc.on("close", ok));
  enc.stdin.on("error", () => {}); // ffmpeg dying shows up as its exit code below
  try {
    for (let i = 0; i < total; i++) {
      signal?.throwIfAborted();
      // the same renderer and options as the preview; only blur and bloom sampling depend on the quality
      r.render(i / fps, { quality: opts.quality ?? "final", fit: opts.fit ?? "contain" });
      // the bars around a letterboxed scene are transparent pixels, which encode as black
      if (!enc.stdin.write(canvas.data())) await new Promise((ok) => enc.stdin.once("drain", ok));
      onFrame(i + 1, total);
      if (enc.exitCode !== null) break;
    }
    enc.stdin.end();
    const code = await closed;
    if (code !== 0) throw new Error(`Encoding failed${err ? `: ${err.trim()}` : ""}`);
    renameSync(tmp, file);
  } catch (e) {
    enc.kill();
    await closed;
    rmSync(tmp, { force: true });
    throw e;
  }
  return { frames: total, width, height, fps };
}
