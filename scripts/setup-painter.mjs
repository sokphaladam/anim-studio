// Installs the local image painter: ComfyUI + the Animagine XL 4.0 checkpoint (~10 GB total). Which ComfyUI depends on the OS:
//   Windows       the portable NVIDIA build (its own Python + CUDA PyTorch)
//   macOS / Linux a git checkout of the same release with its own .venv (PyTorch uses Apple's GPU via MPS on macOS, CUDA on Linux)
// Usage: pnpm setup:painter [--video] [--layered]. Safe to re-run; interrupted downloads resume. Install folder: COMFY_DIR (default data/comfyui).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statfsSync, writeFileSync } from "node:fs";
import { arch } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
const dir = process.env.COMFY_DIR || join(root, "data", "comfyui");
const TAG = "v0.43.0";
const COMFY_URL = `https://github.com/Comfy-Org/ComfyUI/releases/download/${TAG}/ComfyUI_windows_portable_nvidia.7z`;
const MODEL_URL = "https://huggingface.co/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0-opt.safetensors";
const win = process.platform === "win32";
const log = (m) => console.log(`[setup:painter] ${m}`);
const sh = (cmd, args, opts = {}) => {
  log(`$ ${cmd} ${args.join(" ")}`);
  if (spawnSync(cmd, args, { stdio: "inherit", ...opts }).status !== 0) throw new Error(`${cmd} ${args[0]} failed; fix the error above and re-run pnpm setup:painter.`);
};

if (process.env.CI) process.exit(0);
if (process.platform === "darwin" && arch() !== "arm64") log("Intel Mac: no supported GPU, ComfyUI will paint on the CPU and be very slow.");
if (process.platform === "linux" && spawnSync("nvidia-smi", [], { stdio: "ignore" }).status !== 0) log("No NVIDIA GPU found: ComfyUI will paint on the CPU and be very slow.");

/** curl ships with Windows 10+, macOS and most Linux; -C - resumes a partial download. */
function download(url, file) {
  log(`downloading ${url.split("/").pop()} …`);
  const r = spawnSync(win ? "curl.exe" : "curl", ["-L", "--fail", "-C", "-", "--retry", "5", "-o", file, url], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Download failed: ${url}. Re-run pnpm setup:painter to resume.`);
}

/** First Python 3.10–3.13 on PATH (the versions PyTorch and ComfyUI support), or null. */
function findPython() {
  for (const py of ["python3.12", "python3.13", "python3.11", "python3.10", "python3"])
    if (spawnSync(py, ["-c", "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)"], { stdio: "ignore" }).status === 0) return py;
  return null;
}

mkdirSync(dir, { recursive: true });
// the models alone are ~9 GB (+9 GB for --video); stop before filling the disk rather than halfway through a download
const freeGB = (({ bavail, bsize }) => (bavail * bsize) / 1e9)(statfsSync(dir));
const portable = join(dir, "ComfyUI_windows_portable");
const comfy = win ? join(portable, "ComfyUI") : join(dir, "ComfyUI");
const models = join(comfy, "models");
if (!existsSync(join(models, "checkpoints", "animagine-xl-4.0-opt.safetensors")) && freeGB < 14)
  throw new Error(`Only ${freeGB.toFixed(1)} GB free in ${dir}; the painter needs about 14 GB. Free some space or set COMFY_DIR to another drive.`);
if (win) {
  if (!existsSync(join(comfy, "main.py"))) {
    const archive = join(dir, "comfyui.7z");
    download(COMFY_URL, archive);
    log("extracting …");
    const sevenZip = "C:\\Program Files\\7-Zip\\7z.exe";
    // Windows' built-in tar (libarchive) reads 7z too, just slower
    const r = existsSync(sevenZip) ? spawnSync(sevenZip, ["x", "-y", `-o${dir}`, archive], { stdio: "ignore" }) : spawnSync("tar", ["-xf", archive, "-C", dir], { stdio: "inherit" });
    if (r.status !== 0 || !existsSync(join(comfy, "main.py"))) throw new Error("Extracting ComfyUI failed");
    rmSync(archive);
  }
} else {
  if (!existsSync(join(comfy, "main.py"))) sh("git", ["clone", "--depth", "1", "--branch", TAG, "https://github.com/Comfy-Org/ComfyUI.git", comfy]);
  const venv = join(comfy, ".venv");
  const python = join(venv, "bin", "python");
  const done = join(venv, ".anim-studio-deps"); // written once pip finished, so an interrupted install is redone
  if (!existsSync(done)) {
    if (!existsSync(python)) {
      const base = findPython();
      if (!base) throw new Error(`ComfyUI needs Python 3.10–3.13. Install it (macOS: brew install python@3.12), then re-run pnpm setup:painter.`);
      sh(base, ["-m", "venv", venv]);
    }
    sh(python, ["-m", "pip", "install", "--upgrade", "pip"]);
    // PyPI's macOS PyTorch wheels include the MPS (Apple GPU) backend; on Linux they are the CUDA build
    sh(python, ["-m", "pip", "install", "-r", join(comfy, "requirements.txt")]);
    writeFileSync(done, TAG);
  }
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
      renameSync(`${file}.part`, file);
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
// --layered: layered animation separates characters into parts. SAM 3.1 (~1.75 GB, SAM License) finds a part from a word
// ("head"); BiRefNet (~0.45 GB, MIT) cuts a subject from its background. ComfyUI ships the nodes for both.
if (process.argv.includes("--layered")) {
  await install("https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors", join(models, "checkpoints", "sam3.1_multiplex_fp16.safetensors"));
  await install("https://huggingface.co/Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors", join(models, "background_removal", "birefnet.safetensors"));
}
const extra = [];
if (process.env.VIDEO_MODELS_DIR) extra.push(`anim_studio:\n  base_path: ${process.env.VIDEO_MODELS_DIR.replaceAll("\\", "/")}\n  vae: vae\n  text_encoders: text_encoders`);
// DIFFUSERS_DIR: a folder of diffusers models holding stable-diffusion-xl-base-1.0, which the Flat 2D motion graphics style paints with
if (process.env.DIFFUSERS_DIR && existsSync(process.env.DIFFUSERS_DIR)) extra.push(`anim_studio_diffusers:\n  diffusers: ${process.env.DIFFUSERS_DIR.replaceAll("\\", "/")}`);
if (extra.length) writeFileSync(join(comfy, "extra_model_paths.yaml"), `${extra.join("\n")}\n`);
log(`ready: ${comfy}. The app starts ComfyUI by itself when it paints.`);
