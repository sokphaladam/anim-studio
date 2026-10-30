import { useStudio } from "../store";
import { findLayer, heldIndexAt, pointInPolygon, setStrokes, strokePoints } from "../store/edit";
import { matrixFor } from "./paint";
import type { Ctx2D, Pt, ToolContext, ToolController } from "./types";

let drag: { layer: string; poly: Pt[]; start: Pt } | null = null;

function selectionPolygon(): Pt[] {
  if (!drag) return [];
  if (useStudio.getState().selectMode === "lasso") return drag.poly;
  const [a, b] = [drag.start, drag.poly[drag.poly.length - 1]];
  return [a, [b[0], a[1]], b, [a[0], b[1]]];
}

export function dashedPath(g: Ctx2D, poly: Pt[], unitsPerPx: number) {
  if (poly.length < 2) return;
  g.lineWidth = unitsPerPx;
  g.beginPath();
  poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.setLineDash([4 * unitsPerPx, 4 * unitsPerPx]);
  g.strokeStyle = "rgba(0,0,0,.8)";
  g.stroke();
  g.lineDashOffset = 4 * unitsPerPx;
  g.strokeStyle = "rgba(255,255,255,.95)";
  g.stroke();
  g.setLineDash([]);
}

/** Removes the selected strokes from their frame. */
export function deleteSelection() {
  const s = useStudio.getState();
  const sel = s.selection, l = sel && s.spec && findLayer(s.spec, sel.layer);
  if (!sel || !l?.frames?.[sel.frame]) return;
  const keep = l.frames[sel.frame].strokes.filter((_, i) => !sel.indices.includes(i));
  s.commit("Delete selection", setStrokes(s.spec!, sel.layer, sel.frame, keep));
  s.set({ selection: null });
}

export const selectTool: ToolController = {
  cursor: "crosshair",
  down(_e, c) {
    const { selected, spec } = useStudio.getState();
    const l = findLayer(spec!, selected);
    if (!l || l.type !== "drawing") {
      c.toast("Select a drawing layer", "Selections work on the strokes of the current frame.");
      return;
    }
    const p = c.toLayer(l.id, c.scene);
    drag = { layer: l.id, poly: [p], start: p };
  },
  move(_e, c) {
    if (drag) drag.poly.push(c.toLayer(drag.layer, c.scene));
  },
  up(_e, c: ToolContext) {
    if (!drag) return;
    const poly = selectionPolygon();
    const layer = drag.layer;
    const tiny = drag.poly.every(([x, y]) => Math.hypot(x - drag!.start[0], y - drag!.start[1]) < 3 * c.unitsPerPx);
    drag = null;
    const s = useStudio.getState();
    const l = findLayer(s.spec!, layer)!;
    const frame = heldIndexAt(s.spec!, l, c.frame);
    if (tiny || frame < 0) return s.set({ selection: null });
    const indices = l.frames![frame].strokes.flatMap((st, i) => (strokePoints(st).some((p) => pointInPolygon(p, poly)) ? [i] : []));
    s.set({ selection: indices.length ? { layer, frame, indices } : null });
  },
  overlay(g, c) {
    if (!drag) return;
    g.save();
    g.transform(...matrixFor(c, drag.layer));
    dashedPath(g, selectionPolygon(), c.unitsPerPx);
    g.restore();
  },
};
