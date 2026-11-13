import type { DrawingFrame as Frame, Layer, SceneSpec, Stroke as StrokeT } from "@anim/spec";
import { getStroke } from "perfect-freehand";
import type { Ctx2D } from "./registry";

type Brush = Extract<StrokeT, { tool: "brush" }>;
type Eraser = Extract<StrokeT, { tool: "eraser" }>;
type Fill = Extract<StrokeT, { tool: "fill" }>;

/** Anything with a 2D context: DOM canvas, OffscreenCanvas, node canvas. */
export interface Surface {
  width: number;
  height: number;
  getContext(type: "2d"): unknown;
}
export type CanvasFactory = (w: number, h: number) => Surface;
export const ctxOf = (s: Surface) => s.getContext("2d") as Ctx2D;

export const BRUSH_PRESETS: Record<string, { thinning: number; smoothing: number; streamline: number; blur: number }> = {
  pencil: { thinning: 0.7, smoothing: 0.4, streamline: 0.3, blur: 0 },
  ink: { thinning: 0.55, smoothing: 0.5, streamline: 0.4, blur: 0 },
  marker: { thinning: 0, smoothing: 0.6, streamline: 0.4, blur: 0 },
  airbrush: { thinning: 0, smoothing: 0.6, streamline: 0.4, blur: 0.35 },
  "brush-pen": { thinning: 0.85, smoothing: 0.6, streamline: 0.5, blur: 0 },
  wash: { thinning: 0.2, smoothing: 0.7, streamline: 0.5, blur: 0.12 },
};

/** Fills the perfect-freehand outline of a brush/eraser stroke (in the ctx's current transform). */
export function strokePath(ctx: Ctx2D, s: Brush | Eraser, preset = BRUSH_PRESETS[s.tool === "brush" ? s.preset : "marker"] ?? BRUSH_PRESETS.ink) {
  const outline = getStroke(s.points, { size: s.size, thinning: preset.thinning, smoothing: preset.smoothing, streamline: preset.streamline, simulatePressure: false, last: true });
  ctx.beginPath();
  if (!outline.length) return;
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1], [x1, y1] = outline[i];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
}

/** Draws one brush or eraser stroke. `pxPerUnit` converts logical units to device pixels for blur. */
export function drawStroke(ctx: Ctx2D, s: Brush | Eraser, pxPerUnit: number) {
  ctx.save();
  if (s.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
  } else {
    const preset = BRUSH_PRESETS[s.preset] ?? BRUSH_PRESETS.ink;
    ctx.fillStyle = s.color;
    if (preset.blur) ctx.filter = `blur(${preset.blur * s.size * pxPerUnit}px)`;
  }
  strokePath(ctx, s);
  ctx.fill();
  ctx.restore();
}

type FillResult = { surface: Surface; x: number; y: number } | null;
const fillCache = new WeakMap<Frame, FillResult[]>();

/**
 * Flood-fill results for every fill stroke in a frame, computed at the scene's logical resolution
 * (so preview and export get the same region) and cached per frame object.
 */
function fillsFor(frame: Frame, W: number, H: number, make: CanvasFactory): FillResult[] {
  const res = fillCache.get(frame);
  if (res) return res;
  const fills: FillResult[] = [];
  if (frame.strokes.some((s) => s.tool === "fill")) {
    const g = ctxOf(make(W, H));
    // the canvas pixels, read once and kept current by the fills; a brush or eraser stroke makes them stale
    let px: Uint8ClampedArray | null = null;
    const mask = new Uint8Array(W * H);
    frame.strokes.forEach((s, i) => {
      if (s.tool === "fill") {
        px ??= g.getImageData(0, 0, W, H).data;
        const r = floodFill(px, mask, s, W, H, make);
        fills[i] = r;
        if (r) g.drawImage(r.surface as CanvasImageSource, r.x, r.y);
        if (r && s.color.length === 9) px = null; // a see-through fill blends: read the result back
      } else {
        drawStroke(g, s, 1);
        px = null;
      }
    });
  }
  fillCache.set(frame, fills);
  return fills;
}

