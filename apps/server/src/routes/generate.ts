import { AIError, ASPECT_SIZE, count, maskFrom, personChecks, cinematicShots, clipChecks, loopSeconds, loopShot, PAINT_SIZE, paintingPrompts, generateLayered, paintView, sceneChecks, videoPrompt, worst, VIDEO_SIZE, type AnimateFn, type ClipStats, type Footage, type LayeredEvent, type LayeredPlan, type LayeredTools, type Progress, type Provider, type StyleId } from "@anim/ai";

/** "Generating: step 2 of 4 · 45 s" and the fraction done, for a status event. */
const progressStatus = (p: Progress, t0: number) => ({ message: `${p.label}${p.steps ? `: step ${p.step} of ${p.steps}` : ""} · ${Math.round((Date.now() - t0) / 1000)} s`, progress: p.steps ? p.step! / p.steps : undefined });
import { AssetSchema, CharacterProfileSchema, SceneSpecSchema, type CinematicShot, type SceneSpec } from "@anim/spec";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cancelJob, getJob, startJob, type JobEvent } from "../jobs";

const Body = z.object({ prompt: z.string().trim().min(3, "Describe the animation in a few words").max(2000), duration: z.number().min(5).max(30), aspect: z.enum(["16:9", "9:16", "1:1"]),
  style: z.enum(["lofi", "cinematic", "retro"]).default("lofi"),
  // saved character profiles and their reference paintings, so a new scene keeps the same characters
  characters: z.record(z.string(), CharacterProfileSchema).optional(),
  assets: z.record(z.string(), AssetSchema).optional(),
  // also make cinematic AI video shots from the same plan (cloud when configured, else the local video model)
  cinematic: z.boolean().default(false),
  // natural motion: the video model animates the whole finished scene as a seamless loop, shown above its layers
  loop: z.boolean().default(false),
  // layered: separate editable parts · painting: one painting of the whole scene, moved by the video model (things stay
  // where the painter put them: a hand on the desk, a cup on the table)
  mode: z.enum(["layered", "painting"]).default("layered"),
  /** The scene's name (a song idea's title); else the prompt's start. */
  title: z.string().trim().max(80).optional(),
});

