// Pure, immutable scene edits. Unchanged frames keep their identity, so the engine's per-frame caches stay valid.
import type { DrawingFrame, Layer, SceneSpec, Stroke } from "@anim/spec";

type Pt = [number, number];
type Transform = NonNullable<Layer["transform"]>;
export type TransformKey = keyof Transform;

export const frameNo = (spec: SceneSpec, seconds: number) => Math.round(seconds * spec.meta.fps);
export const frameTime = (spec: SceneSpec, frame: number) => +(frame / spec.meta.fps).toFixed(6);

export function mapLayer(spec: SceneSpec, id: string, fn: (l: Layer) => Layer): SceneSpec {
  return { ...spec, layers: spec.layers.map((l) => (l.id === id ? fn(l) : l)) };
}
export const findLayer = (spec: SceneSpec, id: string | null) => spec.layers.find((l) => l.id === id) ?? null;
const framesOf = (l: Layer) => l.frames ?? [];

/** Index of the drawing frame that starts exactly on `frame`, or -1. */
export function keyIndexAt(spec: SceneSpec, l: Layer, frame: number) {
  return framesOf(l).findIndex((f) => frameNo(spec, f.start) === frame);
}
/** Index of the frame visible on `frame` (held exposure), or -1. */
export function heldIndexAt(spec: SceneSpec, l: Layer, frame: number) {
  let idx = -1;
  framesOf(l).forEach((f, i) => frameNo(spec, f.start) <= frame && (idx = i));
  return idx;
}

function insertFrame(l: Layer, f: DrawingFrame): Layer {
  const frames = [...framesOf(l), f].sort((a, b) => a.start - b.start);
  return { ...l, frames };
}

