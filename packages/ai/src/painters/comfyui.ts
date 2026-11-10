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

export interface InpaintArgs {
  /** The picture (PNG) and a same-size mask (PNG, white = repaint). */
  image: Uint8Array;
  mask: Uint8Array;
  positive: string;
  negative: string;
  seed: number;
  /** 1 = paint the area from scratch; lower keeps more of what is there. */
  denoise: number;
  signal?: AbortSignal;
}

/**
 * Paints one image from a text prompt (PNG bytes); optionally animates a picture into a short video (MP4 bytes), and
 * separates parts of a picture (masks are PNGs, white = in) for layered scenes.
 */
export interface Painter {
  name: string;
  paint(args: PaintArgs): Promise<Uint8Array>;
  animate?(args: AnimateArgs): Promise<Uint8Array>;
  /** Mask of the picture's subject (everything but the background). */
  removeBackground?(image: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
  /** Mask of what `text` names in the picture ("head"); all black when nothing matches. */
  segment?(image: Uint8Array, text: string, signal?: AbortSignal): Promise<Uint8Array>;
  /** The picture with the masked area repainted (whole image; unmasked pixels may drift slightly, so callers paste back). */
  inpaint?(args: InpaintArgs): Promise<Uint8Array>;
}

/** Models layered scenes need beside the checkpoint; ComfyUI ships the nodes for both. */
export const SEGMENT_MODEL = "sam3.1_multiplex_fp16.safetensors";
export const BG_REMOVAL_MODEL = "birefnet.safetensors";

const maskOut = (mask: [string, number]) => ({
  toimg: { class_type: "MaskToImage", inputs: { mask } },
  save: { class_type: "SaveImage", inputs: { images: ["toimg", 0], filename_prefix: "anim-studio/mask" } },
});
const bgRemovalWorkflow = (image: string) => ({
  img: { class_type: "LoadImage", inputs: { image } },
  model: { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: BG_REMOVAL_MODEL } },
  fg: { class_type: "RemoveBackground", inputs: { bg_removal_model: ["model", 0], image: ["img", 0] } },
  ...maskOut(["fg", 0]),
});
/** SAM 3.1 text-prompted segmentation, as in ComfyUI's own blueprint (threshold 0.5, 2 refinement passes, one union mask). */
const segmentWorkflow = (image: string, text: string) => ({
  img: { class_type: "LoadImage", inputs: { image } },
  sam: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: SEGMENT_MODEL } },
  text: { class_type: "CLIPTextEncode", inputs: { clip: ["sam", 1], text } },
  detect: { class_type: "SAM3_Detect", inputs: { model: ["sam", 0], image: ["img", 0], conditioning: ["text", 0], threshold: 0.5, refine_iterations: 2, individual_masks: false } },
  ...maskOut(["detect", 0]),
});
/** Masked img2img with the painter's own checkpoint (no inpainting model needed). */
const inpaintWorkflow = (a: InpaintArgs, image: string, mask: string) => ({
  ckpt: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CHECKPOINT } },
  img: { class_type: "LoadImage", inputs: { image } },
  mask: { class_type: "LoadImageMask", inputs: { image: mask, channel: "red" } },
  pos: { class_type: "CLIPTextEncode", inputs: { clip: ["ckpt", 1], text: a.positive } },
  neg: { class_type: "CLIPTextEncode", inputs: { clip: ["ckpt", 1], text: a.negative } },
  enc: { class_type: "VAEEncode", inputs: { pixels: ["img", 0], vae: ["ckpt", 2] } },
  noise: { class_type: "SetLatentNoiseMask", inputs: { samples: ["enc", 0], mask: ["mask", 0] } },
  sample: { class_type: "KSampler", inputs: { model: ["ckpt", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["noise", 0], seed: a.seed, steps: 28, cfg: 5, sampler_name: "euler_ancestral", scheduler: "normal", denoise: a.denoise } },
  decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["ckpt", 2] } },
  save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "anim-studio/inpaint" } },
});

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

/**
 * Where ComfyUI is installed in `dir` and how to start it: the Windows portable NVIDIA build, or a git checkout
 * with its own .venv (macOS uses Apple's GPU via PyTorch MPS, Linux CUDA). Both are made by pnpm setup:painter.
 */
export function comfyInstall(dir: string) {
  const portable = join(dir, "ComfyUI_windows_portable");
  if (existsSync(join(portable, "ComfyUI", "main.py")))
    return { comfy: join(portable, "ComfyUI"), python: join(portable, "python_embeded", "python.exe"), args: ["-s", join(portable, "ComfyUI", "main.py"), "--windows-standalone-build"], cwd: portable, check: `${portable}\\run_nvidia_gpu.bat` };
  const comfy = join(dir, "ComfyUI");
  const python = process.platform === "win32" ? join(comfy, ".venv", "Scripts", "python.exe") : join(comfy, ".venv", "bin", "python");
  return { comfy, python, args: [join(comfy, "main.py")], cwd: comfy, check: `${python} ${join(comfy, "main.py")}` };
}

