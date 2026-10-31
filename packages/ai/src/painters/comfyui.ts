import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AIError } from "../types";

export interface PaintArgs {
  positive: string;
  negative: string;
  width: number;
  height: number;
  seed: number;
  /** A diffusers model folder on ComfyUI's "diffusers" path; default the Animagine checkpoint. */
  model?: string;
  signal?: AbortSignal;
}

export interface AnimateArgs {
  /** The first frame (PNG). */
  image: Uint8Array;
  /** What moves, in plain sentences. */
  positive: string;
  negative: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  seed: number;
  signal?: AbortSignal;
}

/** Paints one image from a text prompt (PNG bytes); optionally animates a picture into a short video (MP4 bytes). */
export interface Painter {
  name: string;
  paint(args: PaintArgs): Promise<Uint8Array>;
  animate?(args: AnimateArgs): Promise<Uint8Array>;
}

export const VIDEO_MODEL = "wan2.2_ti2v_5B_fp16.safetensors";
/** Sizes the video model works at (multiples of 32), per aspect. */
export const VIDEO_SIZE = { "16:9": [1280, 704], "9:16": [704, 1280], "1:1": [960, 960] } as const;

/** Wan 2.2 TI2V 5B image-to-video, as in ComfyUI's own template (shift 8, uni_pc, cfg 5). */
function videoWorkflow(a: AnimateArgs, image: string) {
  return {
    // fp8 weights halve the model's memory (~5 GB instead of 10): at fp16 it plus the text encoder used ~18 GB of RAM on a 32 GB PC
    unet: { class_type: "UNETLoader", inputs: { unet_name: VIDEO_MODEL, weight_dtype: process.env.VIDEO_WEIGHTS || "fp8_e4m3fn" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "umt5_xxl_fp8_e4m3fn_scaled.safetensors", type: "wan", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "wan2.2_vae.safetensors" } },
    img: { class_type: "LoadImage", inputs: { image } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: a.positive } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: a.negative } },
    shift: { class_type: "ModelSamplingSD3", inputs: { model: ["unet", 0], shift: 8 } },
    latent: { class_type: "Wan22ImageToVideoLatent", inputs: { vae: ["vae", 0], width: a.width, height: a.height, length: a.frames, batch_size: 1, start_image: ["img", 0] } },
    sample: { class_type: "KSampler", inputs: { model: ["shift", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["latent", 0], seed: a.seed, steps: 20, cfg: 5, sampler_name: "uni_pc", scheduler: "simple", denoise: 1 } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    video: { class_type: "CreateVideo", inputs: { images: ["decode", 0], fps: a.fps } },
    save: { class_type: "SaveVideo", inputs: { video: ["video", 0], filename_prefix: "anim-studio/video", format: "mp4", codec: "h264" } },
  };
}

export const CHECKPOINT = "animagine-xl-4.0-opt.safetensors";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SDXL text-to-image graph in ComfyUI's API format. 28 steps / cfg 5 / Euler a are the checkpoint's recommended settings. */
function workflow(a: PaintArgs) {
  return {
    ckpt: a.model ? { class_type: "DiffusersLoader", inputs: { model_path: a.model } } : { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CHECKPOINT } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["ckpt", 1], text: a.positive } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["ckpt", 1], text: a.negative } },
    latent: { class_type: "EmptyLatentImage", inputs: { width: a.width, height: a.height, batch_size: 1 } },
    sample: { class_type: "KSampler", inputs: { model: ["ckpt", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["latent", 0], seed: a.seed, steps: 28, cfg: 5, sampler_name: "euler_ancestral", scheduler: "normal", denoise: 1 } },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["ckpt", 2] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "anim-studio" } },
  };
}

/** Whether ComfyUI answers, and whether a portable install exists that can be started. */
export async function comfyHealth(opts: { url: string; dir: string }) {
  const models = join(opts.dir, "ComfyUI_windows_portable", "ComfyUI", "models");
  const installed = existsSync(join(models, "checkpoints", CHECKPOINT));
  const video = existsSync(join(models, "diffusion_models", VIDEO_MODEL));
  try {
    await fetch(`${opts.url}/system_stats`, { signal: AbortSignal.timeout(2000) });
    return { installed: true, video, running: true };
  } catch {
    return { installed, video, running: false };
  }
}

