import type { SceneSpec, StyleId } from "@anim/spec";
import { useStudio } from ".";
import { requestEdit, saveProject } from "./projects";
import { overlayKey } from "./scenes";

export type Phase = "storyboard" | "paint" | "video" | "spec" | "repair" | "edit";
export type Mode = "vector" | "painted" | "video";
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
let editing: AbortController | null = null;

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
export async function generate(req: { prompt: string; duration: number; aspect: Aspect; style?: StyleId; mode?: Mode }, fromWelcome: boolean) {
  const s = useStudio.getState();
  if (s.generation?.status === "running") return;
  const [width, height] = SIZE[req.aspect];
  const duration = Math.min(30, Math.max(5, Math.round(req.duration)));
  if (fromWelcome || !s.spec) {
    s.open({ version: 1, meta: { title: req.prompt.slice(0, 40), style: req.style, duration, fps: 30, width, height }, palette: {}, tracks: {}, layers: [], overlays: [], beats: [] });
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
  // show the painting as soon as it exists; the effects on top arrive with "done"
  on<{ src: string }>("painted", (d) => {
    const st = useStudio.getState();
    if (st.spec) st.commit("AI painting", { ...st.spec, layers: [{ id: "painting", type: "painting", params: { src: d.src } }] });
    say({ role: "assistant", text: "Painted the scene. Now animating it…" });
  });
  on<{ attempt: number; errors: string[] }>("repairing", (d) => {
    update({ phase: "repair", attempt: d.attempt, message: `Fixing ${d.errors.length} problem${d.errors.length === 1 ? "" : "s"} (attempt ${d.attempt} of 3)`, tokens: 0 });
  });
  on<{ spec: SceneSpec; repairs: number }>("done", (d) => {
    const st = useStudio.getState();
    st.commit("AI scene", d.spec);
    st.set({ aiMarks: marksFor(d.spec), t: 0, playing: true });
    update({ status: "done", message: "Done" });
    saveProject("AI scene").catch(() => {}); // autosave retries
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

/** "/layers/1/params/fallSpeed" → "window › params › fallSpeed", using layer ids instead of indices. */
function describe(op: { op: string; path: string; value?: unknown }, spec: SceneSpec) {
  const parts = op.path.split("/").slice(1).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts[0] === "layers" && spec.layers[Number(parts[1])]) parts.splice(0, 2, spec.layers[Number(parts[1])].id);
  const value = op.op === "remove" ? "removed" : `= ${JSON.stringify(op.value)}`;
  return `${parts.join(" › ")} ${value.length > 60 ? `${value.slice(0, 57)}…` : value}`;
}

/** Asks the AI to change the current scene. The result is one undoable step; the reply lists exactly what changed. */
export async function editWithAI(instruction: string) {
  const s = useStudio.getState();
  if (!s.spec || s.generation?.status === "running") return;
  say({ role: "user", text: instruction });
  s.set({ generation: { jobId: null, status: "running", phase: "edit", tokens: 0, message: "Editing the scene", attempt: 0 } });
  const ac = (editing = new AbortController());
  const before = s.spec;
  try {
    const r = await requestEdit(instruction, ac.signal);
    const st = useStudio.getState();
    // the user may have changed the scene while the model worked; don't overwrite that
    if (st.spec !== before) throw new Error("The scene changed while the AI was working — ask again");
    update({ status: "done", message: "Done" });
    if (!r.patch.length) return say({ role: "assistant", text: "The AI made no changes. Try saying it differently." });
    st.commit(`AI: ${instruction.slice(0, 40)}`, r.spec);
    const n = r.patch.length;
    const details = r.patch.slice(0, 8).map((o) => describe(o, o.op === "remove" ? before : r.spec));
    say({ role: "assistant", tone: "success", text: `Changed ${n} value${n === 1 ? "" : "s"}. Undo (Ctrl+Z) to go back.`, details: n > 8 ? [...details, `…and ${n - 8} more`] : details });
  } catch (e) {
    if (ac.signal.aborted) return;
    const err = e as Error & { fix?: string; errors?: string[] };
    const msg = e instanceof TypeError ? "The AI server is not running — start it with pnpm dev" : err.message;
    update({ status: "error", message: msg });
    say({ role: "assistant", tone: "error", text: err.fix ? `${msg}. ${err.fix}` : msg, details: err.errors?.slice(0, 8) });
  } finally {
    if (editing === ac) editing = null;
  }
}

export async function cancelGeneration() {
  const g = useStudio.getState().generation;
  if (!g || g.status !== "running") return;
  update({ status: "cancelled", message: "Cancelled" });
  editing?.abort();
  source?.close();
  say({ role: "assistant", text: "Cancelled." });
  if (g.jobId) await fetch(`/api/jobs/${g.jobId}/cancel`, { method: "POST" }).catch(() => {});
}

type Box = [number, number, number, number];

/**
 * Looks at the scene's painting and makes it move: people breathe and nod, animals breathe, lights flicker, plants
 * sway. Indoors, rain is kept inside the windows. One undoable step.
 */
export async function animatePainting() {
  const s = useStudio.getState();
  const spec = s.spec;
  const paintingLayer = spec?.layers.find((l) => l.type === "painting");
  if (!spec || !paintingLayer || s.generation?.status === "running") return;
  s.set({ generation: { jobId: null, status: "running", phase: "paint", tokens: 0, message: "Finding what can move in the painting", attempt: 0 } });
  try {
    const res = await fetch("/api/paintings/animate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ src: paintingLayer.params.src, duration: spec.meta.duration, width: spec.meta.width, height: spec.meta.height }) });
    const d = (await res.json()) as { motions?: unknown[]; windows?: Box[]; indoor?: boolean; error?: string; fix?: string };
    if (!res.ok || !d.motions) throw new Error(d.fix ? `${d.error}. ${d.fix}` : (d.error ?? `Server error ${res.status}`));
    const st = useStudio.getState();
    if (st.spec !== spec) throw new Error("The scene changed while the AI was looking — try again");
    const layers = spec.layers.flatMap((l) => {
      if (l === paintingLayer) return [{ ...l, params: { ...l.params, motions: d.motions } }];
      if (l.type !== "rain" || !d.indoor) return [l];
      // indoors: rain only in the windows
      return (d.windows ?? []).map(([x0, y0, x1, y1], i) => ({ ...l, id: `${l.id}-window-${i + 1}`, params: { ...l.params, x0, y0, x1, y1 } }));
    });
    st.commit("AI: make the painting move", { ...spec, layers });
    update({ status: "done", message: "Done" });
    const kinds = [...new Set((d.motions as { kind: string }[]).map((m) => m.kind))];
    say({ role: "assistant", tone: "success", text: d.motions.length ? `The painting moves now: ${kinds.join(", ")}.${d.indoor && d.windows?.length ? ` Rain stays in the ${d.windows.length} window(s).` : ""} Undo (Ctrl+Z) to go back.` : "I couldn't find anything in the painting that can move." });
    st.set({ playing: true });
  } catch (e) {
    const msg = e instanceof TypeError ? "The AI server is not running — start it with pnpm dev" : (e as Error).message;
    update({ status: "error", message: msg });
    say({ role: "assistant", tone: "error", text: msg });
  }
}

/**
 * Turns the scene's painting into a frame-by-frame clip with the local video model (several minutes). The painting
 * layer becomes a footage layer; rain over the painting goes, since the clip animates the weather itself.
 */
export async function paintingToVideo() {
  const s = useStudio.getState();
  const spec = s.spec;
  const paintingLayer = spec?.layers.find((l) => l.type === "painting");
  if (!spec || !paintingLayer || s.generation?.status === "running") return;
  s.set({ generation: { jobId: null, status: "running", phase: "video", tokens: 0, message: "Starting the video model…", attempt: 0 } });
  say({ role: "user", text: "Turn the painting into video" });
  let jobId: string;
  try {
    const motion = spec.beats.map((b) => b.note ?? b.label).join(". ");
    const res = await fetch("/api/paintings/video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ src: paintingLayer.params.src, motion, scene: spec.meta.title, aspect: aspectOf(spec) }) });
    const body = (await res.json()) as { jobId?: string; error?: string; fix?: string };
    if (!res.ok || !body.jobId) throw new Error(body.fix ? `${body.error}. ${body.fix}` : (body.error ?? `Server error ${res.status}`));
    jobId = body.jobId;
  } catch (e) {
    const msg = e instanceof TypeError ? "The AI server is not running — start it with pnpm dev" : (e as Error).message;
    update({ status: "error", message: msg });
    say({ role: "assistant", tone: "error", text: msg });
    return;
  }
  update({ jobId });
  source?.close();
  const es = (source = new EventSource(`/api/jobs/${jobId}/events`));
  const on = <T>(type: string, fn: (d: T) => void) => es.addEventListener(type, (ev) => fn(JSON.parse((ev as MessageEvent).data) as T));
  on<{ message: string }>("status", (d) => update({ message: d.message }));
  on<{ footage: { frames: string; count: number; fps: number } }>("footage", (d) => {
    const st = useStudio.getState();
    if (!st.spec) return;
    const layers = st.spec.layers.flatMap((l) => (l.type === "painting" ? [{ id: "video", type: "footage", params: d.footage }] : l.type === "rain" ? [] : [l]));
    st.commit("AI: painting to video", { ...st.spec, layers });
    update({ status: "done", message: "Done" });
    say({ role: "assistant", tone: "success", text: `The painting is now a ${(d.footage.count / d.footage.fps).toFixed(1)} s clip, drawn frame by frame. Undo (Ctrl+Z) to go back.` });
    st.set({ playing: true });
  });
  on<{ message: string; fix?: string }>("error", (d) => {
    if (useStudio.getState().generation?.status === "cancelled") return;
    update({ status: "error", message: d.message });
    say({ role: "assistant", tone: "error", text: d.fix ? `${d.message}. ${d.fix}` : d.message });
  });
  on("end", () => es.close());
}
