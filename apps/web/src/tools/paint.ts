// Brush, eraser, fill and eyedropper.
import { drawStroke } from "@anim/engine";
import type { Stroke } from "@anim/spec";
import { useStudio } from "../store";
import { addStroke } from "../store/edit";
import type { Ctx2D, Pt, ToolContext, ToolController } from "./types";

type Live = { layer: string; points: [number, number, number][]; erase: boolean; last: [number, number] } | null;
let live: Live = null;

const pressureOf = (e: PointerEvent) => (e.pointerType === "mouse" ? 0.5 : Math.max(0.05, e.pressure || 0.5));
/** Pen eraser end (or barrel button 5) erases even with the brush selected. */
const penErasing = (e: PointerEvent) => e.pointerType === "pen" && (e.buttons & 32) !== 0;

function liveStroke(): Exclude<Stroke, { tool: "fill" }> | null {
  if (!live) return null;
  const s = useStudio.getState();
  if (live.erase) return { tool: "eraser", size: s.eraserSize, points: live.points };
  const alpha = Math.round((s.brush.opacity / 100) * 255);
  const color = alpha >= 255 ? s.color : s.color + alpha.toString(16).padStart(2, "0");
  return { tool: "brush", preset: s.brush.preset, color, size: s.brush.size, points: live.points };
}

function pick(c: ToolContext) {
  const color = c.pickColor();
  if (color) useStudio.getState().set({ color });
}

function addPoint(e: PointerEvent, c: ToolContext) {
  if (!live) return;
  const { brush } = useStudio.getState();
  // stabilizer: ease toward the pointer; smoothing 0 = raw, 100 = very smooth
  const k = 1 - (brush.smoothing / 100) * 0.85;
  const events = e.getCoalescedEvents?.() ?? [e];
  for (const ev of events.length ? events : [e]) {
    const target = c.toLayer(live.layer, c.sceneAt(ev));
    const x = live.last[0] + (target[0] - live.last[0]) * k, y = live.last[1] + (target[1] - live.last[1]) * k;
    live.last = [x, y];
    live.points.push([+x.toFixed(2), +y.toFixed(2), +pressureOf(ev).toFixed(3)]);
  }
}

function paintTool(erase: boolean): ToolController {
  return {
    cursor: "none",
    down(e, c) {
      if (!erase && (e.ctrlKey || e.metaKey)) return pick(c); // Ctrl while brushing = eyedropper
      const layer = c.drawingTarget();
      if (!layer) return;
      const p = c.toLayer(layer, c.scene);
      live = { layer, points: [[+p[0].toFixed(2), +p[1].toFixed(2), +pressureOf(e).toFixed(3)]], erase: erase || penErasing(e), last: p };
    },
    move(e, c) {
      if (live) addPoint(e, c);
      else if (!erase && (e.ctrlKey || e.metaKey) && e.buttons) pick(c);
    },
    up(e, c) {
      // the stabilizer trails the pointer; finish the line where the pen lifted
      if (live) {
        const p = c.toLayer(live.layer, c.sceneAt(e));
        live.points.push([+p[0].toFixed(2), +p[1].toFixed(2), +pressureOf(e).toFixed(3)]);
      }
      const stroke = liveStroke();
      const layer = live?.layer;
      live = null;
      if (!stroke || !layer) return;
      const s = useStudio.getState();
      s.commit(stroke.tool === "eraser" ? "Erase" : "Brush stroke", addStroke(s.spec!, layer, c.frame, stroke, s.autoFrame));
    },
    overlay(g, c) {
      const stroke = liveStroke();
      if (stroke && live) {
        g.save();
        g.transform(...matrixFor(c, live.layer));
        if (stroke.tool === "eraser") {
          g.globalAlpha = 0.35;
          drawStroke(g, { ...stroke, tool: "brush", preset: "marker", color: "rgb(255,255,255)" }, 1);
        } else drawStroke(g, stroke, 1);
        g.restore();
      }
      if (c.scene) {
        // brush outline cursor
        const s = useStudio.getState();
        const r = Math.max(1.5 * c.unitsPerPx, (erase ? s.eraserSize : s.brush.size) / 2);
        g.lineWidth = c.unitsPerPx;
        g.strokeStyle = "rgba(0,0,0,.6)";
        g.beginPath(); g.arc(c.scene[0], c.scene[1], r + c.unitsPerPx, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = "rgba(255,255,255,.9)";
        g.beginPath(); g.arc(c.scene[0], c.scene[1], r, 0, Math.PI * 2); g.stroke();
      }
    },
  };
}

/** Layer → scene matrix for previews, derived from the context's mapping. */
export function matrixFor(c: Pick<ToolContext, "fromLayer">, layer: string): [number, number, number, number, number, number] {
  const o = c.fromLayer(layer, [0, 0]), ex = c.fromLayer(layer, [1, 0]), ey = c.fromLayer(layer, [0, 1]);
  return [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]];
}

export const brushTool = paintTool(false);
export const eraserTool = paintTool(true);

export const fillTool: ToolController = {
  cursor: "crosshair",
  down(e, c) {
    if (e.ctrlKey || e.metaKey) return pick(c);
    const layer = c.drawingTarget();
    if (!layer) return;
    const s = useStudio.getState();
    const at = c.toLayer(layer, c.scene).map((v) => +v.toFixed(1)) as Pt;
    s.commit("Fill", addStroke(s.spec!, layer, c.frame, { tool: "fill", at, color: s.color }, s.autoFrame));
  },
  move() {},
  up() {},
  overlay() {},
};

export const eyedropperTool: ToolController = {
  cursor: "crosshair",
  down: (_e, c) => pick(c),
  move: (e, c) => e.buttons && pick(c),
  up() {},
  overlay(g: Ctx2D, c) {
    if (!c.scene) return;
    g.fillStyle = useStudio.getState().color;
    g.strokeStyle = "rgba(255,255,255,.9)";
    g.lineWidth = c.unitsPerPx * 2;
    g.beginPath(); g.arc(c.scene[0] + 14 * c.unitsPerPx, c.scene[1] - 14 * c.unitsPerPx, 8 * c.unitsPerPx, 0, Math.PI * 2); g.fill(); g.stroke();
  },
};
