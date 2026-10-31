// Installs the local image painter: ComfyUI (Windows portable, NVIDIA) + the Animagine XL 4.0 checkpoint (~10 GB total).
// Usage: pnpm setup:painter [--video]. Safe to re-run; interrupted downloads resume. Install folder: COMFY_DIR (default data/comfyui).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const dir = process.env.COMFY_DIR || join(root, "data", "comfyui");
const COMFY_URL = "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.43.0/ComfyUI_windows_portable_nvidia.7z";
const MODEL_URL = "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors";
const log = (m) => console.log(`[setup:painter] ${m}`);

if (process.platform !== "win32") {
  log("Automatic setup is Windows-only. Install ComfyUI yourself, put animagine-xl-4.0-opt.safetensors in models/checkpoints, and set COMFY_URL.");
  process.exit(0);
}

/** curl.exe ships with Windows 10+; -C - resumes a partial download. */
function download(url, file) {
  log(`downloading ${url.split("/").pop()} …`);
  const r = spawnSync("curl.exe", ["-L", "--fail", "-C", "-", "--retry", "5", "-o", file, url], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Download failed: ${url}. Re-run pnpm setup:painter to resume.`);
}

mkdirSync(dir, { recursive: true });
const portable = join(dir, "ComfyUI_windows_portable");
if (!existsSync(join(portable, "ComfyUI", "main.py"))) {
  const archive = join(dir, "comfyui.7z");
  download(COMFY_URL, archive);
  log("extracting …");
  const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";
  // Windows' built-in tar (libarchive) reads 7z too, just slower
  const r = existsSync(sevenZip) ? spawnSync(sevenZip, ["x", "-y", `-o${dir}`, archive], { stdio: "ignore" }) : spawnSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit" });
  if (r.status !== 0 || !existsSync(join(portable, "ComfyUI", "main.py"))) throw new Error("Extracting ComfyUI failed");
  rmSync(archive);
}
/** Hugging Face publishes each file's SHA-256 as X-Linked-ETag; a resumed download can be garbled with the right size. */
async function expectedHash(url) {
  // a dropped connection or DNS blip shouldn't end a long install: retry a few times
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "manual" });
      return res.headers.get("x-linked-etag")?.replace(/"/g, "") ?? null;
    } catch (e) {
      if (i >= 5) throw e;
      log(`network error (${e.cause?.code ?? e.message}), retrying …`);
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
  }
}
function sha256(file) {
  return new Promise((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(file).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", fail);
  });
}

/** Downloads `url` to `file` unless a verified copy is there; a corrupted file is fetched again from scratch. */
async function install(url, file) {
  mkdirSync(dirname(file), { recursive: true });
  const want = await expectedHash(url);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!existsSync(file)) {
      download(url, `${file}.part`);
      spawnSync("cmd", ["/c", "move", "/y", `${file}.part`, file], { stdio: "ignore" });
    }
    if (!want) return; // offline check unavailable: trust the file
    log(`verifying ${basename(file)} …`);
    if ((await sha256(file)) === want) return;
    log(`${basename(file)} is corrupted, downloading it again`);
    rmSync(file);
    rmSync(`${file}.part`, { force: true }); // start clean; resuming is what can garble it
    if (attempt === 1) throw new Error(`${basename(file)} keeps arriving corrupted; check your connection and re-run.`);
  }
}

const models = join(portable, "ComfyUI", "models");
await install(MODEL_URL, join(models, "checkpoints", "animagine-xl-4.0-opt.safetensors"));

// --video: Wan 2.2 TI2V 5B image-to-video (~18 GB, Apache-2.0). VIDEO_MODELS_DIR can put the text encoder and VAE
// on another drive (e.g. C:) when one drive can't hold everything; ComfyUI finds them via extra_model_paths.yaml.
if (process.argv.includes("--video")) {
  const WAN = "https://huggingface.co/Comfy-Org/Wan-2.2/resolve/main/split_files";
  const side = process.env.VIDEO_MODELS_DIR || models;
  await install(`${WAN}/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors`, join(models, "diffusion_models", "wan2.2_ti2v_5B_fp16.safetensors"));
  await install(`${WAN}/vae/wan2.2_vae.safetensors`, join(side, "vae", "wan2.2_vae.safetensors"));
  await install(`${WAN}/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`, join(side, "text_encoders", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"));
}
const extra = [];
if (process.env.VIDEO_MODELS_DIR) extra.push(`anim_studio:\n  base_path: ${process.env.VIDEO_MODELS_DIR.replaceAll("\\", "/")}\n  vae: vae\n  text_encoders: text_encoders`);
// DIFFUSERS_DIR: a folder of diffusers models holding stable-diffusion-xl-base-1.0, which the Flat 2D motion graphics style paints with
if (process.env.DIFFUSERS_DIR) extra.push(`anim_studio_diffusers:\n  diffusers: ${process.env.DIFFUSERS_DIR.replaceAll("\\", "/")}`);
if (extra.length) writeFileSync(join(portable, "ComfyUI", "extra_model_paths.yaml"), `${extra.join("\n")}\n`);
log(`ready: ${portable}. The app starts ComfyUI by itself when it paints.`);
