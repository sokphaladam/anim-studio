import { type Action, type Layer, type SceneSpec, type Track } from "@anim/spec";
import { layerPivot, objectBounds, type Box } from "./bounds";
import { drawingBox } from "./drawing";
import { defaultFactory, layerMatrix } from "./index";
import { apply, invert, type Mat } from "./matrix";
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
  // a bone draws nothing: it covers the line from its joint to its end
  if (l.type === "bone" && l.pivot) {
    const [x0, y0] = l.pivot, [x1, y1] = tipOf(l);
    return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
  }
  if (l.type === "image" && [p.x ?? 0, p.y ?? 0, p.w, p.h].every((v) => typeof v === "number")) {
    const x = (p.x as number | undefined) ?? 0, y = (p.y as number | undefined) ?? 0;
    return [x, y, x + (p.w as number), y + (p.h as number)];
  }
  if (l.type === "drawing") return drawingBox(l);
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
/** Seconds per step of a walk, and how high each step lifts the walker (scene px, times the action's amount). */
const STEP = 0.32, LIFT = 3;
/** A jump covers ground faster than walking: its length counts this much toward the path's timing. */
const JUMP_PACE = 0.5;

function pathKeys(a: Action, duration: number): { x: Keys; y: Keys; flip: Keys } {
  const pts = a.points!;
  const route = [...pts, ...pts.slice(0, -1).reverse()];
  // a leg that climbs or drops more than it goes sideways (onto a sill, down to the floor) is a jump: one quick arc
  const jumps = route.slice(1).map((p, i) => Math.abs(p[1] - route[i][1]) > Math.max(20, Math.abs(p[0] - route[i][0])));
  const lens = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]) * (jumps[i] ? JUMP_PACE : 1));
  const total = lens.reduce((s, l) => s + l, 0) || 1;
  const start = a.start, whole = (a.end ?? duration) - start;
  // the pause at the far point comes out of the travel time (at most most of it, so it still moves)
  const rest = Math.min(a.rest ?? 0, whole * 0.8), span = whole - rest;
  let at = start;
  const x: Keys = [], y: Keys = [], flip: Keys = [];
  route.forEach((p, i) => {
    if (i) {
      const t0 = at, t1 = at + (lens[i - 1] / total) * span, q = route[i - 1];
      if (jumps[i - 1]) {
        // up and over the edge, then down onto it: the arc peaks above the higher end
        const hop = (Math.abs(p[1] - q[1]) * 0.5 + 20) * a.amount;
        for (const u of [0.25, 0.5, 0.75]) {
          const t = +(t0 + u * (t1 - t0)).toFixed(4);
          x.push([t, +(q[0] + (p[0] - q[0]) * u - pts[0][0]).toFixed(2)]);
          y.push([t, +(q[1] + (p[1] - q[1]) * u - pts[0][1] - hop * 4 * u * (1 - u)).toFixed(2)]);
        }
      } else {
        // a walk, not a glide: an even pace with a short ease at each end, and a small lift on every step
        const steps = Math.max(1, Math.round((t1 - t0) / STEP));
        for (let s = 1; s < steps * 2; s++) {
          const u = s / (steps * 2), e = Math.min(1, u / 0.12, (1 - u) / 0.12);
          const pace = u < 0.12 ? (u * u) / 0.24 : u > 0.88 ? 1 - ((1 - u) * (1 - u)) / 0.24 : (u - 0.06) / 0.88;
          const t = +(t0 + u * (t1 - t0)).toFixed(4);
          x.push([t, +(q[0] + (p[0] - q[0]) * pace - pts[0][0]).toFixed(2)]);
          y.push([t, +(q[1] + (p[1] - q[1]) * pace - pts[0][1] - (s % 2 ? LIFT * a.amount * e : 0)).toFixed(2)]);
        }
      }
      at = t1;
    }
    const t = +at.toFixed(4);
    x.push([t, p[0] - pts[0][0]]);
    y.push([t, p[1] - pts[0][1]]);
    // facing for the segment that starts here (a step track holds it until the next point): mirrored going left,
    // unchanged going straight up or down, as painted once back at rest
    const next = route[i + 1];
    const prev = flip.length ? flip[flip.length - 1][1] : 0;
    const face = !next ? 0 : next[0] < p[0] ? 1 : next[0] > p[0] ? 0 : prev;
    if (i === pts.length - 1 && rest > 0) {
      // stays at the far point, still facing the way it came, then turns for the way back
      at += rest;
      const t2 = +at.toFixed(4);
      x.push([t2, p[0] - pts[0][0]]);
      y.push([t2, p[1] - pts[0][1]]);
      flip.push([t, prev], [t2, face]);
    } else flip.push([t, face]);
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
    return { keys: shiftLoop(keys(P), P, a.phase ?? 0, ease), ease, loop: true };
  };
  switch (a.type) {
    case "look_at":
      return { rotation: { keys: lookAtKeys(spec, a, make), ease: a.ease } };
    case "path": {
      const { x, y, flip } = pathKeys(a, D);
      // the keys already carry the pace: x runs straight between them (easing again would stop at every key); y eases,
      // so each step lifts and lands in an arc
      return { x: { keys: x, ease: "linear" }, y: { keys: y, ease: "inOut" }, ...(flip.some(([, v]) => v) && { flip: { keys: flip, ease: "step" } }) };
    }
    case "breathe":
      return { scale: loop(a.period ?? 4, (p) => [[0, 0], [p / 2, 0.012 * k], [p, 0]]) };
    case "bob":
      return { rotation: loop(a.period ?? 1.2, (p) => [[0, 0], [p / 2, 0.04 * k], [p, 0]]) };
    case "sway":
      return { rotation: loop(a.period ?? 5, (p) => [[0, 0], [p / 4, 0.03 * k], [(3 * p) / 4, -0.03 * k], [p, 0]]) };
    case "drift":
      return { x: loop(a.period ?? D, (p) => [[0, 0], [p / 2, 40 * k], [p, 0]]) };
    case "spin":
      // a whole turn per cycle, at an even speed: tape reels, a record, a fan (amount = turns per cycle; negative turns back)
      return { rotation: loop(a.period ?? 3, (p) => [[0, 0], [p, 2 * Math.PI * k]], "linear") };
    case "glow":
      // dims and comes back slowly: a radio dial, a screen, a lamp breathing light
      return { opacity: loop(a.period ?? 3, (p) => [[0, 0], [p / 2, -0.35 * k], [p, 0]]) };
    case "flicker":
      // quick uneven dips: a candle flame, a fire, a faulty bulb
      return { opacity: loop(a.period ?? 1.3, (p) => [[0, 0], [0.15 * p, -0.25 * k], [0.3 * p, -0.05 * k], [0.5 * p, -0.3 * k], [0.7 * p, 0], [0.85 * p, -0.15 * k], [p, 0]], "linear") };
    case "blink":
      // eyes shut for a fifth of a second (a slow blink for amount > 1), once per cycle
      return { opacity: loop(a.period ?? 4, (p) => { const c = Math.min(p / 3, 0.2 * k); return [[0, 0], [p - c - 0.08, 0], [p - c, 1], [p - 0.08, 1], [p, 0]]; }, "linear") };
    // evaluated live every frame (see actionOffsets and the IK solver), so they compile to nothing
    case "follow":
    case "attach":
    case "contact":
      return {};
    // keys made by a clip: kept as they are
    case "motion":
      return Object.fromEntries(Object.entries(a.tracks ?? {}).flatMap(([ch, name]) => (spec.tracks[name] ? [[ch, spec.tracks[name]]] : [])));
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

/** One loop cycle of keys started `phase` (0-1) of the way in: the same motion, shifted, still closing at both ends. */
function shiftLoop(keys: Keys, P: number, phase: number, ease: Track["ease"]): Keys {
  if (!phase || P <= 0) return keys;
  const tr: Track = { keys, ease, loop: true };
  const off = phase * P;
  const inside = keys.map(([k]) => (((k - off) % P) + P) % P).filter((k) => k > 1e-9 && k < P - 1e-9);
  return [0, ...[...new Set(inside)].sort((x, y) => x - y), P].map((k) => [+k.toFixed(6), evalTrack(tr, k + off)] as [number, number]);
}

/** What a layer's actions add to each channel at time t (each scaled by its weight); null when no action moves it. */
export function actionOffsets(spec: SceneSpec, layerId: string, t: number, make: CanvasFactory = defaultFactory): Record<Channel, number> | null {
  let o: Record<Channel, number> | null = null;
  for (const a of spec.actions ?? []) {
    if (a.part !== layerId) continue;
    const w = a.weight === undefined ? 1 : (resolve(a.weight, spec, t) as number);
    if (a.type === "follow" || a.type === "attach") {
      o ??= { x: 0, y: 0, rotation: 0, scale: 0, opacity: 0, flip: 0 };
      if (a.type === "follow") o.rotation += w * followTurn(spec, a, t, make);
      else {
        const [dx, dy] = carried(spec, a, t, make);
        o.x += w * dx;
        o.y += w * dy;
      }
      continue;
    }
    for (const [ch, name] of Object.entries(a.tracks ?? {}) as [Channel, string][]) {
      const tr = spec.tracks[name];
      o ??= { x: 0, y: 0, rotation: 0, scale: 0, opacity: 0, flip: 0 };
      // a mirror is on or off: it isn't blended
      if (tr) o[ch] += ch === "flip" ? evalTrack(tr, t) : w * evalTrack(tr, t);
    }
  }
  return o;
}

/** Largest secondary swing (radians) at amount 1. */
const MAX_FOLLOW = 0.6;
const FOLLOW_SAMPLES = 24;
const angleOf = (m: Mat) => Math.atan2(m[1], m[0]);
type Pt = [number, number];
/** Where a bone ends, in its own coordinates. */
const tipOf = (l: Layer): Pt => {
  const [x, y] = l.pivot ?? [0, 0];
  const len = l.params.length as number, ang = (l.params.angle as number | undefined) ?? 0;
  return [x + len * Math.cos(ang), y + len * Math.sin(ang)];
};

/**
 * Secondary motion: how far a part trails behind what drives it at time t, and swings past when that stops. The driver is
 * the nearest ancestor that doesn't itself follow; parts further down a chain (a tail's tip) lag more. The response is a
 * damped oscillation of the driver's recent turning and travel, sampled at fixed times back from t (no state carried
 * between frames), with time wrapped around the scene's length: the video loops, so the motion joins at the seam.
 */
function followTurn(spec: SceneSpec, a: Action, t: number, make: CanvasFactory): number {
  const byId = (id: string | undefined) => (id === undefined ? undefined : spec.layers.find((l) => l.id === id));
  const part = byId(a.part);
  let driver = byId(part?.parent), depth = 0;
  while (driver && spec.actions?.some((x) => x.type === "follow" && x.part === driver!.id) && depth < spec.layers.length) {
    driver = byId(driver.parent);
    depth++;
  }
  if (!part || !driver) return 0;
  const D = spec.meta.duration;
  const P = a.period ?? 1.2, decay = P / 2, lag = 1 + 0.5 * depth;
  const step = (2 * P * lag) / FOLLOW_SAMPLES;
  // the part's joint and which way it points, in its own coordinates
  const [px, py] = layerPivot(spec, part, make);
  const b = part.type === "bone" ? null : boxOf(spec, part, 0, make);
  const tip: Pt = part.type === "bone" ? tipOf(part) : b ? center(b) : [px, py + 1];
  const L = Math.hypot(tip[0] - px, tip[1] - py) || 1;
  const sample = (time: number) => {
    const m = layerMatrix(spec, driver!, ((time % D) + D) % D, make);
    return { turn: angleOf(m), joint: apply(m, px, py), tip: apply(m, ...tip) };
  };
  const now = sample(t);
  const dir: Pt = [(now.tip[0] - now.joint[0]) / L, (now.tip[1] - now.joint[1]) / L];
  let sum = 0, norm = 0;
  for (let k = 1; k <= FOLLOW_SAMPLES; k++) {
    const back = k * step;
    const fade = Math.exp(-back / (decay * lag));
    const then = sample(t - back);
    // turning: lag behind the driver's rotation; travel: the tip stays toward where the joint was
    const turn = Math.atan2(Math.sin(then.turn - now.turn), Math.cos(then.turn - now.turn));
    const dx = then.joint[0] - now.joint[0], dy = then.joint[1] - now.joint[1];
    const travel = (-dir[1] * dx + dir[0] * dy) / L;
    sum += fade * Math.cos((2 * Math.PI * back) / (P * lag)) * (turn + travel);
    norm += fade;
  }
  const max = MAX_FOLLOW * a.amount;
  return Math.max(-max, Math.min(max, (a.amount * sum) / (norm || 1)));
}

/** Where an attach's target point is in the scene at t: a bone's end, else the target's pivot. */
function anchor(spec: SceneSpec, target: Layer, t: number, make: CanvasFactory): Pt {
  const p: Pt = target.type === "bone" && target.pivot ? tipOf(target) : layerPivot(spec, target, make);
  return apply(layerMatrix(spec, target, t, make), ...p);
}

/**
 * How far an attach has carried its part at t, in the part's parent space: the target point's travel since the attach
 * began (nothing before it; held where it was let go after it). Relative, so the part never jumps onto its target.
 */
function carried(spec: SceneSpec, a: Action, t: number, make: CanvasFactory): Pt {
  const part = spec.layers.find((l) => l.id === a.part), target = spec.layers.find((l) => l.id === a.target);
  if (!part || !target || t <= a.start) return [0, 0];
  const at = Math.min(t, a.end ?? spec.meta.duration);
  const [x0, y0] = anchor(spec, target, a.start, make), [x1, y1] = anchor(spec, target, at, make);
  const parent = part.parent === undefined ? null : (spec.layers.find((l) => l.id === part.parent) ?? null);
  const inv = invert(layerMatrix(spec, parent, t, make));
  return [inv[0] * (x1 - x0) + inv[2] * (y1 - y0), inv[1] * (x1 - x0) + inv[3] * (y1 - y0)];
}

/** Seconds a contact takes to take hold and to let go, around its start and end. */
const CONTACT_EASE = 0.15;

/** How firmly contacts hold an IK target at t (0-1): 1 from start to end, easing in and out around them. */
export function contactLevel(spec: SceneSpec, target: string, t: number): number {
  let level = 0;
  for (const a of spec.actions ?? []) {
    if (a.type !== "contact" || a.part !== target) continue;
    const end = a.end ?? spec.meta.duration;
    const k = t < a.start ? 1 - (a.start - t) / CONTACT_EASE : t > end ? 1 - (t - end) / CONTACT_EASE : 1;
    const w = a.weight === undefined ? 1 : (resolve(a.weight, spec, t) as number);
    level = Math.max(level, Math.max(0, Math.min(1, k)) * w);
  }
  return level;
}


