// End-to-end demo: prompt → storyboard → painting → frame-by-frame video, rendered to MP4 with the app's own engine.
// Usage: pnpm demo ["prompt"] [style] [mode] [seconds]. Writes data/demo/<date-time>-<mode>-scene.mp4 and -making-of.mp4.
import { comfyui, configFromEnv, generateScene, providerFor, type GenerateEvent } from "@anim/ai";
import { createRenderer, imageSources, registerImage } from "@anim/engine";
import { ART_STYLES, type SceneSpec, type StyleId } from "@anim/spec";
import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "ffmpeg-static";
import { imageStore } from "./images";

const root = fileURLToPath(new URL("../../../", import.meta.url));
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
const [prompt = "a girl drawing on a tablet at her desk by the window on a rainy night, a cat sleeping beside her, desk lamp glowing", style = "lofi-cozy", mode = "video", secs = "10"] = process.argv.slice(2);
const W = 1280, H = 720;
const out = join(root, "data", "demo");
mkdirSync(out, { recursive: true });
const now = new Date();
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}-${mode}`;
const imagesDir = join(root, "data", "images");
const t0 = Date.now();
const log = (m: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s  ${m}`);

/** Streams canvas frames into ffmpeg as an H.264 MP4. */
function encoder(file: string, fps: number) {
  const p = spawn(ffmpeg as unknown as string, ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise<void>((ok, fail) => p.on("close", (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));
  return {
    write: (c: Canvas) => new Promise<void>((ok) => (p.stdin.write(c.data()) ? ok() : p.stdin.once("drain", ok))),
    end: () => (p.stdin.end(), done),
  };
}

async function loadImages(spec: SceneSpec) {
  for (const src of imageSources(spec)) registerImage(src, await loadImage(join(imagesDir, src.replace("/api/images/", ""))));
}

async function renderScene(spec: SceneSpec, enc: ReturnType<typeof encoder>, canvas: Canvas) {
  const r = createRenderer(canvas, spec, { createCanvas: (w, h) => createCanvas(w, h) });
  const n = Math.round(spec.meta.duration * spec.meta.fps);
  for (let i = 0; i < n; i++) {
    r.render(i / spec.meta.fps);
    await enc.write(canvas);
  }
}

/** A title card for the making-of video. */
function card(c: Canvas, title: string, lines: string[], bg?: Awaited<ReturnType<typeof loadImage>>) {
  const g = c.getContext("2d");
  g.fillStyle = "#141217";
  g.fillRect(0, 0, W, H);
  if (bg) {
    g.globalAlpha = 0.35;
    g.drawImage(bg, 0, 0, W, H);
    g.globalAlpha = 1;
  }
  g.fillStyle = "#f2a93b";
  g.font = "600 40px sans-serif";
  g.fillText(title, 80, 130);
  g.fillStyle = "#ecebef";
  g.font = "26px sans-serif";
  lines.slice(0, 12).forEach((l, i) => g.fillText(l.length > 90 ? `${l.slice(0, 87)}…` : l, 80, 200 + i * 40));
}

const provider = providerFor(configFromEnv(process.env));
const painter = comfyui({ url: process.env.COMFY_URL || "http://127.0.0.1:8188", dir: process.env.COMFY_DIR || join(root, "data", "comfyui") });
const images = imageStore(imagesDir);
log(`prompt: ${prompt}`);
log(`style: ${ART_STYLES[style as StyleId].label} · mode: ${mode} · ${secs}s · AI: ${provider.model.split(",")[0]}`);

let storyboard: Extract<GenerateEvent, { type: "storyboard" }>["storyboard"] | null = null;
let paintingSrc = "";
const spec = await generateScene(
  { prompt, duration: Number(secs), aspect: "16:9", style: style as StyleId, mode: mode as "video" },
  provider,
  (e) => {
    if (e.type === "storyboard") {
      storyboard = e.storyboard;
      log(`storyboard: "${e.storyboard.title}" — ${e.storyboard.beats.map((b) => `${b.at}s ${b.label}`).join(" | ")}`);
    } else if (e.type === "painted") {
      paintingSrc = e.src;
      log(`painted: ${e.src}`);
    } else if (e.type === "status") {
      // video progress arrives every 15 s; print about once a minute
      const s = Number(/\((\d+) s/.exec(e.message)?.[1] ?? 0);
      if (e.phase !== "video" || s % 60 < 15) log(e.message);
    } else if (e.type === "repairing") log(`repairing: ${e.errors.slice(0, 3).join("; ")}`);
    else if (e.type === "error") log(`ERROR ${e.message} ${e.fix ?? ""} ${(e.errors ?? []).slice(0, 5).join("; ")}`);
  },
  undefined,
  images.paintWith(painter),
  images.animateWith(painter),
);
if (!spec) process.exit(1);
writeFileSync(join(out, `${stamp}-scene.json`), JSON.stringify(spec, null, 2));
log(`scene ready: ${spec.layers.map((l) => l.type).join(", ")}`);

await loadImages(spec);
const canvas = createCanvas(W, H);
const sceneFile = join(out, `${stamp}-scene.mp4`);
let enc = encoder(sceneFile, spec.meta.fps);
await renderScene(spec, enc, canvas);
await enc.end();
log(`wrote ${sceneFile}`);

// making-of: the prompt and storyboard, the painting, then the animation
const sb = storyboard as { title: string; mood: string; scene: string; motion: string; beats: { at: number; label: string; note?: string }[] } | null;
const still = paintingSrc ? await loadImage(join(imagesDir, paintingSrc.replace("/api/images/", ""))) : undefined;
const makingFile = join(out, `${stamp}-making-of.mp4`);
enc = encoder(makingFile, spec.meta.fps);
const hold = async (seconds: number) => {
  for (let i = 0; i < seconds * spec.meta.fps; i++) await enc.write(canvas);
};
card(canvas, "1 · Your prompt", [prompt, "", `Art tradition: ${ART_STYLES[style as StyleId].label}`]);
await hold(3);
if (sb) card(canvas, `2 · AI storyboard: "${sb.title}"`, [`Mood: ${sb.mood}`, "", ...sb.beats.map((b) => `${b.at}s  ${b.label}${b.note ? ` — ${b.note}` : ""}`), "", `Motion: ${sb.motion}`]);
await hold(5);
if (still) {
  card(canvas, "3 · AI painting (one still frame)", [], still);
  canvas.getContext("2d").drawImage(still, 160, 170, 960, 540 * (960 / 960));
  await hold(3);
}
card(canvas, mode === "video" ? "4 · Animated frame by frame by the video model" : "4 · The painting, animated by the engine", []);
await hold(1.5);
await renderScene(spec, enc, canvas);
await enc.end();
log(`wrote ${makingFile}`);
