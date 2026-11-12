// Runs layered generation for real (language model + ComfyUI), then renders check frames and a looping preview MP4.
// Usage: npm run generate:layered ["prompt"] [seconds]. Writes data/layered/<time>/: scene.json, the part images, t-<s>.png and preview.mp4.
import { comfyui, configFromEnv, generateLayered, providerFor } from "@anim/ai";
import { createRenderer, imageSources, registerImage } from "@anim/engine";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import ffmpeg from "ffmpeg-static";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { imageStore } from "./images";

const root = fileURLToPath(new URL("../../../", import.meta.url));
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
const [prompt = "A girl is sleeping on a balcony at night. Create a 6-second animation. At 3 seconds, she wakes up and looks at the clock.", dur = "6"] = process.argv.slice(2);
const imagesDir = process.env.IMAGES_DIR || join(root, "data", "images");
const painter = comfyui({ url: process.env.COMFY_URL || "http://127.0.0.1:8188", dir: process.env.COMFY_DIR || join(root, "data", "comfyui") });
const provider = providerFor(configFromEnv(process.env));
const out = join(root, "data", "layered", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (m: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s  ${m}`);
log(`model: ${provider.name} ${provider.model} → ${out}`);

const spec = await generateLayered({ prompt, duration: Number(dur), aspect: "16:9" }, provider, imageStore(imagesDir).layeredWith(painter), (e) => {
  if (e.type === "token") return;
  if (e.type === "plan") log(`plan: ${JSON.stringify(e.plan)}`);
  else if (e.type === "done") log(`done: ${e.spec.layers.map((l) => `${l.id}${l.parent ? `←${l.parent}` : ""}`).join(", ")}`);
  else log(JSON.stringify(e));
});
writeFileSync(join(out, "scene.json"), JSON.stringify(spec, null, 2));
for (const [id, a] of Object.entries(spec.assets ?? {})) copyFileSync(join(imagesDir, a.src.split("/").pop()!), join(out, `${a.kind}-${id}.png`));

for (const src of imageSources(spec)) registerImage(src, await loadImage(join(imagesDir, src.split("/").pop()!)));
const { width: W, height: H, duration, fps } = spec.meta;
const canvas = createCanvas(W, H);
const r = createRenderer(canvas, spec, { createCanvas: (w, h) => createCanvas(w, h) });
for (const t of [0, 2.9, 3, 4, 5, 5.9].filter((t) => t <= duration)) {
  r.render(t);
  writeFileSync(join(out, `t-${t.toFixed(1)}.png`), canvas.toBuffer("image/png"));
}
// shortcut: a quick preview played twice to show the loop is seamless; real MP4 export (presets, progress) is Milestone 6
const bin = ffmpeg as unknown as string;
const enc = spawn(bin, ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", join(out, "preview.mp4")], { stdio: ["pipe", "inherit", "inherit"] });
const n = Math.round(duration * fps);
for (let i = 0; i < n * 2; i++) {
  r.render((i % n) / fps);
  if (!enc.stdin.write(canvas.data())) await new Promise((ok) => enc.stdin.once("drain", ok));
}
enc.stdin.end();
await new Promise((ok) => enc.on("close", ok));
log(`check frames and preview.mp4 in ${out}`);