/** Floods from `f.at` over `src` (scene pixels), writes the fill into `src`, returns it as a surface. `mask` is scratch, left clear. */
function floodFill(src: Uint8ClampedArray, mask: Uint8Array, f: Fill, W: number, H: number, make: CanvasFactory): FillResult {
  const sx = Math.floor(f.at[0]), sy = Math.floor(f.at[1]);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  const i0 = (sy * W + sx) * 4;
  const seed = [src[i0], src[i0 + 1], src[i0 + 2], src[i0 + 3]];
  const TOL = 48;
  const same = (p: number) => {
    const i = p * 4;
    // transparent pixels match each other regardless of their (meaningless) color; a faint anti-aliased edge counts as
    // transparent too, the same threshold both ways, so a click there fills the space and not every similar color
    if (seed[3] < 8 + TOL) return src[i + 3] < 8 + TOL;
    return Math.abs(src[i] - seed[0]) <= TOL && Math.abs(src[i + 1] - seed[1]) <= TOL && Math.abs(src[i + 2] - seed[2]) <= TOL && Math.abs(src[i + 3] - seed[3]) <= TOL;
  };
  const stack = [sy * W + sx];
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  while (stack.length) {
    const p = stack.pop()!;
    if (mask[p] || !same(p)) continue;
    // scanline: walk left/right, push rows above and below
    const y = (p / W) | 0;
    let l = p, r = p;
    while (l % W > 0 && !mask[l - 1] && same(l - 1)) l--;
    while (r % W < W - 1 && !mask[r + 1] && same(r + 1)) r++;
    for (let q = l; q <= r; q++) {
      mask[q] = 1;
      if (y > 0 && !mask[q - W]) stack.push(q - W);
      if (y < H - 1 && !mask[q + W]) stack.push(q + W);
    }
    minX = Math.min(minX, l % W); maxX = Math.max(maxX, r % W);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // grow 1px so the fill tucks under anti-aliased line edges
  const x0 = Math.max(0, minX - 1), y0 = Math.max(0, minY - 1), x1 = Math.min(W - 1, maxX + 1), y1 = Math.min(H - 1, maxY + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = make(w, h);
  const og = ctxOf(out);
  const img = og.createImageData(w, h);
  const n = parseInt(f.color.slice(1, 7), 16);
  const a = f.color.length === 9 ? parseInt(f.color.slice(7, 9), 16) : 255;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const p = y * W + x;
      const hit = mask[p] || (x > 0 && mask[p - 1]) || (x < W - 1 && mask[p + 1]) || (y > 0 && mask[p - W]) || (y < H - 1 && mask[p + W]);
      if (!hit) continue;
      const o = ((y - y0) * w + (x - x0)) * 4;
      img.data[o] = n >> 16; img.data[o + 1] = (n >> 8) & 255; img.data[o + 2] = n & 255; img.data[o + 3] = a;
      if (a === 255) src.set([n >> 16, (n >> 8) & 255, n & 255, 255], p * 4);
    }
  for (let y = minY; y <= maxY; y++) mask.fill(0, y * W + minX, y * W + maxX + 1);
  og.putImageData(img, 0, 0);
  return { surface: out, x: x0, y: y0 };
}

/** The drawing frame shown at time t (held until the next frame starts), or -1. */
export function frameIndexAt(frames: readonly Frame[], t: number): number {
  let idx = -1;
  for (let i = 0; i < frames.length; i++) if (frames[i].start <= t + 1e-6) idx = i;
  return idx;
}

/** Draws a frame's strokes in order into `g` (already transformed to layer space). */
export function drawFrame(g: Ctx2D, frame: Frame, spec: SceneSpec, make: CanvasFactory, pxPerUnit: number) {
  const fills = fillsFor(frame, spec.meta.width, spec.meta.height, make);
  frame.strokes.forEach((s, i) => {
    if (s.tool !== "fill") return drawStroke(g, s, pxPerUnit);
    const r = fills[i];
    if (r) g.drawImage(r.surface as CanvasImageSource, r.x, r.y);
  });
}

const bboxCache = new WeakMap<object, [number, number, number, number] | null>();
/** What a drawing layer covers in its own coordinates, over every frame (stroke points and fill seeds); null if empty. */
export function drawingBox(layer: Layer): [number, number, number, number] | null {
  if (!layer.frames?.length) return null;
  if (bboxCache.has(layer.frames)) return bboxCache.get(layer.frames)!;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of layer.frames)
    for (const s of f.strokes) {
      const pts = s.tool === "fill" ? [s.at] : s.points;
      for (const [x, y] of pts) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  const b: [number, number, number, number] | null = Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
  bboxCache.set(layer.frames, b);
  return b;
}

/** Pivot for rotate/scale: center of everything ever drawn on the layer (stable across frames). */
export function drawingPivot(layer: Layer): [number, number] | null {
  if (!layer.frames?.length) return null;
  const b = drawingBox(layer);
  return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
}
