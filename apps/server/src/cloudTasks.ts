import { pollVideo, type Footage, type VideoProvider, type VideoTask } from "@anim/ai";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** A paid cloud task this server started: running until it finishes, or recovered after a restart. */
export type CloudTaskEntry = { task: VideoTask; fps: number; prompt: string; startedAt: number; status: "running" | "recovered"; footage?: Footage; recoveredAt?: number };

/**
 * A small JSON journal of cloud video tasks, so a restart mid-generation doesn't lose a clip that was already paid for:
 * tasks still running at start-up are polled to the end and their clips stored. One server writes it; writes are atomic.
 */
export function cloudTaskJournal(file: string) {
  const read = (): CloudTaskEntry[] => {
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CloudTaskEntry[]) : [];
    } catch {
      return []; // a corrupt journal must not stop the server; the tasks in it are then only on Runway's side
    }
  };
  const write = (list: CloudTaskEntry[]) => {
    writeFileSync(`${file}.tmp`, JSON.stringify(list, null, 1));
    renameSync(`${file}.tmp`, file);
  };
  const without = (id: string) => read().filter((e) => e.task.providerTaskId !== id);
  return {
    list: read,
    started: (task: VideoTask, fps: number, prompt: string) => write([...without(task.providerTaskId), { task, fps, prompt, startedAt: Date.now(), status: "running" }]),
    finished: (id: string) => write(without(id)),
    /**
     * Polls the tasks left running by an earlier run. A finished clip is stored (split into frames like any other) and
     * kept in the journal as "recovered"; a failed or vanished task is dropped. Runs in the background.
     */
    async resume(p: VideoProvider, store: (bytes: Uint8Array, fps: number) => Promise<Footage>, log: (msg: string, data: object) => void, pollMs?: number) {
      for (const e of read().filter((x) => x.status === "running" && x.task.provider === p.id)) {
        try {
          const r = await pollVideo(p, e.task, { pollMs });
          const footage = await store(r.bytes, e.fps);
          write([...without(e.task.providerTaskId), { ...e, task: r.task, status: "recovered", footage, recoveredAt: Date.now() }]);
          log("recovered a cloud video from before the restart", { taskId: e.task.providerTaskId, frames: footage.frames });
        } catch (err) {
          write(without(e.task.providerTaskId));
          log("dropped a cloud video task from before the restart", { taskId: e.task.providerTaskId, reason: (err as Error).message });
        }
      }
    },
  };
}
