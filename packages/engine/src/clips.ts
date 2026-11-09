// Motion clips: named, reusable motions applied to a character's rig. A clip expands into ordinary actions and keyed
// tracks, all tagged with the clip's id, so everything it makes stays editable and is removed together. A clip the rig
// can't do says why instead of doing something else.
import type { Action, KeyEase, Layer, SceneSpec, Track } from "@anim/spec";
import { compileActions, contactLevel } from "./actions";
import { layerPivot } from "./bounds";
import type { CanvasFactory } from "./drawing";
import { setSwitchKey } from "./face";
import { defaultFactory, layerMatrix } from "./index";
import { apply, invert } from "./matrix";
import { boneTip } from "./rig";
import { rng } from "./rng";

export const CLIP_NAMES = ["idle", "breathing", "blink", "listening", "look_at", "reach", "sip", "write", "tail_sway", "walk_cycle", "follow_through"] as const;
export type ClipName = (typeof CLIP_NAMES)[number];
export type ClipArgs = { character: string; start: number; end?: number; target?: string; amount?: number; period?: number };
export type ClipResult = { ok: true; spec: SceneSpec; clip: string } | { ok: false; problem: string };

/** What each clip does and needs, for people and for the Motion Director. */
export const CLIP_INFO: Record<ClipName, string> = {
  idle: "breathing, a slow sway and blinking, for the whole scene",
  breathing: "the chest rises and falls, for the whole scene",
  blink: "blinks every few seconds from start to end (needs closed-eye art)",
  listening: "a slow nod and tilt of the head, from start to end",
  look_at: "turns the head (the eyes first) toward target from start, over about 0.6 s, and holds (needs target)",
  reach: "the hand reaches for target with anticipation and overshoot, holds, comes back (needs an arm with IK, and target)",
  sip: "reaches for target (a cup), lifts it to the mouth, holds, puts it back; about 3.5 s (needs an arm with IK, a head, target)",
  write: "the hand stays on the page and makes small writing strokes from start to end (needs an arm with IK)",
  tail_sway: "the tail sways as a wave, for the whole scene (needs tail bones)",
  walk_cycle: "legs and arms swing in a walking rhythm from start to end (needs leg bones)",
  follow_through: "hair, ears and tail (or target: a hanging thing) trail behind and swing when the character moves",
};

type Keys = Track["keys"];
type Spot = [number, [number, number], KeyEase];
type Draft = Partial<Action> & { motion?: { x: Keys; y: Keys } };

const bone = (c: string, n: string) => `${c}_bone_${n}`;
const find = (spec: SceneSpec, id: string | undefined) => (id === undefined ? undefined : spec.layers.find((l) => l.id === id));
const r3 = (v: number) => +v.toFixed(3);
/** Anticipation and overshoot in one move: pulls back a little, then goes a little past. */
const REACH: KeyEase = [0.4, -0.35, 0.25, 1.15];

function clipId(spec: SceneSpec, character: string, name: string) {
  const used = new Set((spec.actions ?? []).map((a) => a.clip));
  let n = 1;
  while (used.has(`${character}_${name}_${n}`) || Object.keys(spec.tracks).some((k) => k.startsWith(`${character}_${name}_${n}-`))) n++;
  return `${character}_${name}_${n}`;
}

/** Adds a clip's actions (ids `<clip>-1`, `<clip>-2`, …) and compiles them; keyed motions bring their own tracks. */
function withActions(spec: SceneSpec, clip: string, list: Draft[], make: CanvasFactory = defaultFactory): SceneSpec {
  const tracks = { ...spec.tracks };
  const actions = list.map(({ motion, ...a }, i) => {
    const id = `${clip}-${i + 1}`;
    if (motion) for (const ch of ["x", "y"] as const) tracks[`${id}-${ch}`] = { keys: motion[ch], ease: "inOut" };
    return { ease: "inOut", amount: 1, start: 0, ...a, id, clip, ...(motion && { type: "motion", tracks: { x: `${id}-x`, y: `${id}-y` } }) } as Action;
  });
  return compileActions({ ...spec, tracks, actions: [...(spec.actions ?? []), ...actions] }, make);
}

