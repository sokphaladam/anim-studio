import type { SceneSpec } from "@anim/spec";
import { useStudio } from ".";
import { overlayKey } from "./scenes";

export type Phase = "storyboard" | "spec" | "repair";
export type Generation = {
  jobId: string | null;
  status: "running" | "done" | "error" | "cancelled";
  phase: Phase;
  tokens: number;
  message: string;
  attempt: number;
};
export type ChatMessage = { role: "user" | "assistant"; text: string; tone?: "error" | "success"; details?: string[] };

export type Aspect = "16:9" | "9:16" | "1:1";
export const aspectOf = (s: SceneSpec): Aspect => (s.meta.width > s.meta.height ? "16:9" : s.meta.width < s.meta.height ? "9:16" : "1:1");
const SIZE: Record<Aspect, [number, number]> = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [1080, 1080] };

let source: EventSource | null = null;

const say = (m: ChatMessage) => useStudio.getState().set({ chat: [...useStudio.getState().chat, m] });
const update = (p: Partial<Generation>) => {
  const g = useStudio.getState().generation;
  if (g) useStudio.getState().set({ generation: { ...g, ...p } });
};

/** Marks every row of a freshly generated scene as AI-made. */
function marksFor(spec: SceneSpec): Record<string, unknown> {
  return Object.fromEntries([...spec.layers.map((l) => [l.id, l] as const), ...spec.overlays.map((o, i) => [overlayKey(i), o] as const)]);
}

/**
 * Asks the server to generate a scene and follows its progress over SSE. The storyboard's beats land on the
 * timeline first; the finished scene replaces the current one as an undoable step.
 */
export async function generate(req: { prompt: string; duration: number; aspect: Aspect }, fromWelcome: boolean) {
  const s = useStudio.getState();
  if (s.generation?.status === "running") return;
  const [width, height] = SIZE[req.aspect];
  const duration = Math.min(30, Math.max(5, Math.round(req.duration)));
  if (fromWelcome || !s.spec) {
    s.open({ version: 1, meta: { title: req.prompt.slice(0, 40), duration, fps: 30, width, height }, palette: {}, tracks: {}, layers: [], overlays: [], beats: [] });
    useStudio.getState().set({ chat: [] });
  }
  say({ role: "user", text: req.prompt });
  useStudio.getState().set({ generation: { jobId: null, status: "running", phase: "storyboard", tokens: 0, message: "Starting…", attempt: 0 } });

  let jobId: string;
  try {
    const res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...req, duration }) });
    const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
    if (!res.ok || !body.jobId) throw new Error(body.error ?? `Server error ${res.status}`);
    jobId = body.jobId;
  } catch (e) {
    const msg = e instanceof TypeError || /Failed to fetch|ECONNREFUSED|50\d/.test(String(e)) ? "The AI server is not running — start it with pnpm dev" : (e as Error).message;
    update({ status: "error", message: msg });
    say({ role: "assistant", text: msg, tone: "error" });
    return;
  }
  update({ jobId });

  source?.close();
  const es = (source = new EventSource(`/api/jobs/${jobId}/events`));
  const on = <T>(type: string, fn: (d: T) => void) => es.addEventListener(type, (ev) => fn(JSON.parse((ev as MessageEvent).data) as T));

  on<{ phase: Phase; message: string }>("status", (d) => update({ phase: d.phase, message: d.message, tokens: 0 }));
  on<{ phase: Phase; tokens: number }>("token", (d) => update({ tokens: d.tokens }));
  on<{ storyboard: { title: string; mood: string; palette: Record<string, string>; beats: SceneSpec["beats"] }; meta: SceneSpec["meta"] }>("storyboard", (d) => {
    const st = useStudio.getState();
    // show the plan right away: beats on the timeline, palette in the color docker
    st.commit("AI storyboard", { version: 1, meta: d.meta, palette: d.storyboard.palette, tracks: {}, layers: [], overlays: [], beats: d.storyboard.beats });
    st.set({ t: 0, selected: null, selection: null, hidden: {}, locked: {} });
    say({ role: "assistant", text: `Storyboard: “${d.storyboard.title}”${d.storyboard.mood ? ` (${d.storyboard.mood})` : ""}`, details: d.storyboard.beats.map((b) => `${b.at}s · ${b.label}${b.note ? ` — ${b.note}` : ""}`) });
  });
  on<{ attempt: number; errors: string[] }>("repairing", (d) => {
    update({ phase: "repair", attempt: d.attempt, message: `Fixing ${d.errors.length} problem${d.errors.length === 1 ? "" : "s"} (attempt ${d.attempt} of 3)`, tokens: 0 });
  });
  on<{ spec: SceneSpec; repairs: number }>("done", (d) => {
    const st = useStudio.getState();
    st.commit("AI scene", d.spec);
    st.set({ aiMarks: marksFor(d.spec), t: 0, playing: true });
    update({ status: "done", message: "Done" });
    say({ role: "assistant", tone: "success", text: `Built ${d.spec.layers.length} layers${d.repairs ? ` (fixed after ${d.repairs} repair${d.repairs > 1 ? "s" : ""})` : ""}. Playing it now — undo (Ctrl+Z) to go back.` });
  });
  on<{ message: string; fix?: string; errors?: string[] }>("error", (d) => {
    if (useStudio.getState().generation?.status === "cancelled") return;
    update({ status: "error", message: d.message });
    say({ role: "assistant", tone: "error", text: d.fix ? `${d.message}. ${d.fix}` : d.message, details: d.errors?.slice(0, 8) });
  });
  on("end", () => es.close());
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) return;
    es.close();
    if (useStudio.getState().generation?.status === "running") {
      update({ status: "error", message: "Lost connection to the AI server" });
      say({ role: "assistant", tone: "error", text: "Lost connection to the AI server. Is pnpm dev still running?" });
    }
  };
}

export async function cancelGeneration() {
  const g = useStudio.getState().generation;
  if (!g || g.status !== "running") return;
  update({ status: "cancelled", message: "Cancelled" });
  source?.close();
  say({ role: "assistant", text: "Cancelled." });
  if (g.jobId) await fetch(`/api/jobs/${g.jobId}/cancel`, { method: "POST" }).catch(() => {});
}
