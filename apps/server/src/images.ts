import { AIError, findMotions, type AnimateFn, type LayeredTools, type Painter, type Provider } from "@anim/ai";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";
import { paintingBoxToScene } from "@anim/engine";
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
    /** What layered generation needs: the painter, this store and a PNG codec. */
    layeredWith(painter: Painter): LayeredTools {
      return {
        painter,
        store: save,
        async decode(png) {
          const img = await loadImage(Buffer.from(png));
          const g = createCanvas(img.width, img.height).getContext("2d");
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, img.width, img.height);
          return { width: d.width, height: d.height, data: d.data };
        },
        encode(r) {
          const c = createCanvas(r.width, r.height);
          c.getContext("2d").putImageData(new ImageData(r.data, r.width, r.height), 0, 0);
          return c.toBuffer("image/png");
        },
      };
    },
    /** Animates with the painter's video model; the MP4 is split into JPEG frames the engine plays one by one. */
    animateWith(painter: Painter): AnimateFn | undefined {
      if (!painter.animate) return undefined;
      return async (args, signal) => {
        const mp4 = await painter.animate!({ ...args, signal });
        const id = createHash("sha256").update(mp4).digest("hex").slice(0, 24);
        const out = join(dir, id);
        mkdirSync(out, { recursive: true });
        writeFileSync(join(dir, `${id}.mp4`), mp4);
        const r = spawnSync(ffmpegBin, ["-v", "error", "-y", "-i", join(dir, `${id}.mp4`), "-q:v", "3", join(out, "%03d.jpg")]);
        const count = readdirSync(out).filter((f) => FRAME.test(f)).length;
        if (r.status !== 0 || !count) throw new AIError("Couldn't split the video into frames", r.stderr?.toString().slice(-300));
        return { frames: `/api/images/${id}/`, count, fps: args.fps };
      };
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