/**
 * Loops run the whole scene; a clip that should only loop from start to end gets a weight track that is 1 then and 0
 * otherwise (a step, so it cuts in and out on the beat of the clip).
 */
function window_(spec: SceneSpec, clip: string, start: number, end: number): { spec: SceneSpec; weight: `@${string}` } {
  const D = spec.meta.duration, w = `${clip}-weight`;
  const keys: Keys = [[0, start > 0 ? 0 : 1], [start, 1], [end, 1], ...(end < D ? [[Math.min(D, end + 0.01), 0] as [number, number]] : [])];
  return { spec: { ...spec, tracks: { ...spec.tracks, [w]: { keys, ease: "step" } } }, weight: `@${w}` };
}

/** The arm IK chain to use: the figure's left arm first, then the right, then any of its chains. */
function armIK(spec: SceneSpec, c: string) {
  const chains = (spec.ik ?? []).filter((k) => k.lower.startsWith(bone(c, "")));
  return chains.find((k) => k.lower === bone(c, "lower_arm_l")) ?? chains.find((k) => k.lower === bone(c, "lower_arm_r")) ?? chains[0];
}

/** Where a layer's point (a bone's end, else its pivot) is in the scene at t. */
function pointOf(spec: SceneSpec, l: Layer, t: number, make: CanvasFactory) {
  return apply(layerMatrix(spec, l, t, make), ...(l.type === "bone" ? boneTip(l) : layerPivot(spec, l, make)));
}

/**
 * A keyed motion moving an IK target handle along `path` (scene points with times; each point's ease shapes the move that
 * starts there), as offsets from where the handle rests, in its parent's space.
 */
function handleMotion(spec: SceneSpec, handle: Layer, path: Spot[], make: CanvasFactory): Draft {
  const x: Keys = [], y: Keys = [];
  for (const [t, p, e] of path) {
    // the offset that takes the handle from where it is at t (its own keys and motions) to p, in its parent's space
    const inv = invert(layerMatrix(spec, find(spec, handle.parent) ?? null, t, make));
    const [lx, ly] = apply(inv, ...p), [hx, hy] = apply(inv, ...pointOf(spec, handle, t, make));
    x.push([r3(t), r3(lx - hx), e]);
    y.push([r3(t), r3(ly - hy), e]);
  }
  return { part: handle.id, start: path[0][0], end: path[path.length - 1][0], motion: { x, y } };
}