/**
 * ComfyUI at `url`, started from the portable install in `dir` when it isn't running.
 * After each image the models are unloaded so the language model gets the GPU back (12 GB can't hold both).
 */
export function comfyui(opts: { url: string; dir: string }): Painter {
  const url = opts.url.replace(/\/$/, "");
  let starting: Promise<void> | null = null;

  async function ensureRunning(signal?: AbortSignal) {
    const h = await comfyHealth({ url, dir: opts.dir });
    if (h.running) return;
    if (!h.installed) throw new AIError("The image painter isn't installed", "Run pnpm setup:painter (downloads about 9 GB), or choose Vector.");
    starting ??= (async () => {
      const root = join(opts.dir, "ComfyUI_windows_portable");
      spawn(join(root, "python_embeded", "python.exe"), ["-s", join(root, "ComfyUI", "main.py"), "--windows-standalone-build", "--disable-auto-launch", "--port", new URL(url).port || "8188"], {
        cwd: root,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      for (let i = 0; i < 240; i++) {
        if (signal?.aborted) throw new Error("Cancelled");
        if ((await comfyHealth({ url, dir: opts.dir })).running) return;
        await sleep(1000);
      }
      throw new AIError("The image painter didn't start", `Check that ComfyUI runs: ${root}\\run_nvidia_gpu.bat`);
    })().finally(() => (starting = null));
    await starting;
  }

  /** Queues a workflow and resolves with the bytes of its first output file (image or video). Frees the GPU after. */
  async function run(graph: object, signal: AbortSignal | undefined, maxSeconds: number, what: string): Promise<Uint8Array> {
    await ensureRunning(signal);
    const res = await fetch(`${url}/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: graph }), signal });
    const body = (await res.json()) as { prompt_id?: string; error?: { message?: string }; node_errors?: unknown };
    if (!res.ok || !body.prompt_id) throw new AIError(`The ${what} rejected the job: ${body.error?.message ?? res.status}`, JSON.stringify(body.node_errors ?? "").slice(0, 300));
    const id = body.prompt_id;
    type File = { filename: string; subfolder: string; type: string };
    try {
      for (let i = 0; i < maxSeconds; i++) {
        await sleep(1000);
        if (signal?.aborted) throw new Error("Cancelled");
        const h = (await (await fetch(`${url}/history/${id}`)).json()) as Record<string, { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string; messages?: unknown[] } }>;
        const job = h[id];
        if (job?.status?.status_str === "error") throw new AIError(`The ${what} failed`, JSON.stringify(job.status.messages ?? "").slice(-300));
        // images come back under "images"; videos under "images" (animated), "videos" or "gifs" depending on the node
        const out = job && Object.values(job.outputs ?? {}).flatMap((o) => Object.values(o).flat().filter((f): f is File => !!f && typeof f === "object" && "filename" in f))[0];
        if (out) {
          const q = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder, type: out.type });
          return new Uint8Array(await (await fetch(`${url}/view?${q}`)).arrayBuffer());
        }
      }
      throw new AIError(`The ${what} took too long`, "Is the GPU busy with something else?");
    } catch (e) {
      if (signal?.aborted) await fetch(`${url}/interrupt`, { method: "POST" }).catch(() => {});
      throw e;
    } finally {
      await fetch(`${url}/free`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {});
    }
  }

  return {
    name: "comfyui",
    // a 1344×768 image takes ~30 s on an RTX 3060, more on the first run while the model loads
    paint: (a) => run(workflow(a), a.signal, 900, "painter"),
    async animate(a) {
      await ensureRunning(a.signal);
      const form = new FormData();
      form.append("image", new Blob([a.image as BlobPart], { type: "image/png" }), "anim-studio-start.png");
      form.append("overwrite", "true");
      const up = (await (await fetch(`${url}/upload/image`, { method: "POST", body: form, signal: a.signal })).json()) as { name?: string };
      if (!up.name) throw new AIError("The video model couldn't receive the painting");
      // a 5 s 1280×704 clip takes several minutes on a 12 GB card
      return run(videoWorkflow(a, up.name), a.signal, 3600, "video model");
    },
  };
}
