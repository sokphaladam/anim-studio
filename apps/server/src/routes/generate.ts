import { AIError, cinematicShots, clipChecks, generateLayered, paintView, sceneChecks, videoPrompt, worst, VIDEO_SIZE, type AnimateFn, type ClipStats, type Footage, type LayeredEvent, type LayeredPlan, type LayeredTools, type Provider } from "@anim/ai";
import { AssetSchema, CharacterProfileSchema, SceneSpecSchema, type CinematicShot, type SceneSpec } from "@anim/spec";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cancelJob, getJob, startJob, type JobEvent } from "../jobs";

const Body = z.object({ prompt: z.string().trim().min(3, "Describe the animation in a few words").max(2000), duration: z.number().min(5).max(30), aspect: z.enum(["16:9", "9:16", "1:1"]),
  // saved character profiles and their reference paintings, so a new scene keeps the same characters
  characters: z.record(z.string(), CharacterProfileSchema).optional(),
  assets: z.record(z.string(), AssetSchema).optional(),
  // also make cinematic AI video shots from the same plan (cloud when configured, else the local video model)
  cinematic: z.boolean().default(false),
});

const VIDEO_NEGATIVE = "static image, still frame, blurry, distorted face, deformed hands, morphing, flickering, jitter, low quality, watermark, text";
const VIDEO_FPS = 24;
/** Per-call spend: a cap for this task, and a report of what each task it starts is estimated to cost. */
export type SpendOpts = { maxCostUsd?: number; onCost?: (usd: number) => void };
/** A video model run: the clip plus the provider task it came from. */
export type CloudVideo = { name: string; animate: (args: Parameters<AnimateFn>[0], signal?: AbortSignal, spend?: SpendOpts) => Promise<{ footage: Footage; taskId?: string; costUsd?: number }> };
/** What cinematic shots need from the host: the editable scene's frame at a time (PNG), clip measurements, and the repair policy. */
export type ShotMedia = { frame: (spec: SceneSpec, t: number) => Promise<Uint8Array>; stats: (f: Footage) => Promise<ClipStats>; retries: number; budgetUsd: number };

/** Layered generation: its tools, and whether the segmentation models are installed. */
export type Layered = { tools: LayeredTools; ready: () => Promise<boolean> };

