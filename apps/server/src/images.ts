import { AIError, findMotions, maskFrom, recut, reviewOf, type AnimateFn, type ClipStats, type Footage, type Raster, type LayeredTools, type Painter, type Provider } from "@anim/ai";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { paintingBoxToScene } from "@anim/engine";
import { CleanupSchema } from "@anim/spec";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import ffmpeg from "ffmpeg-static";
import { join } from "node:path";

// in the packaged desktop app the binary lives beside the archive, not inside it
export const ffmpegBin = (ffmpeg as unknown as string).replace(/app\.asar([\\/])/, "app.asar.unpacked$1");

const NAME = /^[a-f0-9]{24}\.png$/;
const CLIP = /^[a-f0-9]{24}$/;
const FRAME = /^\d{3}\.jpg$/;

async function decode(png: Uint8Array): Promise<Raster> {
  const img = await loadImage(Buffer.from(png));
  const g = createCanvas(img.width, img.height).getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height);
  return { width: d.width, height: d.height, data: d.data };
}

function encode(r: Raster): Uint8Array {
  const c = createCanvas(r.width, r.height);
  c.getContext("2d").putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
  return c.toBuffer("image/png");
}

/** Paintings live as files (named by content hash) and scenes refer to them as /api/images/<name>.png. */
export function imageStore(dir: string) {
  /** Content-addressed, so a src never changes meaning and is never deleted: undo, restore and old versions keep working. */
  const save = (png: Uint8Array) => {
    const name = `${createHash("sha256").update(png).digest("hex").slice(0, 24)}.png`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), png);
    return `/api/images/${name}`;
  };
  return {
    /** Stores PNG bytes under their content hash; resolves with the src scenes use. */
    save,
    /** What layered generation needs: the painter, this store and a PNG codec. */
    layeredWith(painter: Painter): LayeredTools {
      return { painter, store: save, decode, encode };
    },
    /** Animates with a video model (the painter's, or a cloud one); the MP4 is split into JPEG frames the engine plays one by one. */
    animateWith(animate: Painter["animate"]): AnimateFn | undefined {
      if (!animate) return undefined;
      return async (args, signal) => {
        const mp4 = await animate({ ...args, signal });
        const id = createHash("sha256").update(mp4).digest("hex").slice(0, 24);
        const out = join(dir, id);
        mkdirSync(out, { recursive: true });
        writeFileSync(join(dir, `${id}.mp4`), mp4);
        const r = spawnSync(ffmpegBin, ["-v", "error", "-y", "-i", join(dir, `${id}.mp4`), "-vf", `fps=${args.fps}`, "-q:v", "3", join(out, "%03d.jpg")]);
        const count = readdirSync(out).filter((f) => FRAME.test(f)).length;
        if (r.status !== 0 || !count) throw new AIError("Couldn't split the video into frames", r.stderr?.toString().slice(-300));
        return { frames: `/api/images/${id}/`, count, fps: args.fps };
      };
    },
    /** Measures a stored clip for its quality checks: size, and brightness and frame-to-frame change at five points. */
    async clipStats(f: Footage): Promise<ClipStats> {
      const folder = join(dir, f.frames.replace(/^\/api\/images\//, ""));
      const S = 32; // small: brightness and change don't need detail
      const c = createCanvas(S, S), g = c.getContext("2d");
      const grey = async (i: number) => {
        const img = await loadImage(readFileSync(join(folder, `${String(i + 1).padStart(3, "0")}.jpg`)));
        g.drawImage(img, 0, 0, S, S);
        const d = g.getImageData(0, 0, S, S).data, out = new Float32Array(S * S);
        for (let p = 0; p < out.length; p++) out[p] = (0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]) / 255;
        return { out, width: img.width, height: img.height };
      };
      const first = await grey(0);
      const samples: ClipStats["samples"] = [];
      for (const at of [0, 0.25, 0.5, 0.75, 1]) {
        const i = Math.max(0, Math.min(f.count - 2, Math.round(at * (f.count - 1))));
        const a = (await grey(i)).out, b = f.count > 1 ? (await grey(i + 1)).out : a;
        const mean = a.reduce((s, v) => s + v, 0) / a.length;
        const spread = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
        const jump = a.reduce((s, v, p) => s + Math.abs(v - b[p]), 0) / a.length;
        samples.push({ at: i / f.fps, mean, spread, jump });
      }
      const loopGap = f.count > 2 ? (await grey(f.count - 2)).out.reduce((s, v, p) => s + Math.abs(v - first.out[p]), 0) / first.out.length : 0;
      return { count: f.count, fps: f.fps, width: first.width, height: first.height, samples, loopGap };
    },
    /** The JPEG bytes of a stored clip's frame `at` (0–1) of the way through. */
    still(f: Footage, at: number): Uint8Array {
      return readFileSync(join(dir, f.frames.replace(/^\/api\/images\//, ""), `${String(Math.round(at * (f.count - 1)) + 1).padStart(3, "0")}.jpg`));
    },
    /** The bytes of a stored painting, from its /api/images/<name>.png src; null if unknown. */
    read(src: string): Uint8Array | null {
      const name = src.split("/").pop() ?? "";
      const file = join(dir, name);
      return NAME.test(name) && existsSync(file) ? readFileSync(file) : null;
    },
    routes(app: FastifyInstance, provider: () => Provider) {
      const Body = z.object({ src: z.string(), duration: z.number().positive().max(60), width: z.number().int().positive(), height: z.number().int().positive() });
      /** Looks at a stored painting and returns its moving parts, plus its windows in scene coordinates (for rain). */
      app.post("/api/paintings/animate", async (req, reply) => {
        const b = Body.safeParse(req.body);
        if (!b.success) return reply.code(400).send({ error: b.error.issues[0].message });
        const png = this.read(b.data.src);
        if (!png) return reply.code(404).send({ error: "Image not found" });
        const p = provider();
        if (!p.vision) return reply.code(422).send({ error: "The current AI can't look at pictures", fix: "Use a cloud model (AI_PROVIDER=openai-compatible, e.g. Gemini)." });
        try {
          const info = await findMotions(png, p, b.data.duration);
          const img = { width: png[16] * 2 ** 24 + png[17] * 2 ** 16 + png[18] * 256 + png[19], height: png[20] * 2 ** 24 + png[21] * 2 ** 16 + png[22] * 256 + png[23] }; // PNG IHDR
          return { motions: info.motions, indoor: info.indoor, windows: info.windows.map((w) => paintingBoxToScene(w, img, b.data)) };
        } catch (e) {
          if (e instanceof AIError) return reply.code(503).send({ error: e.message, fix: e.fix });
          throw e;
        }
      });

      const Recut = z.object({ from: z.string(), mask: z.string(), cleanup: CleanupSchema, name: z.string().max(80).default("part") });
      /**
       * Re-cuts a part from its stored source and mask with new cleanup settings. Stateless: it stores the new cut-out
       * and returns it; the editor applies it to the scene as an undoable step. A cut-out that fails its checks is refused.
       */
      app.post("/api/parts/recut", async (req, reply) => {
        const b = Recut.safeParse(req.body);
        if (!b.success) return reply.code(400).send({ error: b.error.issues[0].message });
        const fromPng = this.read(b.data.from), maskPng = this.read(b.data.mask);
        if (!fromPng || !maskPng) return reply.code(404).send({ error: "The part's source painting or mask is missing" });
        const src = await decode(fromPng);
        try {
          const cut = recut(src, maskFrom(await decode(maskPng), src.width, src.height), b.data.cleanup, b.data.name);
          const fail = cut.checks.find((c) => c.status === "fail");
          if (fail) return reply.code(422).send({ error: `That cleanup breaks the ${b.data.name}: ${fail.note}`, fix: "Grow or shrink it less." });
          return { src: save(encode(cut.image)), width: cut.image.width, height: cut.image.height, crop: cut.crop, checks: cut.checks, review: reviewOf(cut.checks) ?? null };
        } catch (e) {
          if (e instanceof AIError) return reply.code(422).send({ error: e.message, fix: e.fix });
          throw e;
        }
      });

      app.get<{ Params: { clip: string; file: string } }>("/api/images/:clip/:file", async (req, reply) => {
        const file = join(dir, req.params.clip, req.params.file);
        if (!CLIP.test(req.params.clip) || !FRAME.test(req.params.file) || !existsSync(file)) return reply.code(404).send({ error: "Frame not found" });
        return reply.header("cache-control", "public, max-age=31536000, immutable").type("image/jpeg").send(readFileSync(file));
      });
      app.get<{ Params: { file: string } }>("/api/images/:file", async (req, reply) => {
        const file = join(dir, req.params.file);
        if (!NAME.test(req.params.file) || !existsSync(file)) return reply.code(404).send({ error: "Image not found" });
        // content-addressed, so it never changes
        return reply.header("cache-control", "public, max-age=31536000, immutable").type("image/png").send(readFileSync(file));
      });
    },
  };
}