const VIDEO_NEGATIVE = "static image, still frame, blurry, distorted face, deformed hands, extra limbs, extra fingers, morphing, melting, objects moving out of place, objects appearing or disappearing, background changing, scene change, camera movement, zoom, flickering, jitter, low quality, watermark, text";
const VIDEO_FPS = 24;
/** Per-call spend: a cap for this task, and a report of what each task it starts is estimated to cost. */
export type SpendOpts = { maxCostUsd?: number; onCost?: (usd: number) => void };
/** A video model run: the clip plus the provider task it came from. */
export type CloudVideo = { name: string; estimateUsd?: (seconds: number) => number | undefined; animate: (args: Parameters<AnimateFn>[0], signal?: AbortSignal, spend?: SpendOpts) => Promise<{ footage: Footage; taskId?: string; costUsd?: number }> };
/** What cinematic shots need from the host: the editable scene's frame at a time (PNG), clip measurements, and the repair policy. */
export type ShotMedia = { frame: (spec: SceneSpec, t: number) => Promise<Uint8Array>; stats: (f: Footage) => Promise<ClipStats>; still: (f: Footage, at: number) => Uint8Array; retries: number; budgetUsd: number };

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
    cloud ?? (animate ? { name: "local wan2.2", animate: async (a, s) => ({ footage: { ...(await animate(a, s)), ...(a.loop && { loops: true }) } }) } : null);
  app.post("/api/generate", async (req, reply) => {
    const r = Body.safeParse(req.body);
    if (!r.success) return reply.code(400).send({ error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    if (r.data.mode === "painting") return { jobId: startJob((emit, signal) => paintScene(r.data, emit, signal)) };
    const p = provider();
    const jobId = startJob(async (emit, signal) => {
      if (!layered || !(await layered.ready())) throw new AIError("Generating needs the image painter and its segmentation models", "Run pnpm setup:painter --layered (about 11 GB the first time).");
      let plan: LayeredPlan | null = null;
      const spec = await generateLayered(r.data, p, layered.tools, (e: LayeredEvent) => (e.type === "plan" && (plan = e.plan), emit(e as JobEvent)), signal);
      // the quality report: what failed or needs a person's look (flagged parts, pivots, mesh weights)
      emit({ type: "quality", items: sceneChecks(spec) });
      // the editable scene is done (and saved by the editor) before any video: a failed shot never costs the scene
      if (plan && (r.data.cinematic || r.data.loop)) await makeShots(spec, plan, emit, signal, { cinematic: r.data.cinematic, loop: r.data.loop, style: r.data.style });
    });
    return { jobId };
  });

  /**
   * Single-painting mode: paints the whole scene once (no planning model, no cut-outs), shows it as the scene, then has
   * the video model move it as a seamless loop over it. Without a video model the painting is still shown, with a warning.
   */
  async function paintScene(req: z.infer<typeof Body>, emit: (e: JobEvent) => void, signal: AbortSignal) {
    const painter = layered?.tools.painter;
    if (!painter) throw new AIError("Painting needs the image painter", "Run pnpm setup:painter.");
    const { paint, video, person } = paintingPrompts(req.prompt, req.style);
    const [pw, ph] = PAINT_SIZE[req.aspect];
    const [width, height] = ASPECT_SIZE[req.aspect];
    emit({ type: "status", phase: "background", message: "Painting the whole scene" });
    // the painter sometimes leaves the person out of a busy room; the video model then paints her in mid-clip and she
    // pops in and out at every loop, so a painting without her is redone (the check needs the segmentation model)
    const check = person && !!painter.segment && (await layered!.ready());
    let png: Uint8Array;
    for (let attempt = 1; ; attempt++) {
      const t0 = Date.now();
      png = await painter.paint({ ...paint, width: pw, height: ph, seed: Math.floor(Math.random() * 2 ** 31), signal, onProgress: (p) => emit({ type: "status", phase: "background", ...progressStatus(p, t0), message: `Painting the whole scene · ${progressStatus(p, t0).message}` }) });
      if (!check) break;
      emit({ type: "status", phase: "background", message: "Checking the person is in the painting" });
      const found = maskFrom(await layered!.tools.decode(await painter.segment!(png, "person", signal)));
      if (count(found) >= found.length * 0.005) break; // a medium-shot person covers far more than 0.5% of the frame
      if (attempt === 3) {
        emit({ type: "warning", message: "The painter left the person out 3 times, so the video may add them partway through", fix: "Generate again, or name the person earlier and more simply in the prompt" });
        break;
      }
      emit({ type: "status", phase: "background", message: `The person is missing from the painting, painting it again (${attempt + 1} of 3)` });
    }
    const src = layered!.tools.store(png);
    emit({ type: "painted", src });
    // zoom 1 and no sway: the video loop is made from this exact frame and must line up with it
    const spec: SceneSpec = { version: 1, meta: { title: req.title || req.prompt.replace(/^cozy lofi anime illustration,?\s*/i, "").slice(0, 40), duration: req.duration, fps: 30, width, height }, palette: {}, tracks: {}, layers: [{ id: "painting", type: "painting", params: { src, zoom: 1, swaySeconds: 0 } }], overlays: [], beats: [] };
    emit({ type: "done", spec, repairs: 0 });
    await runShots(spec, [{ id: "loop", start: 0, end: loopSeconds(req.duration), prompt: video }], emit, signal);
  }

  /** Cinematic shots of a finished editable scene, each from its own first frame; failures are warnings, not errors. */
  async function makeShots(spec: SceneSpec, plan: LayeredPlan, emit: (e: JobEvent) => void, signal: AbortSignal, want: { cinematic: boolean; loop: boolean; style: StyleId }) {
    // the loop first: it is what the scene plays; cinematic shots are extras beside it
    const list = [...(want.loop ? [loopShot(plan, spec.meta.duration)] : []), ...(want.cinematic ? cinematicShots(plan, spec.meta.duration) : [])];
    const shots = list.map((s) => ({ id: s.id, start: s.start, end: s.end, prompt: videoPrompt(s.motion, plan.environment, want.style) }));
    await runShots(spec, shots, emit, signal);
  }

  /** Whether the clip invents or loses a person (needs the segmentation model; skipped without it). */
  async function personCheck(first: Uint8Array, f: Footage, signal: AbortSignal) {
    const painter = layered?.tools.painter;
    if (!painter?.segment || !(await layered!.ready())) return [];
    const share = async (png: Uint8Array) => {
      const m = maskFrom(await layered!.tools.decode(await painter.segment!(png, "person", signal)));
      return count(m) / m.length;
    };
    return personChecks(await share(first), [await share(media!.still(f, 0.5)), await share(media!.still(f, 0.9))]);
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
        const quote = maker.estimateUsd?.(s.end - s.start);
        const what = `Making ${s.id === "loop" ? "the natural-motion loop" : `the cinematic shot "${s.id}"`} with ${maker.name}${quote ? `, about $${quote.toFixed(2)}` : ""}${attempt > 1 ? ` (retry ${attempt - 1} of ${media.retries})` : ""}`;
        emit({ type: "status", phase: "cinematic", message: what });
        const t0 = Date.now();
        // the local model reports its stages and steps; a cloud one only says when it is done
        const onProgress = (p: Progress) => { const st = progressStatus(p, t0); emit({ type: "status", phase: "cinematic", message: `${what} · ${st.message}`, progress: st.progress }); };
        emit({ ...base, status: "running", attempt });
        let next: CinematicShot;
        let stop = false;
        try {
          const image = await media.frame(spec, s.start);
          const r = await maker.animate({ image, positive: s.prompt, negative: VIDEO_NEGATIVE, width, height, frames: Math.round((s.end - s.start) * VIDEO_FPS), fps: VIDEO_FPS, seed: Math.floor(Math.random() * 2 ** 31), loop: s.id === "loop", onProgress }, signal, { maxCostUsd: left, onCost: (usd) => (left -= usd) });
          const checks = [...clipChecks(await media.stats(r.footage), { seconds: s.end - s.start, aspect: spec.meta.width / spec.meta.height, loops: r.footage.loops }), ...(await personCheck(image, r.footage, signal))].map(({ target: _, ...c }) => c);
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
      let st: { message: string; progress?: number } | undefined;
      const say = () => emit({ type: "status", phase: "video", progress: st?.progress, message: st ? `Animating the painting · ${st.message}` : useCloud ? `Animating with ${cloud!.name} in the cloud (${Math.round((Date.now() - t0) / 1000)} s; usually 1–3 min)` : `Animating the painting frame by frame (${Math.round((Date.now() - t0) / 1000)} s; usually 5–10 min)` });
      say();
      const tick = setInterval(say, 15_000);
      try {
        const clip = await run({ image: png, positive: videoPrompt(r.data.motion, r.data.scene), negative: VIDEO_NEGATIVE, width, height, frames: 121, fps: 24, seed: Math.floor(Math.random() * 2 ** 31), onProgress: (p) => ((st = progressStatus(p, t0)), say()) }, signal);
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