export function uniqueId(spec: SceneSpec, base: string) {
  const taken = new Set(spec.layers.map((l) => l.id));
  for (let n = 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function newDrawingLayer(spec: SceneSpec, aboveId: string | null): { spec: SceneSpec; id: string } {
  const id = uniqueId(spec, "drawing");
  const layer: Layer = { id, type: "drawing", params: {}, frames: [] };
  const i = spec.layers.findIndex((l) => l.id === aboveId);
  const layers = [...spec.layers];
  layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
  return { spec: { ...spec, layers }, id };
}

/** Removes a layer; its rig children move up to its parent and actions on it go, so the scene stays valid. */
export function deleteLayer(spec: SceneSpec, id: string): SceneSpec {
  const up = findLayer(spec, id)?.parent;
  const layers = spec.layers.filter((l) => l.id !== id).map((l) => (l.parent === id ? { ...l, parent: up } : l));
  return { ...spec, layers, ...(spec.actions && { actions: spec.actions.filter((a) => a.part !== id && a.target !== id) }) };
}

/**
 * Adds a stroke at `frame`. With autoFrame, drawing where no frame starts creates a new blank frame (flipbook style);
 * without it, the held frame is edited (or a frame is created if nothing is exposed yet).
 */
export function addStroke(spec: SceneSpec, id: string, frame: number, stroke: Stroke, autoFrame: boolean): SceneSpec {
  return mapLayer(spec, id, (l) => {
    const key = keyIndexAt(spec, l, frame);
    const held = heldIndexAt(spec, l, frame);
    const target = key >= 0 ? key : autoFrame ? -1 : held;
    if (target < 0) return insertFrame(l, { start: frameTime(spec, frame), strokes: [stroke] });
    const frames = [...framesOf(l)];
    frames[target] = { ...frames[target], strokes: [...frames[target].strokes, stroke] };
    return { ...l, frames };
  });
}

export function insertBlankFrame(spec: SceneSpec, id: string, frame: number): SceneSpec | null {
  const l = findLayer(spec, id);
  if (!l || keyIndexAt(spec, l, frame) >= 0) return null;
  return mapLayer(spec, id, (l) => insertFrame(l, { start: frameTime(spec, frame), strokes: [] }));
}

export function duplicateFrame(spec: SceneSpec, id: string, frame: number): SceneSpec | null {
  const l = findLayer(spec, id);
  const held = l ? heldIndexAt(spec, l, frame) : -1;
  if (!l || held < 0) return null;
  // on a key: copy it to the next frame; on a held exposure: make it a key here
  const at = keyIndexAt(spec, l, frame) >= 0 ? frame + 1 : frame;
  if (keyIndexAt(spec, l, at) >= 0 || frameTime(spec, at) > spec.meta.duration) return null;
  return mapLayer(spec, id, (l) => insertFrame(l, { start: frameTime(spec, at), strokes: framesOf(l)[held].strokes }));
}

export function deleteFrame(spec: SceneSpec, id: string, frame: number): SceneSpec | null {
  const l = findLayer(spec, id);
  const key = l ? keyIndexAt(spec, l, frame) : -1;
  if (!l || key < 0) return null;
  return mapLayer(spec, id, (l) => ({ ...l, frames: framesOf(l).filter((_, i) => i !== key) }));
}

/** Retimes a drawing frame; refuses to land on another frame. */
export function moveFrame(spec: SceneSpec, id: string, from: number, to: number): SceneSpec | null {
  const l = findLayer(spec, id);
  const key = l ? keyIndexAt(spec, l, from) : -1;
  if (!l || key < 0 || from === to || to < 0 || keyIndexAt(spec, l, to) >= 0 || frameTime(spec, to) >= spec.meta.duration) return null;
  return mapLayer(spec, id, (l) => {
    const frames = framesOf(l).map((f, i) => (i === key ? { ...f, start: frameTime(spec, to) } : f));
    return { ...l, frames: frames.sort((a, b) => a.start - b.start) };
  });
}

export function setStrokes(spec: SceneSpec, id: string, frameIndex: number, strokes: Stroke[]): SceneSpec {
  return mapLayer(spec, id, (l) => ({ ...l, frames: framesOf(l).map((f, i) => (i === frameIndex ? { ...f, strokes } : f)) }));
}

export const setParam = (spec: SceneSpec, id: string, key: string, value: unknown): SceneSpec => mapLayer(spec, id, (l) => ({ ...l, params: { ...l.params, [key]: value } }));

const DEFAULTS: Transform = { x: 0, y: 0, rotation: 0, scale: 1 };
const trackName = (id: string, k: TransformKey) => `${id.replace(/[^\w-]/g, "_").replace(/^([^A-Za-z_])/, "_$1")}-${k}`;

/**
 * Sets transform values at `frame`. Animated values (already "@track") always get a key; static values become
 * keyed tracks when autoKey is on, otherwise they are set directly.
 */
export function setTransform(spec: SceneSpec, id: string, values: Partial<Record<TransformKey, number>>, frame: number, autoKey: boolean): SceneSpec {
  const l = findLayer(spec, id);
  if (!l) return spec;
  const tracks = { ...spec.tracks };
  const transform: Transform = { ...DEFAULTS, ...l.transform };
  const t = frameTime(spec, frame);
  for (const [k, v] of Object.entries(values) as [TransformKey, number][]) {
    const cur = transform[k];
    if (typeof cur === "string" || autoKey) {
      const name = typeof cur === "string" ? cur.slice(1) : trackName(id, k);
      const tr = tracks[name] ?? { keys: [], ease: "inOut" as const };
      const keys = tr.keys.filter(([kt]) => Math.abs(kt - t) > 1e-6);
      keys.push([t, v]);
      tracks[name] = { ...tr, keys: keys.sort((a, b) => a[0] - b[0]) };
      transform[k] = `@${name}`;
    } else transform[k] = v;
  }
  return { ...spec, tracks, layers: spec.layers.map((x) => (x.id === id ? { ...x, transform } : x)) };
}

// --- geometry for select / transform ---

export function strokePoints(s: Stroke): Pt[] {
  return s.tool === "fill" ? [s.at] : s.points.map(([x, y]) => [x, y] as Pt);
}

export function pointInPolygon([x, y]: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(points: Pt[]): [number, number, number, number] | null {
  if (!points.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Moves, scales (about c) and rotates (about c) a stroke in layer space. */
export function transformStroke(s: Stroke, dx: number, dy: number, k: number, rot: number, c: Pt): Stroke {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const f = (x: number, y: number): Pt => {
    const ux = (x - c[0]) * k, uy = (y - c[1]) * k;
    return [c[0] + ux * cos - uy * sin + dx, c[1] + ux * sin + uy * cos + dy];
  };
  if (s.tool === "fill") return { ...s, at: f(...s.at) };
  return { ...s, size: s.size * k, points: s.points.map(([x, y, p]) => [...f(x, y), p] as [number, number, number]) };
}

export function moveLayer(spec: SceneSpec, id: string, to: number): SceneSpec | null {
  const i = spec.layers.findIndex((l) => l.id === id);
  if (i < 0 || to < 0 || to >= spec.layers.length || to === i) return null;
  const layers = [...spec.layers];
  layers.splice(to, 0, ...layers.splice(i, 1));
  return { ...spec, layers };
}

/** Renames a layer and every reference to it (rig parents, actions). */
export function renameLayer(spec: SceneSpec, from: string, to: string): SceneSpec {
  const layers = spec.layers.map((l) => (l.id === from || l.parent === from ? { ...l, ...(l.id === from && { id: to }), ...(l.parent === from && { parent: to }) } : l));
  const swap = <T extends string | undefined>(id: T) => (id === from ? to : id) as T;
  return { ...spec, layers, ...(spec.actions && { actions: spec.actions.map((a) => ({ ...a, part: swap(a.part), target: swap(a.target) })) }) };
}
export const setFps = (spec: SceneSpec, fps: 12 | 24 | 30): SceneSpec => ({ ...spec, meta: { ...spec.meta, fps } });

/**
 * Changes the scene length. Lengthening keeps everything; shortening drops drawing frames, track keys and beats
 * past the new end (a track keeps its value at the cut so the last moment looks the same).
 */
export function setDuration(spec: SceneSpec, seconds: number): SceneSpec {
  const d = Math.min(60, Math.max(1, +seconds.toFixed(3)));
  if (d >= spec.meta.duration) return { ...spec, meta: { ...spec.meta, duration: d } };
  const tracks = Object.fromEntries(
    Object.entries(spec.tracks).map(([name, tr]) => {
      if (tr.keys.every(([t]) => t <= d)) return [name, tr];
      const inside = tr.keys.filter(([t]) => t <= d);
      const next = tr.keys.find(([t]) => t > d)!;
      const prev = inside[inside.length - 1];
      // shortcut: the value at the cut is linearly interpolated, ignoring the track's easing
      const v = prev ? prev[1] + ((next[1] - prev[1]) * (d - prev[0])) / (next[0] - prev[0] || 1) : next[1];
      return [name, { ...tr, keys: [...inside, [d, v] as [number, number]] }];
    }),
  );
  return {
    ...spec,
    meta: { ...spec.meta, duration: d },
    tracks,
    beats: spec.beats.filter((b) => b.at <= d),
    layers: spec.layers.map((l) => (l.frames?.some((f) => f.start >= d) ? { ...l, frames: l.frames.filter((f) => f.start < d) } : l)),
  };
}