/** Applies a clip to a character from `args.start`: a new scene, or why the rig can't do it. */
export function applyClip(spec: SceneSpec, name: ClipName, args: ClipArgs, make: CanvasFactory = defaultFactory): ClipResult {
  const c = args.character, D = spec.meta.duration;
  if (!find(spec, c)) return { ok: false, problem: `There is no "${c}" layer` };
  const start = Math.max(0, Math.min(args.start, D)), end = Math.min(D, Math.max(start + 0.1, args.end ?? D));
  const amount = args.amount ?? 1;
  const target = find(spec, args.target);
  if (args.target !== undefined && !target) return { ok: false, problem: `There is no "${args.target}" to aim at` };
  const clip = clipId(spec, c, name);
  const has = (id: string) => !!find(spec, id);
  const headPart = has(bone(c, "head")) ? bone(c, "head") : has(`${c}_head`) ? `${c}_head` : null;
  const chest = has(bone(c, "spine")) ? bone(c, "spine") : has(bone(c, "chest")) ? bone(c, "chest") : has(`${c}_body`) ? `${c}_body` : null;
  const done = (s: SceneSpec): ClipResult => ({ ok: true, spec: s, clip });

  switch (name) {
    case "breathing":
      if (!chest) return { ok: false, problem: `${c} has no chest bone or body to breathe with` };
      return done(withActions(spec, clip, [{ type: "breathe", part: chest, amount }], make));
    case "idle": {
      if (!chest) return { ok: false, problem: `${c} has no chest bone or body to breathe with` };
      let s = withActions(spec, clip, [
        { type: "breathe", part: chest, amount },
        { type: "sway", part: chest, amount: 0.5 * amount, period: 6 },
      ], make);
      const b = applyClip(s, "blink", { ...args, start: 0, end: D }, make);
      if (b.ok) s = retag(b.spec, b.clip, clip);
      return done(s);
    }
    case "blink": {
      if (has(`${c}_head_blink`)) return done(withActions(spec, clip, [{ type: "blink", part: `${c}_head_blink`, ease: "linear", period: args.period ?? 4 }], make));
      const eyes = spec.switches?.find((w) => w.character === c && w.kind === "eyes" && "closed" in w.options);
      if (!eyes) return { ok: false, problem: `${c} has no closed-eye art to blink with` };
      const open = Object.keys(eyes.options).find((o) => eyes.options[o] === null) ?? "open";
      const period = args.period ?? 4;
      let s = spec;
      // jittered a little (seeded by the clip, so always the same) so blinks don't tick like a metronome
      const rand = rng(clip.length * 7919 + Math.round(start * 1000));
      for (let t = start + period * 0.6; t + 0.15 < end; t += period * (0.8 + 0.4 * rand())) s = setSwitchKey(setSwitchKey(s, eyes.id, r3(t), "closed"), eyes.id, r3(t + 0.15), open);
      return done(s);
    }
    case "listening": {
      if (!headPart) return { ok: false, problem: `${c} has no head to nod` };
      const neck = has(bone(c, "neck")) ? bone(c, "neck") : null;
      const win = window_(spec, clip, start, end);
      const list: Draft[] = [{ type: "bob", part: headPart, amount: 0.7 * amount, period: args.period ?? 2.4 }, ...(neck ? [{ type: "sway" as const, part: neck, amount: 0.6 * amount, period: 7 }] : [])];
      return done(withActions(win.spec, clip, list.map((a) => ({ ...a, start, end, weight: win.weight })), make));
    }
    case "look_at": {
      if (!target) return { ok: false, problem: "look_at needs a target" };
      if (!headPart) return { ok: false, problem: `${c} has no head to turn` };
      const list: Draft[] = [{ type: "look_at", part: headPart, target: target.id, start, end: Math.min(D, start + 0.6), amount }];
      // the eyes lead: they get there first
      if (has(`${c}_irises`)) list.unshift({ type: "gaze", part: `${c}_irises`, target: target.id, start, end: Math.min(D, start + 0.25), ease: "out" });
      return done(withActions(spec, clip, list, make));
    }
    case "reach":
    case "sip":
    case "write": {
      const ik = armIK(spec, c);
      if (!ik) return { ok: false, problem: `${c} has no arm with IK; add IK to an arm in the Rig docker` };
      const handle = find(spec, ik.target)!, lower = find(spec, ik.lower)!;
      const rest = apply(layerMatrix(spec, handle, start, make), ...layerPivot(spec, handle, make));
      if (name === "write") {
        // small strokes around where the hand rests, held on the page by a contact
        const L = Number(lower.params.length) || 20;
        const rand = rng(clip.length * 31 + Math.round(start * 100));
        const path: Spot[] = [[start, rest, "inOut"]];
        for (let t = start + 0.25, i = 0; t < end - 0.05; t += 0.25, i++) path.push([t, [rest[0] + (i % 2 ? 1 : -1) * L * 0.08 * amount, rest[1] + (rand() - 0.5) * L * 0.05 * amount], "inOut"]);
        path.push([end, rest, "inOut"]);
        return done(withActions(spec, clip, [handleMotion(spec, handle, path, make), { type: "contact", part: handle.id, start, end }], make));
      }
      if (!target) return { ok: false, problem: `${name} needs a target` };
      const goal = pointOf(spec, target, start, make);
      const span = name === "reach" ? Math.max(0.4, Math.min(1.2, end - start)) : 0.6;
      if (name === "reach") {
        const hold = start + span + 0.4, back = hold + span;
        if (back > D) return { ok: false, problem: `A reach takes ${r3(back - start)}s there and back; start it earlier` };
        const path: Spot[] = [[start, rest, REACH], [start + span, goal, "settle"], [hold, goal, "inOut"], [back, rest, "inOut"]];
        return done(withActions(spec, clip, [handleMotion(spec, handle, path, make), { type: "contact", part: handle.id, start, end: back }], make));
      }
      // sip: reach the cup, carry it to the mouth, sip, put it back, let go
      if (!headPart) return { ok: false, problem: `${c} has no head to sip with` };
      const head = find(spec, headPart)!;
      const mouth = apply(layerMatrix(spec, head, start, make), ...(head.type === "bone" ? head.pivot! : layerPivot(spec, head, make)));
      const t1 = start + span, t2 = t1 + 0.7, t3 = t2 + 0.8, t4 = t3 + 0.7, t5 = t4 + span;
      if (t5 > D) return { ok: false, problem: `A sip takes ${r3(t5 - start)}s; start it earlier` };
      const path: Spot[] = [[start, rest, REACH], [t1, goal, "inOut"], [t2, mouth, "inOut"], [t3, mouth, "inOut"], [t4, goal, "inOut"], [t5, rest, "inOut"]];
      return done(
        withActions(spec, clip, [
          handleMotion(spec, handle, path, make),
          { type: "contact", part: handle.id, start, end: t5 },
          // the cup goes with the hand while it is held
          { type: "attach", part: target.id, target: lower.id, start: t1, end: t4 },
        ], make),
      );
    }
    case "tail_sway": {
      const tail = spec.layers.filter((l) => l.type === "bone" && new RegExp(`^${c}_bone_tail_\\d+$`).test(l.id));
      if (!tail.length) return { ok: false, problem: `${c} has no tail bones` };
      // a wave down the tail: each bone a little later and a little more than the one before
      return done(withActions(spec, clip, tail.map((b, i) => ({ type: "sway" as const, part: b.id, amount: Math.min(5, amount * (1.5 + i)), period: args.period ?? 2.4, phase: r3((i * 0.12) % 1) })), make));
    }
    case "walk_cycle": {
      const P = args.period ?? 1;
      const legs = [["upper_leg_l", "lower_leg_l", 0], ["upper_leg_r", "lower_leg_r", 0.5], ["upper_front_leg", "lower_front_leg", 0], ["upper_back_leg", "lower_back_leg", 0.5]] as const;
      const list: Draft[] = [];
      for (const [up, low, ph] of legs)
        if (has(bone(c, up))) {
          list.push({ type: "sway", part: bone(c, up), amount: Math.min(5, 5 * amount), period: P, phase: ph });
          if (has(bone(c, low))) list.push({ type: "bob", part: bone(c, low), amount: Math.min(5, 4 * amount), period: P / 2, phase: ph });
        }
      if (!list.length) return { ok: false, problem: `${c} has no leg bones` };
      // arms swing against the legs
      for (const [arm, ph] of [["upper_arm_l", 0.5], ["upper_arm_r", 0]] as const) if (has(bone(c, arm))) list.push({ type: "sway", part: bone(c, arm), amount: Math.min(5, 3 * amount), period: P, phase: ph });
      // only while walking
      const win = window_(spec, clip, start, end);
      return done(withActions(win.spec, clip, list.map((a) => ({ ...a, start, end, weight: win.weight })), make));
    }
    case "follow_through": {
      const parts = target ? [target] : spec.layers.filter((l) => l.type === "bone" && new RegExp(`^${c}_bone_(hair|tail|ear)_`).test(l.id));
      if (!parts.length) return { ok: false, problem: `${c} has no hair, ear or tail bones; pick a hanging thing as the target` };
      if (parts.some((p) => p.parent === undefined)) return { ok: false, problem: `${target?.id} has no parent to trail behind` };
      return done(withActions(spec, clip, parts.map((p) => ({ type: "follow" as const, part: p.id, amount, period: args.period ?? 1.2 })), make));
    }
  }
}

