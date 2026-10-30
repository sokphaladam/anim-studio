import { apply, defaultFactory, invert, layerMatrix, layerPivot, objectBounds, resolve } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { useStudio } from "../store";
import { bbox, findLayer, heldIndexAt, setStrokes, setTransform, strokePoints, transformStroke } from "../store/edit";
import { dashedPath } from "./select";
import type { Ctx2D, Pt, ToolContext, ToolController } from "./types";

type Target =
  | { kind: "strokes"; layer: string; frame: number; indices: number[]; box: [number, number, number, number] }
  | { kind: "layer"; layer: string; box: [number, number, number, number]; pivot: Pt };

type Mode = "move" | "scale" | "rotate";
let drag: { target: Target; mode: Mode; start: Pt; centerScene: Pt; base: SceneSpec } | null = null;

/** What the transform tool acts on: the selection if it is on the visible frame, else the selected layer. */
export function targetOf(spec: SceneSpec, frameNo: number): Target | null {
  const { selection, selected } = useStudio.getState();
  if (selection) {
    const l = findLayer(spec, selection.layer);
    const strokes = l?.frames?.[selection.frame]?.strokes;
    if (l && strokes && heldIndexAt(spec, l, frameNo) === selection.frame) {
      const pts = selection.indices.flatMap((i) => (strokes[i] ? strokePoints(strokes[i]) : []));
      const box = bbox(pts);
      if (box) return { kind: "strokes", layer: l.id, frame: selection.frame, indices: selection.indices, box };
    }
  }
  const l = findLayer(spec, selected);
  if (!l) return null;
  if (l.type === "drawing") {
    const held = heldIndexAt(spec, l, frameNo);
    const box = held >= 0 ? bbox(l.frames![held].strokes.flatMap(strokePoints)) : null;
    if (!box) return null;
    return { kind: "layer", layer: l.id, box, pivot: layerPivot(spec, l, defaultFactory) };
  }
  // object layers: box around what the object draws on this frame, pivot at its center
  const time = frameNo / spec.meta.fps;
  const box = objectBounds(spec, l, time, defaultFactory);
  if (!box) return null;
  return { kind: "layer", layer: l.id, box, pivot: layerPivot(spec, l, defaultFactory) };
}

export function handles(t: Target, c: Pick<ToolContext, "fromLayer" | "unitsPerPx">) {
  const pad = 6 * c.unitsPerPx;
  const [x0, y0, x1, y1] = t.box;
  const corners = ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Pt[]).map((p) => c.fromLayer(t.layer, p));
  const center = c.fromLayer(t.layer, t.kind === "layer" ? t.pivot : [(x0 + x1) / 2, (y0 + y1) / 2]);
  const top: Pt = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
  const up = Math.hypot(top[0] - center[0], top[1] - center[1]) || 1;
  const rot: Pt = [top[0] + ((top[0] - center[0]) / up) * 28 * c.unitsPerPx, top[1] + ((top[1] - center[1]) / up) * 28 * c.unitsPerPx];
  return { corners, center, top, rot, pad };
}

export const transformTool: ToolController = {
  cursor: "move",
  down(_e, c) {
    const s = useStudio.getState();
    const target = targetOf(c.spec, c.frame);
    if (!target) return c.toast("Nothing to transform", "Select a layer that has something on this frame.");
    if (s.locked[target.layer]) return c.toast("Layer is locked", "Unlock it in the Layers docker to transform it.");
    const h = handles(target, c);
    const near = (p: Pt) => Math.hypot(p[0] - c.scene[0], p[1] - c.scene[1]) < 10 * c.unitsPerPx;
    const mode: Mode = near(h.rot) ? "rotate" : h.corners.some(near) ? "scale" : "move";
    s.beginGesture();
    drag = { target, mode, start: c.scene, centerScene: h.center, base: c.spec };
  },
  move(_e, c) {
    if (!drag) return;
    const s = useStudio.getState();
    const { target, mode, start, centerScene: cs, base } = drag;
    const ang = Math.atan2(c.scene[1] - cs[1], c.scene[0] - cs[0]) - Math.atan2(start[1] - cs[1], start[0] - cs[0]);
    const k = Math.max(0.02, Math.hypot(c.scene[0] - cs[0], c.scene[1] - cs[1]) / (Math.hypot(start[0] - cs[0], start[1] - cs[1]) || 1));
    if (target.kind === "strokes") {
      const a = c.toLayer(target.layer, start), b = c.toLayer(target.layer, c.scene);
      const [x0, y0, x1, y1] = target.box;
      const center: Pt = [(x0 + x1) / 2, (y0 + y1) / 2];
      const strokes = findLayer(base, target.layer)!.frames![target.frame].strokes.map((st, i) =>
        !target.indices.includes(i) ? st : mode === "move" ? transformStroke(st, b[0] - a[0], b[1] - a[1], 1, 0, center) : mode === "scale" ? transformStroke(st, 0, 0, k, 0, center) : transformStroke(st, 0, 0, 1, ang, center),
      );
      s.preview(setStrokes(base, target.layer, target.frame, strokes));
    } else {
      const l = findLayer(base, target.layer)!;
      const cur = resolve({ x: 0, y: 0, rotation: 0, scale: 1, ...l.transform }, base, c.time);
      // scene delta → the layer's parent space (undo the camera)
      const cam = invert(layerMatrix(base, null, c.time));
      const [ox, oy] = apply(cam, start[0], start[1]), [nx, ny] = apply(cam, c.scene[0], c.scene[1]);
      const values = mode === "move" ? { x: cur.x + nx - ox, y: cur.y + ny - oy } : mode === "scale" ? { scale: cur.scale * k } : { rotation: cur.rotation + ang };
      s.preview(setTransform(base, target.layer, values, c.frame, s.autoKey));
    }
  },
  up() {
    if (!drag) return;
    const { mode, target } = drag;
    drag = null;
    const s = useStudio.getState();
    s.endGesture(`${mode === "move" ? "Move" : mode === "scale" ? "Scale" : "Rotate"} ${target.kind === "strokes" ? "selection" : target.layer}`);
  },
  overlay(g: Ctx2D, c) {
    const target = targetOf(c.spec, c.frame);
    if (!target) return;
    const h = handles(target, c);
    g.save();
    dashedPath(g, h.corners, c.unitsPerPx);
    g.lineWidth = c.unitsPerPx;
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--select");
    g.beginPath(); g.moveTo(...h.top); g.lineTo(...h.rot); g.stroke();
    g.fillStyle = "rgba(255,255,255,1)";
    for (const p of [...h.corners, h.rot]) {
      g.beginPath();
      g.rect(p[0] - 4 * c.unitsPerPx, p[1] - 4 * c.unitsPerPx, 8 * c.unitsPerPx, 8 * c.unitsPerPx);
      g.fill(); g.stroke();
    }
    g.beginPath(); g.arc(h.center[0], h.center[1], 3 * c.unitsPerPx, 0, Math.PI * 2); g.stroke();
    g.restore();
  },
};