/** Whether ComfyUI answers, and whether an install exists that can be started. */
export async function comfyHealth(opts: { url: string; dir: string }) {
  const models = join(comfyInstall(opts.dir).comfy, "models");
  const installed = existsSync(join(models, "checkpoints", CHECKPOINT));
  const video = existsSync(join(models, "diffusion_models", VIDEO_MODEL));
  const layered = existsSync(join(models, "checkpoints", SEGMENT_MODEL)) && existsSync(join(models, "background_removal", BG_REMOVAL_MODEL));
  try {
    await fetch(`${opts.url}/system_stats`, { signal: AbortSignal.timeout(2000) });
    // COMFY_URL may be another PC: ask ComfyUI which models it has, not this disk
    const has = async (folder: string, file: string) =>
      fetch(`${opts.url}/models/${folder}`, { signal: AbortSignal.timeout(2000) })
        .then((r) => (r.ok ? r.json() : []))
        .then((l: unknown) => Array.isArray(l) && l.includes(file), () => false);
    const [v, seg, bg] = await Promise.all([has("diffusion_models", VIDEO_MODEL), has("checkpoints", SEGMENT_MODEL), has("background_removal", BG_REMOVAL_MODEL)]);
    return { installed: true, video: video || v, layered: layered || (seg && bg), running: true };
  } catch {
    return { installed, video, layered, running: false };
  }
}

/**
 * ComfyUI at `url`, started from the install in `dir` (see comfyInstall) when it isn't running.
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
      const c = comfyInstall(opts.dir);
      spawn(c.python, [...c.args, "--disable-auto-launch", "--port", new URL(url).port || "8188"], {
        cwd: c.cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      for (let i = 0; i < 240; i++) {
        if (signal?.aborted) throw new Error("Cancelled");
        if ((await comfyHealth({ url, dir: opts.dir })).running) return;
        await sleep(1000);
      }
      throw new AIError("The image painter didn't start", `Check that ComfyUI runs: ${comfyInstall(opts.dir).check}`);
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
        const res = await fetch(`${url}/history/${id}`).catch(() => {
          // ComfyUI went away mid-job: on a big model that is almost always the process running out of memory
          throw new AIError(`The ${what} stopped while working (ComfyUI closed)`, "This usually means the PC ran out of memory. Close other apps and try again; ComfyUI restarts on its own.");
        });
        const h = (await res.json()) as Record<string, { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string; completed?: boolean; messages?: unknown[] } }>;
        const job = h[id];
        if (job?.status?.status_str === "error") {
          // the execution_error message names the failing node and the real cause (the rest is a dump of its inputs)
          const err = (job.status.messages ?? []).find((m): m is [string, { node_type?: string; exception_message?: string }] => Array.isArray(m) && m[0] === "execution_error")?.[1];
          const cause = err?.exception_message?.trim().split("\n")[0];
          // read_file_slice: loading the model into RAM failed (seen on 32 GB with the 9.5 GB Wan model, as a MemoryError)
          const lowRam = /not enough memory|DefaultCPUAllocator|MemoryError|read_file_slice/i.test(cause ?? "");
          throw new AIError(
            `The ${what} failed${cause ? ` in ${err?.node_type ?? "a node"}: ${cause.slice(0, 200)}` : ""}`,
            lowRam
              ? process.platform === "win32"
                ? "The PC ran out of memory. Close other apps and try again, or enlarge the Windows page file (System › About › Advanced system settings › Performance › Virtual memory)."
                : "The computer ran out of memory. Close other apps and try again."
              : "Try again; if it keeps failing, check the ComfyUI window for details.",
          );
        }
        // images come back under "images"; videos under "images" (animated), "videos" or "gifs" depending on the node
        const out = job && Object.values(job.outputs ?? {}).flatMap((o) => Object.values(o).flat().filter((f): f is File => !!f && typeof f === "object" && "filename" in f))[0];
        if (out) {
          const q = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder, type: out.type });
          return new Uint8Array(await (await fetch(`${url}/view?${q}`)).arrayBuffer());
        }
        if (job?.status?.completed) throw new AIError(`The ${what} finished without an image`);
      }
      throw new AIError(`The ${what} took too long`, "Is the GPU busy with something else?");
    } catch (e) {
      if (signal?.aborted) await fetch(`${url}/interrupt`, { method: "POST" }).catch(() => {});
      throw e;
    } finally {
      await fetch(`${url}/free`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {});
    }
  }

  /** Puts a PNG into ComfyUI's input folder; resolves with the name its LoadImage nodes use. */
  async function upload(png: Uint8Array, name: string, signal?: AbortSignal) {
    await ensureRunning(signal);
    const form = new FormData();
    form.append("image", new Blob([png as BlobPart], { type: "image/png" }), name);
    form.append("overwrite", "true");
    const up = (await (await fetch(`${url}/upload/image`, { method: "POST", body: form, signal })).json()) as { name?: string };
    if (!up.name) throw new AIError("The image painter couldn't receive the picture");
    return up.name;
  }

  return {
    name: "comfyui",
    // a 1344×768 image takes ~30 s on an RTX 3060, more on the first run while the model loads
    paint: (a) => run(workflow(a), a.signal, 900, "painter"),
    async animate(a) {
      const image = await upload(a.image, "anim-studio-start.png", a.signal);
      // a 5 s 1280×704 clip takes several minutes on a 12 GB card
      return run(videoWorkflow(a, image), a.signal, 3600, "video model");
    },
    async removeBackground(png, signal) {
      return run(bgRemovalWorkflow(await upload(png, "anim-studio-cutout.png", signal)), signal, 600, "background remover");
    },
    async segment(png, text, signal) {
      return run(segmentWorkflow(await upload(png, "anim-studio-segment.png", signal), text), signal, 600, "segmentation model");
    },
    async inpaint(a) {
      const image = await upload(a.image, "anim-studio-inpaint.png", a.signal);
      const mask = await upload(a.mask, "anim-studio-inpaint-mask.png", a.signal);
      return run(inpaintWorkflow(a, image, mask), a.signal, 900, "painter");
    },
  };
}