/** Moves the actions a clip made under another clip's id (idle's blink is part of idle). */
function retag(spec: SceneSpec, from: string, to: string): SceneSpec {
  return { ...spec, actions: spec.actions?.map((a) => (a.clip === from ? { ...a, clip: to } : a)) };
}

/** The clips in a scene, each with its actions, in the order they were added. */
export function clipsOf(spec: SceneSpec): { clip: string; actions: Action[] }[] {
  const out = new Map<string, Action[]>();
  for (const a of spec.actions ?? []) if (a.clip) out.set(a.clip, [...(out.get(a.clip) ?? []), a]);
  return [...out].map(([clip, actions]) => ({ clip, actions }));
}

/** Removes everything a clip made: its actions, the tracks they use, and its own tracks (a walk's weight). */
export function removeClip(spec: SceneSpec, clip: string): SceneSpec {
  const gone = (spec.actions ?? []).filter((a) => a.clip === clip);
  const used = new Set(gone.flatMap((a) => Object.values(a.tracks ?? {})));
  const tracks = Object.fromEntries(Object.entries(spec.tracks).filter(([name]) => !name.startsWith(`${clip}-`) && !used.has(name)));
  return { ...spec, tracks, actions: (spec.actions ?? []).filter((a) => a.clip !== clip) };
}

