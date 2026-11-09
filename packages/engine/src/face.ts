// Faces, gaze and poses: switches (one of several layers shown at a time, optionally cross-faded), named expressions
// that set a character's face slots, pose presets that key its skeleton, and warnings for turns the art can't make.
// All pure: scene + time in, numbers or a new scene out.
import type { Action, Layer, SceneSpec, Switch } from "@anim/spec";
import { MAX_TURN, requiredTurn } from "./actions";
import type { CanvasFactory } from "./drawing";
import { defaultFactory } from "./index";
import { resolve } from "./resolve";

type Transform = NonNullable<Layer["transform"]>;
type Key = keyof Transform;
const DEFAULTS: Transform = { x: 0, y: 0, rotation: 0, scale: 1 };
const trackName = (id: string, k: Key) => `${id.replace(/[^\w-]/g, "_").replace(/^([^A-Za-z_])/, "_$1")}-${k}`;

/**
 * Sets transform values at time t. Animated values (already "@track") always get a key; static values become keyed
 * tracks when autoKey is on, otherwise they are set directly.
 */
export function setTransformAt(spec: SceneSpec, id: string, values: Partial<Record<Key, number>>, t: number, autoKey: boolean): SceneSpec {
  const l = spec.layers.find((x) => x.id === id);
  if (!l) return spec;
  const tracks = { ...spec.tracks };
  const transform: Transform = { ...DEFAULTS, ...l.transform };
  for (const [k, v] of Object.entries(values) as [Key, number][]) {
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

/** Which option a switch shows at t; during a fade, also the one it is fading from and how far along it is (0–1). */
export function switchState(w: Switch, t: number): { option: string; prev: string | null; k: number } {
  let i = 0;
  while (i + 1 < w.keys.length && w.keys[i + 1][0] <= t) i++;
  const [at, option] = w.keys[i];
  if (w.fade > 0 && i > 0 && t >= at && t - at < w.fade && w.keys[i - 1][1] !== option) return { option, prev: w.keys[i - 1][1], k: (t - at) / w.fade };
  return { option, prev: null, k: 1 };
}

/** How visible a layer is at t through switches: its own and every ancestor's (1 when nothing switches it). */
export function switchVisibility(spec: SceneSpec, layer: Layer, t: number): number {
  if (!spec.switches?.length) return 1;
  let v = 1;
  for (let l: Layer | undefined = layer, n = 0; l && n <= spec.layers.length; l = l.parent === undefined ? undefined : spec.layers.find((x) => x.id === l!.parent), n++) {
    const w = spec.switches.find((s) => Object.values(s.options).includes(l!.id));
    if (!w) continue;
    const st = switchState(w, t);
    let own = 0;
    for (const [name, id] of Object.entries(w.options)) if (id === l.id) own += (name === st.option ? st.k : 0) + (name === st.prev ? 1 - st.k : 0);
    v *= own;
    if (!v) return 0;
  }
  return v;
}

/** Shows `option` from time t on (replacing a key already at t). */
export function setSwitchKey(spec: SceneSpec, id: string, t: number, option: string): SceneSpec {
  return {
    ...spec,
    switches: spec.switches?.map((w) => (w.id !== id ? w : { ...w, keys: [...w.keys.filter(([kt]) => Math.abs(kt - t) > 1e-6), [t, option] as [number, string]].sort((a, b) => a[0] - b[0]) })),
  };
}

export type FaceSlot = "eyes" | "mouth" | "brows";
/** What each expression shows in each face slot. The painted face is the "open"/"neutral" option of every slot. */
export const EXPRESSIONS = {
  neutral: { eyes: "open", mouth: "neutral", brows: "neutral" },
  happy: { eyes: "open", mouth: "smile", brows: "neutral" },
  sad: { eyes: "open", mouth: "frown", brows: "sad" },
  surprised: { eyes: "wide", mouth: "open", brows: "raised" },
  "eyes-closed": { eyes: "closed", mouth: "neutral", brows: "neutral" },
} as const satisfies Record<string, Record<FaceSlot, string>>;
export type Expression = keyof typeof EXPRESSIONS;
/** The painted (base) option of each slot. */
export const BASE_OPTION: Record<FaceSlot, string> = { eyes: "open", mouth: "neutral", brows: "neutral" };

const isFace = (w: Switch): w is Switch & { kind: FaceSlot } => w.kind === "eyes" || w.kind === "mouth" || w.kind === "brows";

/**
 * Keys an expression on a character's face slots at t. A slot whose artwork lacks the option (no smile was painted)
 * shows its painted face instead, and is listed in `missing`.
 */
export function applyExpression(spec: SceneSpec, character: string, expression: Expression, t: number): { spec: SceneSpec; missing: string[] } {
  let out = spec;
  const missing: string[] = [];
  for (const w of spec.switches ?? []) {
    if (w.character !== character || !isFace(w)) continue;
    const want = EXPRESSIONS[expression][w.kind];
    const option = want in w.options ? want : BASE_OPTION[w.kind];
    if (option !== want) missing.push(`${w.kind}: ${want}`);
    if (option in w.options) out = setSwitchKey(out, w.id, t, option);
  }
  return { spec: out, missing };
}

/** Bone rotations (radians, from how the skeleton was drawn) for the person template; `_l` is the figure's left. */
export const POSES = {
  rest: { bones: {}, face: "neutral" },
  listening: { bones: { head: 0.1, neck: 0.04 }, face: "neutral" },
  looking: { bones: {}, face: "neutral" },
  sipping: { bones: { upper_arm_l: -1.1, lower_arm_l: -1.6, hand_l: -0.4, head: -0.06 }, face: "eyes-closed" },
  writing: { bones: { upper_arm_l: -0.35, lower_arm_l: -1.0, hand_l: 0.2, head: 0.12, neck: 0.08 }, face: "neutral" },
  sleeping: { bones: { head: 0.4, neck: 0.15, spine: 0.06, upper_arm_l: 0.1, upper_arm_r: -0.1 }, face: "eyes-closed" },
  waking: { bones: { upper_arm_l: -2.3, lower_arm_l: -0.4, upper_arm_r: 2.3, lower_arm_r: 0.4, head: -0.05 }, face: "neutral" },
} as const satisfies Record<string, { bones: Record<string, number>; face: Expression }>;
export type Pose = keyof typeof POSES;

const BONE = (character: string) => `${character}_bone_`;

/**
 * Moves a character into a pose preset at t, reaching it over `duration` seconds: every skeleton bone is keyed (bones
 * the pose doesn't list go back to how they were drawn) and the face takes the pose's expression. "looking" turns the
 * head a little toward `target` and, when the character has separated irises, adds a gaze. It only keys motion: assets,
 * the character's profile and its proportions are never touched.
 */
export function applyPose(spec: SceneSpec, character: string, pose: Pose, t: number, opts: { duration?: number; target?: string } = {}): { spec: SceneSpec; notes: string[] } {
  const prefix = BONE(character);
  const bones = spec.layers.filter((l) => l.type === "bone" && l.id.startsWith(prefix));
  const notes: string[] = [];
  if (!bones.length) return { spec, notes: [`${character} has no skeleton; add one in the Rig docker`] };
  const D = spec.meta.duration;
  const start = Math.min(t, D), end = Math.min(D, start + Math.max(0, opts.duration ?? 0.5));
  const want: Record<string, number> = { ...POSES[pose].bones };
  let out = spec;
  if (pose === "looking") {
    const target = opts.target && spec.layers.find((l) => l.id === opts.target);
    const head = bones.find((b) => b.id === `${prefix}head`);
    if (!target || !head) notes.push(target ? "No head bone to turn" : "Pick what to look at");
    else {
      // the head turns a little toward the target (MAX_TURN at most); the eyes do the rest
      const a = { id: "_pose", type: "look_at", part: head.id, target: target.id, start, end, ease: "inOut", amount: 1 } as Action;
      let turn = 0;
      try {
        turn = Math.max(-MAX_TURN * 0.6, Math.min(MAX_TURN * 0.6, requiredTurn(spec, a)));
      } catch {
        notes.push(`${target.id} draws nothing to look at`);
      }
      want.head = turn;
      want.neck = turn * 0.3;
      const irises = spec.layers.find((l) => l.id === `${character}_irises`);
      if (irises && end > start) {
        const id = uniqueActionId(spec, `${character}_gazes_at_${target.id}`);
        out = { ...out, actions: [...(out.actions ?? []), { id, type: "gaze", part: irises.id, target: target.id, start, end: Math.min(D, start + Math.max(0.2, (end - start) * 0.5)), ease: "out", amount: 1 }] };
      } else if (!irises) notes.push("No separated irises, so only the head turns");
    }
  }
  for (const b of bones) {
    const name = b.id.slice(prefix.length);
    const cur = resolve({ ...DEFAULTS, ...b.transform }, out, start).rotation;
    // hold where it was until start, then reach the pose by end
    if (end > start) out = setTransformAt(out, b.id, { rotation: cur }, start, true);
    out = setTransformAt(out, b.id, { rotation: want[name] ?? 0 }, end, true);
  }
  const face = applyExpression(out, character, POSES[pose].face, start);
  if (face.missing.length) notes.push(`This face has no painted ${face.missing.join(", ")}; its painted face shows instead`);
  return { spec: face.spec, notes };
}

const uniqueActionId = (spec: SceneSpec, base: string) => {
  let id = base;
  for (let n = 2; spec.actions?.some((a) => a.id === id); n++) id = `${base}-${n}`;
  return id;
};

/** The top of a layer's rig: its character group. */
export function characterOf(spec: SceneSpec, id: string): string {
  let l = spec.layers.find((x) => x.id === id);
  for (let n = 0; l?.parent && n < spec.layers.length; n++) l = spec.layers.find((x) => x.id === l!.parent);
  return l?.id ?? id;
}

export type PoseProblem = { layer: string; message: string };

/**
 * Turns the artwork can't make: a look_at that needs more than the safe turn (MAX_TURN) of a flat cut-out, with no side
 * view of the head shown at that moment. Its head under-turns; a three-quarter or profile view fixes it.
 */
export function poseProblems(spec: SceneSpec, make: CanvasFactory = defaultFactory): PoseProblem[] {
  const out: PoseProblem[] = [];
  for (const a of spec.actions ?? []) {
    if (a.type !== "look_at") continue;
    let need: number;
    try {
      need = Math.abs(requiredTurn(spec, a, make));
    } catch {
      continue; // an unresolvable target is reported by validation
    }
    if (need <= MAX_TURN * a.amount + 1e-6) continue;
    const views = spec.switches?.find((w) => w.kind === "view" && Object.values(w.options).includes(a.part));
    const front = views && Object.entries(views.options).find(([, id]) => id === a.part)?.[0];
    const at = a.end ?? spec.meta.duration;
    if (views && front && switchState(views, at).option !== front) continue;
    const deg = Math.round((need * 180) / Math.PI);
    out.push({
      layer: a.part,
      message: views
        ? `Turning ${deg}° toward ${a.target} at ${a.start}s needs a side view; key "${views.id}" to a side view by ${at}s`
        : `Turning ${deg}° toward ${a.target} at ${a.start}s is past the ${Math.round((MAX_TURN * 180) / Math.PI)}° a flat head can turn; generate a three-quarter view for it`,
    });
  }
  return out;
}
