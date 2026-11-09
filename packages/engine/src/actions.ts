import { type Action, type Layer, type SceneSpec, type Track } from "@anim/spec";
import { layerPivot, objectBounds, type Box } from "./bounds";
import { defaultFactory, layerMatrix } from "./index";
import { apply, invert } from "./matrix";
import { resolve } from "./resolve";
import { evalTrack } from "./tracks";
import type { CanvasFactory } from "./drawing";

/** Largest head turn a look_at makes (radians, ≈20°): a flat cut-out part looks broken past that. */
export const MAX_TURN = 0.35;
/** Largest reach a swing makes (radians, ≈35°): an arm lifting a cup. */
const MAX_SWING = 0.6;
type Channel = keyof NonNullable<Action["tracks"]>;
type Keys = [number, number][];

/** What a layer covers in its own coordinates: image params directly, anything else by rendering it. */
function boxOf(spec: SceneSpec, l: Layer, t: number, make: CanvasFactory): Box | null {
  const p = l.params;
  if (l.type === "image" && [p.x ?? 0, p.y ?? 0, p.w, p.h].every((v) => typeof v === "number")) {
    const x = (p.x as number | undefined) ?? 0, y = (p.y as number | undefined) ?? 0;
    return [x, y, x + (p.w as number), y + (p.h as number)];
  }
  if (l.type === "group") {
    // a group draws nothing itself: it covers its parts
    const boxes = spec.layers.filter((x) => x.parent === l.id).map((x) => boxOf(spec, x, t, make)).filter((b) => !!b);
    return boxes.length ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))] : null;
  }
  return objectBounds(spec, l, t, make);
}

const center = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/**
 * The signed turn (radians) that points the part from its pivot toward the target, at time t, clamped to ±max.
 * Throws when the part or target can't be resolved: a direction is never invented.
 */
function turnToward(spec: SceneSpec, a: Action, t: number, max: number, make: CanvasFactory): number {
  const { pb, tx, ty, px, py, tr } = aim(spec, a, t, make);
  const [hx, hy] = center(pb);
  // the part points from its pivot through its middle; a pivot near the middle says nothing, so it points up (a head)
  const near = Math.hypot(hx - px, hy - py) < Math.max(pb[2] - pb[0], pb[3] - pb[1]) * 0.15;
  const from = (near ? -Math.PI / 2 : Math.atan2(hy - py, hx - px)) + tr.rotation;
  const to = Math.atan2(ty - (py + tr.y), tx - (px + tr.x));
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return Math.max(-max, Math.min(max, delta));
}

/** How far (radians) a look_at would have to turn its part to face its target, before the safe-turn clamp. */
export const requiredTurn = (spec: SceneSpec, a: Action, make: CanvasFactory = defaultFactory) => turnToward(spec, a, a.start, Infinity, make);

/** Largest gaze shift, as a share of the iris layer's width: irises stay inside the eyes. */
export const MAX_GAZE = 0.08;

/** The x/y offset a gaze slides its irises by: toward the target, MAX_GAZE × width × amount at most. */
function gazeShift(spec: SceneSpec, a: Action, make: CanvasFactory): [number, number] {
  const { pb, tx, ty, tr } = aim(spec, a, a.start, make);
  const [hx, hy] = center(pb);
  const dx = tx - (hx + tr.x), dy = ty - (hy + tr.y), n = Math.hypot(dx, dy) || 1;
  const reach = MAX_GAZE * (pb[2] - pb[0]) * Math.min(1, a.amount);
  return [(dx / n) * reach, (dy / n) * reach];
}

/** The part's box, its pivot and transform, and the target's center in the part's parent space, at time t. */
function aim(spec: SceneSpec, a: Action, t: number, make: CanvasFactory) {
  const part = spec.layers.find((l) => l.id === a.part);
  const target = spec.layers.find((l) => l.id === a.target);
  if (!part || !target) throw new Error(`${a.type} "${a.id}": unknown ${part ? "target" : "part"} layer "${part ? a.target : a.part}"`);
  const pb = boxOf(spec, part, t, make), tb = boxOf(spec, target, t, make);
  if (!pb || !tb) throw new Error(`${a.type} "${a.id}": "${pb ? a.target : a.part}" draws nothing at ${t}s, so there is nothing to aim at`);
  // work in the part's parent space
  const parent = part.parent === undefined ? null : (spec.layers.find((l) => l.id === part.parent) ?? null);
  const [tx, ty] = apply(invert(layerMatrix(spec, parent, t, make)), ...apply(layerMatrix(spec, target, t, make), ...center(tb)));
  const tr = resolve({ x: 0, y: 0, rotation: 0, ...part.transform }, spec, t);
  const [px, py] = layerPivot(spec, part, make);
  return { pb, tx, ty, px, py, tr };
}

/** A loop's period, rounded so a whole number of cycles fits the scene and the video loops seamlessly. */
export const fitPeriod = (period: number, duration: number) => duration / Math.max(1, Math.round(duration / period));

/** The rotation offsets of a look_at: rest until start, turned by end, held (or until hold, then back). */
export function lookAtKeys(spec: SceneSpec, a: Action, make: CanvasFactory = defaultFactory): Keys {
  return holdKeys(spec, a, turnToward(spec, a, a.start, MAX_TURN * a.amount, make));
}

/** Rest until start, `turned` by end, held (or until hold, then back): the shape of look_at and gaze. */
function holdKeys(spec: SceneSpec, a: Action, turned: number): Keys {
  const end = a.end ?? spec.meta.duration;
  const keys: Keys = [[0, 0], [a.start, 0], [end, turned]];
  if (a.hold !== undefined && a.hold < spec.meta.duration) keys.push([a.hold, turned], [Math.min(spec.meta.duration, a.hold + (end - a.start)), 0]);
  return a.start > 0 ? keys : keys.slice(1);
}