export type MotionProblem = { action: string; message: string };

/**
 * Motion that looks wrong: a contact whose hand or foot slides off its target (more than `tolerance` units, sampled
 * through the contact), and two one-shot actions moving the same part the same way at the same time.
 */
export function motionProblems(spec: SceneSpec, make: CanvasFactory = defaultFactory, tolerance = 2): MotionProblem[] {
  const out: MotionProblem[] = [];
  for (const a of spec.actions ?? []) {
    if (a.type !== "contact") continue;
    const ik = spec.ik?.find((k) => k.target === a.part);
    const lower = ik && find(spec, ik.lower), handle = find(spec, a.part);
    if (!lower || !handle) continue;
    const end = a.end ?? spec.meta.duration;
    let worst = 0, when = a.start;
    for (let i = 0; i <= 12; i++) {
      const t = a.start + ((end - a.start) * i) / 12;
      if (contactLevel(spec, a.part, t) < 1) continue;
      const [hx, hy] = pointOf(spec, lower, t, make), [tx, ty] = pointOf(spec, handle, t, make);
      const d = Math.hypot(hx - tx, hy - ty);
      if (d > worst) [worst, when] = [d, t];
    }
    if (worst > tolerance) out.push({ action: a.id, message: `${ik!.lower} slides ${worst.toFixed(1)} units off its target at ${when.toFixed(2)}s (out of reach, or held back by a joint limit)` });
  }
  const shots = (spec.actions ?? []).filter((a) => a.type === "look_at" || a.type === "path" || a.type === "gaze" || a.type === "motion");
  shots.forEach((a, i) => {
    for (const b of shots.slice(i + 1)) {
      if (a.part !== b.part || a.type !== b.type) continue;
      if (a.start < (b.end ?? spec.meta.duration) && b.start < (a.end ?? spec.meta.duration)) out.push({ action: b.id, message: `"${a.id}" and "${b.id}" move ${a.part} at the same time` });
    }
  });
  return out;
}
