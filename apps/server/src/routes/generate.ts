import { generateScene, videoPrompt, VIDEO_SIZE, type AnimateFn, type PaintFn, type Provider } from "@anim/ai";
import { StyleIdSchema } from "@anim/spec";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cancelJob, getJob, startJob, type JobEvent } from "../jobs";

const Body = z.object({ prompt: z.string().trim().min(3, "Describe the animation in a few words").max(2000), duration: z.number().min(5).max(30), aspect: z.enum(["16:9", "9:16", "1:1"]), style: StyleIdSchema.optional(), mode: z.enum(["vector", "painted", "video"]).optional() });

export function generateRoutes(app: FastifyInstance, provider: () => Provider, paint?: PaintFn, animate?: AnimateFn, readImage?: (src: string) => Uint8Array | null) {
  app.post("/api/generate", async (req, reply) => {
    const r = Body.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const p = provider();
    const jobId = startJob(async (emit, signal) => {
      await generateScene(r.data, p, (e) => emit(e as JobEvent), signal, paint, animate);
    });
    return { jobId };
  });

  const Video = z.object({ src: z.string(), motion: z.string().max(600).default(""), scene: z.string().max(600).default(""), aspect: z.enum(["16:9", "9:16", "1:1"]) });
  /** Turns an existing painting into a frame-by-frame clip (a job, like generate: follow /api/jobs/:id/events). */
  app.post("/api/paintings/video", async (req, reply) => {
    const r = Video.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues[0].message });
    if (!animate || !readImage) return reply.code(422).send({ error: "The video model isn't set up", fix: "Run pnpm setup:painter --video" });
    const png = readImage(r.data.src);
    if (!png) return reply.code(404).send({ error: "Image not found" });
    const jobId = startJob(async (emit, signal) => {
      const [width, height] = VIDEO_SIZE[r.data.aspect];
      const t0 = Date.now();
      const say = () => emit({ type: "status", phase: "video", message: `Animating the painting frame by frame (${Math.round((Date.now() - t0) / 1000)} s; usually 5–10 min)` });
      say();
      const tick = setInterval(say, 15_000);
      try {
        const clip = await animate({ image: png, positive: videoPrompt(r.data.motion, r.data.scene, "anime"), negative: "static image, still frame, blurry, distorted face, deformed hands, morphing, flickering, jitter, low quality, watermark, text", width, height, frames: 121, fps: 24, seed: Math.floor(Math.random() * 2 ** 31) }, signal);
        emit({ type: "footage", footage: clip });
      } finally {
        clearInterval(tick);
      }
    });
    return { jobId };
  });

  // Server-Sent Events: replays everything so far, then streams until the job ends
  app.get<{ Params: { id: string } }>("/api/jobs/:id/events", (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) return reply.code(404).send({ error: "Unknown or expired job" });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: JobEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    job.events.forEach(send);
    if (job.finished) {
      send({ type: "end" });
      return res.end();
    }
    const listener = (e: JobEvent) => {
      send(e);
      if (e.type === "end") res.end();
    };
    job.listeners.add(listener);
    req.raw.on("close", () => job.listeners.delete(listener));
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (req) => ({ cancelled: cancelJob(req.params.id) }));
}
