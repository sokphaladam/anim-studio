import type { SceneSpec } from "@anim/spec";
import { useStudio } from ".";
import type { ChatMessage } from "./ai";

export type ProjectSummary = { id: string; title: string; duration: number; updatedAt: number; spec: SceneSpec };

async function api<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method, signal, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; fix?: string; errors?: string[] };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Server error ${res.status}`), { fix: data.fix, errors: data.errors });
  return data;
}

export const listProjects = () => api<ProjectSummary[]>("GET", "/api/projects");

export async function openProject(id: string) {
  const p = await api<{ spec: SceneSpec; chat: ChatMessage[] }>("GET", `/api/projects/${id}`);
  const s = useStudio.getState();
  s.open(p.spec);
  s.set({ projectId: id, chat: p.chat });
}

// one save at a time, so the first save of a new scene can't create two projects
let queue: Promise<unknown> = Promise.resolve();

/** Saves the current scene as a new version (creating the project on first save). Resolves with the project id. */
export function saveProject(label: string): Promise<string | null> {
  const run = async () => {
    const { spec, projectId, chat, set } = useStudio.getState();
    if (!spec) return null;
    const body = { spec, label, chat: chat.slice(-200) };
    if (projectId) {
      await api("PUT", `/api/projects/${projectId}`, body);
      return projectId;
    }
    const { id } = await api<{ id: string }>("POST", "/api/projects", body);
    // the user may have opened another scene while this saved
    if (useStudio.getState().spec === spec) set({ projectId: id });
    return id;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

export type EditResponse = { patch: { op: string; path: string; value?: unknown }[]; spec: SceneSpec; version: number; fullSpec: boolean };

/** Saves, then asks the server for an AI edit of the saved scene. */
export async function requestEdit(instruction: string, signal: AbortSignal): Promise<EditResponse> {
  const id = await saveProject("Before AI edit");
  if (!id) throw new Error("Open a scene first");
  return api<EditResponse>("POST", `/api/projects/${id}/edit`, { instruction }, signal);
}