export function generateRoutes(
  app: FastifyInstance,
  provider: () => Provider,
  animate?: AnimateFn,
  readImage?: (src: string) => Uint8Array | null,
  layered?: Layered,
  cloud?: CloudVideo,
  media?: ShotMedia,
) {
  /** One video model for a whole job: the cloud one when configured, else the local one. */
  const shotMaker = (): CloudVideo | null =>
    cloud ?? (animate ? { name: "local wan2.2", animate: async (a, s) => ({ footage: await animate(a, s) }) } : null);
  app.post("/api/generate", async (req, reply) => {
    const r = Body.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const p = provider();
    const jobId = startJob(async (emit, signal) => {
      if (!layered || !(await layered.ready())) throw new AIError("Generating needs the image painter and its segmentation models", "Run pnpm setup:painter --layered (about 11 GB the first time).");
      let plan: LayeredPlan | null = null;
      const spec = await generateLayered(r.data, p, layered.tools, (e: LayeredEvent) => (e.type === "plan" && (plan = e.plan), emit(e as JobEvent)), signal);
      // the quality report: what failed or needs a person's look (flagged parts, pivots, mesh weights)
      emit({ type: "quality", items: sceneChecks(spec) });
      // the editable scene is done (and saved by the editor) before any video: a failed shot never costs the scene
      if (r.data.cinematic && plan) await makeShots(spec, plan, emit, signal);
    });
    return { jobId };
  });

  /** Cinematic shots of a finished editable scene, each from its own first frame; failures are warnings, not errors. */
  async function makeShots(spec: SceneSpec, plan: LayeredPlan, emit: (e: JobEvent) => void, signal: AbortSignal) {
    const shots = cinematicShots(plan, spec.meta.duration).map((s) => ({ id: s.id, start: s.start, end: s.end, prompt: videoPrompt(s.motion, plan.environment) }));
    await runShots(spec, shots, emit, signal);
  }

  /**
   * Makes each shot with bounded retries under one spend limit for the whole job (stage-local repair: only the shot is
   * redone, never the scene). A shot that never passes its checks ends as "review" (a clip a person should look at)
   * or "failed" (no usable clip), with the reason, instead of being silently accepted.
   */
  async function runShots(spec: SceneSpec, shots: { id: string; start: number; end: number; prompt: string }[], emit: (e: JobEvent) => void, signal: AbortSignal) {
    const maker = shotMaker();
    if (!maker || !media) return emit({ type: "warning", message: "No video model is set up, so no cinematic video was made", fix: "Set CLOUD_VIDEO_ENABLED=1 and RUNWAY_API_KEY in .env, or run pnpm setup:painter --video" });
    const aspect = spec.meta.width === spec.meta.height ? "1:1" : spec.meta.width > spec.meta.height ? "16:9" : "9:16";
    const [width, height] = VIDEO_SIZE[aspect];
    let left = media.budgetUsd;
    // best attempt so far: a passing clip beats one to review beats a broken clip beats none
    const rank = (s: CinematicShot) => (s.status === "ready" ? 3 : s.status === "review" ? 2 : s.footage ? 1 : 0);
    for (const s of shots) {
      const base = { type: "shot", id: s.id, start: s.start, end: s.end, source: maker.name };
      let best: CinematicShot = { ...s, source: maker.name, status: "failed", checks: [], attempts: 0 };
      for (let attempt = 1; attempt <= 1 + media.retries && best.status !== "ready"; attempt++) {
        signal.throwIfAborted();
        if (left <= 0) {
          best = { ...best, review: `Not made: the $${media.budgetUsd.toFixed(2)} spend limit for this job was reached` };
          break;
        }
        emit({ type: "status", phase: "cinematic", message: `Making the cinematic shot "${s.id}" with ${maker.name}${attempt > 1 ? ` (retry ${attempt - 1} of ${media.retries})` : ""}` });
        emit({ ...base, status: "running", attempt });
        let next: CinematicShot;
        let stop = false;
        try {
          const image = await media.frame(spec, s.start);
          const r = await maker.animate({ image, positive: s.prompt, negative: VIDEO_NEGATIVE, width, height, frames: Math.round((s.end - s.start) * VIDEO_FPS), fps: VIDEO_FPS, seed: Math.floor(Math.random() * 2 ** 31) }, signal, { maxCostUsd: left, onCost: (usd) => (left -= usd) });
          const checks = clipChecks(await media.stats(r.footage), { seconds: s.end - s.start, aspect: spec.meta.width / spec.meta.height }).map(({ target: _, ...c }) => c);
          const w = worst(checks);
          next = { ...s, footage: r.footage, source: maker.name, taskId: r.taskId, costUsd: r.costUsd, checks, attempts: attempt, status: w === "pass" ? "ready" : w === "review" ? "review" : "failed", review: checks.map((c) => c.note).join("; ") || undefined };
        } catch (e) {
          if (signal.aborted) throw e;
          next = { ...best, attempts: attempt, review: (e as Error).message };
          stop = (e as { code?: string }).code === "budget"; // a retry can't fit the limit either
        }
        // keep the better clip, but always the latest attempt count and, with no better clip, the latest reason
        best = rank(next) > rank(best) ? next : { ...best, attempts: attempt, review: rank(best) ? best.review : next.review };
        if (stop) break;
      }
      // a broken clip that never came good is kept for a person to judge, not passed off as ready
      if (best.status === "failed" && best.footage) best = { ...best, status: "review" };
      emit({ ...base, status: best.status === "ready" ? "done" : best.status, message: best.review, shot: best });
    }
  }

  const Retry = z.object({ spec: z.unknown(), ids: z.array(z.string()).optional() });
  /** Redoes only some cinematic shots of a scene (default: those not ready), from their stored prompts; the scene itself is untouched. */
  app.post("/api/shots/retry", async (req, reply) => {
    const b = Retry.safeParse(req.body);
    const spec = b.success ? SceneSpecSchema.safeParse(b.data.spec) : null;
    if (!b.success || !spec?.success) return reply.code(400).send({ error: "Send the scene (spec) and optionally the shot ids to redo" });
    const shots = (spec.data.cinematic ?? []).filter((s) => (b.data.ids ? b.data.ids.includes(s.id) : s.status !== "ready"));
    if (!shots.length) return reply.code(422).send({ error: "No cinematic shots to redo" });
    if (!shotMaker() || !media) return reply.code(422).send({ error: "No video model is set up", fix: "Set CLOUD_VIDEO_ENABLED=1 and RUNWAY_API_KEY in .env, or run pnpm setup:painter --video" });
    const jobId = startJob((emit, signal) => runShots(spec.data, shots.map((s) => ({ id: s.id, start: s.start, end: s.end, prompt: s.prompt })), emit, signal));
    return { jobId };
  });

  const Video = z.object({ src: z.string(), motion: z.string().max(600).default(""), scene: z.string().max(600).default(""), aspect: z.enum(["16:9", "9:16", "1:1"]),
    // default: the cloud model when one is configured, else the local one
    provider: z.enum(["local", "cloud"]).optional() });
  /** Turns an existing painting into a frame-by-frame clip (a job, like generate: follow /api/jobs/:id/events). */
  app.post("/api/paintings/video", async (req, reply) => {
    const r = Video.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues[0].message });
    const useCloud = r.data.provider === "cloud" || (!r.data.provider && !!cloud);
    if (useCloud && !cloud) return reply.code(422).send({ error: "Cloud video isn't set up", fix: "Set CLOUD_VIDEO_ENABLED=1 and RUNWAY_API_KEY in .env" });
    const run: AnimateFn | undefined = useCloud ? async (a, s) => (await cloud!.animate(a, s)).footage : animate;
    if (!run || !readImage) return reply.code(422).send({ error: "The video model isn't set up", fix: "Run pnpm setup:painter --video" });
    const png = readImage(r.data.src);
    if (!png) return reply.code(404).send({ error: "Image not found" });
    const jobId = startJob(async (emit, signal) => {
      const [width, height] = VIDEO_SIZE[r.data.aspect];
      const t0 = Date.now();
      const say = () => emit({ type: "status", phase: "video", message: useCloud ? `Animating with ${cloud!.name} in the cloud (${Math.round((Date.now() - t0) / 1000)} s; usually 1–3 min)` : `Animating the painting frame by frame (${Math.round((Date.now() - t0) / 1000)} s; usually 5–10 min)` });
      say();
      const tick = setInterval(say, 15_000);
      try {
        const clip = await run({ image: png, positive: videoPrompt(r.data.motion, r.data.scene), negative: "static image, still frame, blurry, distorted face, deformed hands, morphing, flickering, jitter, low quality, watermark, text", width, height, frames: 121, fps: 24, seed: Math.floor(Math.random() * 2 ** 31) }, signal);
        emit({ type: "footage", footage: clip });
      } finally {
        clearInterval(tick);
      }
    });
    return { jobId };
  });

  const View = z.object({ look: z.string().trim().min(2).max(600), seed: z.number().int().min(0).optional(), view: z.enum(["three_quarter", "profile"]), facing: z.enum(["left", "right"]), front: z.string() });
  /**
   * Paints a character's head turned to one side (from its saved look and seed) and cuts it out. The editor adds it as a
   * view the head can switch to. Answers when done (a painting and two masks, so a while on a GPU).
   */
  app.post("/api/characters/view", async (req, reply) => {
    const b = View.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues[0].message });
    if (!layered || !(await layered.ready())) return reply.code(422).send({ error: "Generating needs the image painter and its segmentation models", fix: "Run pnpm setup:painter --layered" });
    const front = readImage?.(b.data.front);
    if (!front) return reply.code(404).send({ error: "The front head image is missing" });
    const ac = new AbortController();
    reply.raw.on("close", () => !reply.raw.writableFinished && ac.abort());
    try {
      return await paintView({ ...b.data, front }, layered.tools, ac.signal);
    } catch (e) {
      if (e instanceof AIError) return reply.code(422).send({ error: e.message, fix: e.fix });
      throw e;
    }
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
