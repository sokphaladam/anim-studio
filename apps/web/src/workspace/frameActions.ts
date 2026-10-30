import type { SceneSpec } from "@anim/spec";
import { frameOf, useStudio } from "../store";
import { deleteFrame, duplicateFrame, findLayer, insertBlankFrame, keyIndexAt, newDrawingLayer, setDuration } from "../store/edit";

type Toast = (t: { title: string; description?: string; tone?: "warning" }) => void;
const LABEL = { insert: "Insert blank frame", duplicate: "Duplicate frame", delete: "Delete frame" } as const;

/** Insert / duplicate / delete a drawing frame on the selected layer at the current frame. */
export function frameAction(kind: keyof typeof LABEL, toast: Toast) {
  const s = useStudio.getState();
  if (!s.spec) return;
  const l = findLayer(s.spec, s.selected);
  if (!l || l.type !== "drawing") return toast({ title: "Select a drawing layer", description: "Frame actions work on hand-drawn layers.", tone: "warning" });
  const f = frameOf(s.t, s.spec);
  const onKey = keyIndexAt(s.spec, l, f) >= 0;
  let next: SceneSpec | null = null;
  if (kind === "insert") next = insertBlankFrame(s.spec, l.id, f);
  if (kind === "duplicate") next = duplicateFrame(s.spec, l.id, f);
  if (kind === "delete") next = deleteFrame(s.spec, l.id, f);
  if (!next) {
    const why = { insert: "This frame already has a drawing; step to an empty frame first.", duplicate: "There is nothing to copy here, or the next frame is taken.", delete: "No drawing starts on this frame." }[kind];
    return toast({ title: `Can't ${LABEL[kind].toLowerCase()}`, description: why, tone: "warning" });
  }
  s.commit(LABEL[kind], next);
  if (kind === "duplicate" && onKey) s.step(1);
}

export function addDrawingLayer() {
  const s = useStudio.getState();
  if (!s.spec) return;
  const r = newDrawingLayer(s.spec, s.selected);
  s.commit("New drawing layer", r.spec);
  s.set({ selected: r.id, tool: s.tool === "transform" || s.tool === "select" ? "brush" : s.tool });
}

/** Sets the scene length (seconds), keeping the playhead and play range inside it. */
export function changeDuration(seconds: number) {
  const s = useStudio.getState();
  if (!s.spec || seconds === s.spec.meta.duration) return;
  const next = setDuration(s.spec, seconds);
  s.commit(`Scene length ${next.meta.duration}s`, next, { merge: true });
  const last = Math.round(next.meta.duration * next.meta.fps) - 1;
  s.set({
    t: Math.min(s.t, last / next.meta.fps),
    range: s.range && s.range.start <= last ? { start: s.range.start, end: Math.min(s.range.end, last) } : null,
  });
}
