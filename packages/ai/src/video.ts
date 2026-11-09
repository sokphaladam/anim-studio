import { setTimeout as sleep } from "node:timers/promises";
import { AIError } from "./types";

/** Provider-neutral video generation (docs/ANIM-STUDIO-HYBRID-ANIMATION-ARCHITECTURE.md §5). Adapters own request bodies. */
export interface VideoGenerationRequest {
  prompt: string;
  /** The first frame (PNG). */
  firstFrame: Uint8Array;
  durationSeconds: number;
  aspect: "16:9" | "9:16" | "1:1";
  resolution: "720p" | "1080p";
  seed?: number;
  audio: "none" | "native";
}

export interface VideoTask {
  provider: string;
  providerTaskId: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  estimatedCostUsd?: number;
}

export interface VideoGenerationResult {
  task: VideoTask;
  /** Only once the server has downloaded the output: provider URLs are temporary. */
  bytes?: Uint8Array;
  error?: string;
}

export interface VideoProvider {
  readonly id: string;
  readonly model: string;
  createTask(request: VideoGenerationRequest, signal?: AbortSignal): Promise<VideoTask>;
  getTask(task: VideoTask, signal?: AbortSignal): Promise<VideoGenerationResult>;
  cancelTask(task: VideoTask): Promise<void>;
}

/** Pinned models the adapter knows the request shape of; others are refused rather than guessed. */
export const RUNWAY_MODELS = ["seedance2_5", "kling_4"] as const;
const RATIO = { "720p": { "16:9": "1280:720", "9:16": "720:1280", "1:1": "960:960" }, "1080p": { "16:9": "1920:1080", "9:16": "1080:1920", "1:1": "1440:1440" } } as const;
const STATUS: Record<string, VideoTask["status"]> = { PENDING: "queued", THROTTLED: "queued", RUNNING: "running", SUCCEEDED: "succeeded", FAILED: "failed", CANCELLED: "cancelled" };
/** Runway API credits are billed at $0.01 each. */
const USD_PER_CREDIT = 0.01;

/** Runway Dev API (image to video). Server-only: the key must never reach the browser, projects, logs or job events. */
export function runway(opts: { apiKey: string; model: string; baseUrl?: string }): VideoProvider {
  if (!(RUNWAY_MODELS as readonly string[]).includes(opts.model)) throw new AIError(`Unsupported Runway video model "${opts.model}"`, `Set RUNWAY_VIDEO_MODEL to one of ${RUNWAY_MODELS.join(", ")}`);
  const base = opts.baseUrl ?? "https://api.dev.runwayml.com";
  const headers = { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json", "x-runway-version": "2024-11-06" };
  async function call(method: string, path: string, body?: unknown, signal?: AbortSignal) {
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    if (res.ok) return res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
    const text = (await res.text()).slice(0, 300);
    throw Object.assign(new AIError(`Runway answered ${res.status}: ${text}`, res.status === 401 ? "Check RUNWAY_API_KEY in .env" : undefined), { status: res.status });
  }
  const toTask = (r: Record<string, unknown>, prev?: VideoTask): VideoTask => {
    const credits = (r.estimatedCost as { credits?: number } | undefined)?.credits;
    return { provider: "runway", providerTaskId: String(r.id), model: opts.model, status: STATUS[String(r.status)] ?? prev?.status ?? "queued", estimatedCostUsd: credits != null ? credits * USD_PER_CREDIT : prev?.estimatedCostUsd };
  };
  return {
    id: "runway",
    model: opts.model,
    async createTask(q, signal) {
      // shortcut: inline data URI caps the frame at 5 MB; switch to /v1/uploads if larger first frames are needed
      const promptImage = `data:image/png;base64,${Buffer.from(q.firstFrame).toString("base64")}`;
      if (promptImage.length > 5 * 1024 * 1024) throw new AIError("The first frame is too large for Runway (5 MB limit)");
      const duration = Math.round(q.durationSeconds);
      const body =
        opts.model === "kling_4"
          ? { model: opts.model, promptImage, promptText: q.prompt, ratio: `auto_${q.resolution}`, duration }
          : { model: opts.model, promptImage, promptText: q.prompt, ratio: RATIO[q.resolution][q.aspect], duration, seed: q.seed, audio: q.audio === "native" };
      return toTask({ status: "PENDING", ...(await call("POST", "/v1/image_to_video", body, signal)) });
    },
    async getTask(task, signal) {
      const r = await call("GET", `/v1/tasks/${task.providerTaskId}`, undefined, signal);
      const next = toTask(r, task);
      if (next.status === "failed") return { task: next, error: String(r.failure ?? r.failureCode ?? "Runway couldn't make the video") };
      if (next.status !== "succeeded") return { task: next };
      const url = (r.output as string[] | undefined)?.[0];
      if (!url) return { task: { ...next, status: "failed" }, error: "Runway finished without a video" };
      const res = await fetch(url, { signal });
      if (!res.ok) throw new AIError(`Couldn't download the Runway video (${res.status})`);
      return { task: next, bytes: new Uint8Array(await res.arrayBuffer()) };
    },
    async cancelTask(task) {
      await call("DELETE", `/v1/tasks/${task.providerTaskId}`);
    },
  };
}

/**
 * Creates a task and polls it to the end; returns the downloaded MP4. Cancels the provider task when `signal` aborts,
 * on timeout, or when the provider's cost estimate is over `maxCostUsd`.
 */
export async function generateVideo(p: VideoProvider, q: VideoGenerationRequest, o: { signal?: AbortSignal; maxCostUsd?: number; pollMs?: number; timeoutMs?: number; onTask?: (t: VideoTask) => void } = {}): Promise<{ task: VideoTask; bytes: Uint8Array }> {
  const { signal, pollMs = 5000, timeoutMs = 20 * 60_000 } = o;
  let task = await p.createTask(q, signal);
  const stop = () => p.cancelTask(task).catch(() => {});
  try {
    // shortcut: the estimate only exists once the task is queued; the task is cancelled before it runs, not priced up front
    if (o.maxCostUsd != null && (task.estimatedCostUsd ?? 0) > o.maxCostUsd)
      throw Object.assign(new AIError(`This video would cost about $${task.estimatedCostUsd!.toFixed(2)}, over the $${o.maxCostUsd.toFixed(2)} left to spend`, "Raise RUNWAY_MAX_COST_USD or ask for a shorter clip"), { code: "budget" });
    o.onTask?.(task);
    const end = Date.now() + timeoutMs;
    let misses = 0;
    for (;;) {
      if (Date.now() > end) throw new AIError("The cloud video took too long and was cancelled");
      await sleep(pollMs, undefined, { signal });
      let r: VideoGenerationResult;
      try {
        r = await p.getTask(task, signal);
        misses = 0;
      } catch (e) {
        // rate limits and brief outages: keep polling, but not forever
        const status = (e as { status?: number }).status ?? 0;
        if ((status === 429 || status >= 500) && ++misses < 5) continue;
        throw e;
      }
      task = r.task;
      o.onTask?.(task);
      if (r.bytes) return { task, bytes: r.bytes };
      if (task.status === "failed" || task.status === "cancelled") throw new AIError(`Cloud video ${task.status}: ${r.error ?? "no reason given"}`);
    }
  } catch (e) {
    if (task.status !== "failed" && task.status !== "cancelled") await stop();
    throw e;
  }
}