/**
 * The x/y offsets of a path: out through the points and back to rest, timed by distance, within start..end. A walker
 * is painted facing right, so `flip` mirrors it while it moves left.
 */
function pathKeys(a: Action, duration: number): { x: Keys; y: Keys; flip: Keys } {
  const pts = a.points!;
  const route = [...pts, ...pts.slice(0, -1).reverse()];
  const lens = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
  const total = lens.reduce((s, l) => s + l, 0) || 1;
  const start = a.start, span = (a.end ?? duration) - start;
  let at = start;
  const x: Keys = [], y: Keys = [], flip: Keys = [];
  route.forEach((p, i) => {
    if (i) at += (lens[i - 1] / total) * span;
    const t = +at.toFixed(4);
    x.push([t, p[0] - pts[0][0]]);
    y.push([t, p[1] - pts[0][1]]);
    // facing for the segment that starts here (a step track holds it until the next point): mirrored going left,
    // unchanged going straight up or down, as painted once back at rest
    const next = route[i + 1];
    const prev = flip.length ? flip[flip.length - 1][1] : 0;
    flip.push([t, !next ? 0 : next[0] < p[0] ? 1 : next[0] > p[0] ? 0 : prev]);
  });
  if (start > 0) {
    x.unshift([0, 0]);
    y.unshift([0, 0]);
    flip.unshift([0, 0]);
  }
  return { x, y, flip };
}

/** The tracks an action becomes, per channel. Loops are one cycle with `loop: true`. */
export function actionTracks(spec: SceneSpec, a: Action, make: CanvasFactory = defaultFactory): Partial<Record<Channel, Track>> {
  const D = spec.meta.duration, k = a.amount;
  const loop = (p: number, keys: (p: number) => Keys, ease: Track["ease"] = "inOut"): Track => {
    const P = fitPeriod(p, D);
    return { keys: keys(P), ease, loop: true };
  };
  switch (a.type) {
    case "look_at":
      return { rotation: { keys: lookAtKeys(spec, a, make), ease: a.ease } };
    case "path": {
      const { x, y, flip } = pathKeys(a, D);
      return { x: { keys: x, ease: a.ease }, y: { keys: y, ease: a.ease }, ...(flip.some(([, v]) => v) && { flip: { keys: flip, ease: "step" } }) };
    }
    case "breathe":
      return { scale: loop(a.period ?? 4, (p) => [[0, 0], [p / 2, 0.012 * k], [p, 0]]) };
    case "bob":
      return { rotation: loop(a.period ?? 1.2, (p) => [[0, 0], [p / 2, 0.04 * k], [p, 0]]) };
    case "sway":
      return { rotation: loop(a.period ?? 5, (p) => [[0, 0], [p / 4, 0.03 * k], [(3 * p) / 4, -0.03 * k], [p, 0]]) };
    case "drift":
      return { x: loop(a.period ?? D, (p) => [[0, 0], [p / 2, 40 * k], [p, 0]]) };
    case "blink":
      // eyes shut for a fifth of a second (a slow blink for amount > 1), once per cycle
      return { opacity: loop(a.period ?? 4, (p) => { const c = Math.min(p / 3, 0.2 * k); return [[0, 0], [p - c - 0.08, 0], [p - c, 1], [p - 0.08, 1], [p, 0]]; }, "linear") };
    case "gaze": {
      const [dx, dy] = gazeShift(spec, a, make);
      return { x: { keys: holdKeys(spec, a, dx), ease: a.ease }, y: { keys: holdKeys(spec, a, dy), ease: a.ease } };
    }
    case "swing": {
      const r = turnToward(spec, a, 0, MAX_SWING * Math.min(1, k), make);
      // reach, hold a moment (a sip), come back, rest
      return { rotation: loop(a.period ?? 8, (p) => [[0, 0], [0.45 * p, 0], [0.55 * p, r], [0.75 * p, r], [0.85 * p, 0], [p, 0]]) };
    }
  }
}

/** Compiles every action into its tracks (named `<action id>-<channel>`). Playback then reads only tracks. */
export function compileActions(spec: SceneSpec, make: CanvasFactory = defaultFactory): SceneSpec {
  if (!spec.actions?.length) return spec;
  const out: SceneSpec = { ...spec, tracks: { ...spec.tracks } };
  out.actions = spec.actions.map((a) => {
    const tracks: NonNullable<Action["tracks"]> = {};
    for (const [ch, tr] of Object.entries(actionTracks(out, a, make)) as [Channel, Track][]) {
      const name = `${a.id}-${ch}`;
      out.tracks[name] = tr;
      tracks[ch] = name;
    }
    return { ...a, tracks };
  });
  return out;
}

/** What a layer's actions add to each channel at time t; null when no action moves it. */
export function actionOffsets(spec: SceneSpec, layerId: string, t: number): Record<Channel, number> | null {
  let o: Record<Channel, number> | null = null;
  for (const a of spec.actions ?? [])
    if (a.part === layerId && a.tracks)
      for (const [ch, name] of Object.entries(a.tracks ?? {}) as [Channel, string][]) {
        const tr = spec.tracks[name];
        o ??= { x: 0, y: 0, rotation: 0, scale: 0, opacity: 0, flip: 0 };
        if (tr) o[ch] += evalTrack(tr, t);
      }
  return o;
}


