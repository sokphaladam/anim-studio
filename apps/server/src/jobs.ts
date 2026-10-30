import { randomUUID } from "node:crypto";

export type JobEvent = { type: string; [k: string]: unknown };
type Job = { events: JobEvent[]; listeners: Set<(e: JobEvent) => void>; controller: AbortController; finished: boolean };

const jobs = new Map<string, Job>();
const KEEP_MS = 10 * 60_000;

/** Runs `work` in the background; its events are kept so a late SSE subscriber gets the full history. */
export function startJob(work: (emit: (e: JobEvent) => void, signal: AbortSignal) => Promise<void>): string {
  const id = randomUUID();
  const job: Job = { events: [], listeners: new Set(), controller: new AbortController(), finished: false };
  jobs.set(id, job);
  const emit = (e: JobEvent) => {
    job.events.push(e);
    for (const l of job.listeners) l(e);
  };
  work(emit, job.controller.signal)
    .catch((err: Error & { fix?: string }) => emit(job.controller.signal.aborted ? { type: "error", message: "Cancelled" } : { type: "error", message: err.message, fix: err.fix }))
    .finally(() => {
      job.finished = true;
      for (const l of job.listeners) l({ type: "end" });
      setTimeout(() => jobs.delete(id), KEEP_MS).unref();
    });
  return id;
}

export const getJob = (id: string) => jobs.get(id);

export function cancelJob(id: string) {
  const job = jobs.get(id);
  if (!job || job.finished) return false;
  job.controller.abort();
  return true;
}
