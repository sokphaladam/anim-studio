import { drawStroke } from "@anim/engine";
import type { Stroke } from "@anim/spec";
import { useStudio } from "../store";
import { addStroke } from "../store/edit";
import { matrixFor } from "./paint";
import type { Pt, ToolController } from "./types";

let drag: { layer: string; a: Pt; b: Pt; shift: boolean } | null = null;

/** Outline points (layer space) for the current shape; Shift makes squares, circles and 45° lines. */
export function shapePoints(kind: "line" | "rect" | "ellipse", a: Pt, b: Pt, shift: boolean): Pt[] {
  let [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  if (shift && kind === "line") {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
    [dx, dy] = [Math.cos(ang) * len, Math.sin(ang) * len];
  } else if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    [dx, dy] = [Math.sign(dx || 1) * m, Math.sign(dy || 1) * m];
  }
  const lerp = (p: Pt, q: Pt, n: number): Pt[] => Array.from({ length: n }, (_, i) => [p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n]);
  const b2: Pt = [a[0] + dx, a[1] + dy];
  if (kind === "line") return [...lerp(a, b2, 8), b2];
  if (kind === "rect") {
    const c: Pt[] = [a, [b2[0], a[1]], b2, [a[0], b2[1]]];
    return [...c.flatMap((p, i) => lerp(p, c[(i + 1) % 4], 6)), a];
  }
  const cx = a[0] + dx / 2, cy = a[1] + dy / 2;
  return Array.from({ length: 65 }, (_, i) => [cx + (Math.cos((i / 64) * Math.PI * 2) * dx) / 2, cy + (Math.sin((i / 64) * Math.PI * 2) * dy) / 2]);
}

function strokeNow(): Exclude<Stroke, { tool: "fill" }> | null {
  if (!drag) return null;
  const s = useStudio.getState();
  const alpha = Math.round((s.brush.opacity / 100) * 255);
  return {
    tool: "brush",
    preset: s.brush.preset,
    color: alpha >= 255 ? s.color : s.color + alpha.toString(16).padStart(2, "0"),
    size: s.brush.size,
    points: shapePoints(s.shape, drag.a, drag.b, drag.shift).map(([x, y]) => [+x.toFixed(2), +y.toFixed(2), 0.5]),
  };
}

export const shapesTool: ToolController = {
  cursor: "crosshair",
  down(e, c) {
    const layer = c.drawingTarget();
    if (!layer) return;
    const p = c.toLayer(layer, c.scene);
    drag = { layer, a: p, b: p, shift: e.shiftKey };
  },
  move(e, c) {
    if (drag) drag = { ...drag, b: c.toLayer(drag.layer, c.scene), shift: e.shiftKey };
  },
  up(_e, c) {
    const stroke = strokeNow(), layer = drag?.layer;
    const moved = drag && Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]) > 1;
    drag = null;
    if (!stroke || !layer || !moved) return;
    const s = useStudio.getState();
    s.commit(`Draw ${s.shape}`, addStroke(s.spec!, layer, c.frame, stroke, s.autoFrame));
  },
  overlay(g, c) {
    const stroke = strokeNow();
    if (!stroke || !drag) return;
    g.save();
    g.transform(...matrixFor(c, drag.layer));
    drawStroke(g, stroke, 1);
    g.restore();
  },
};
