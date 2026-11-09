// Loop validation: a scene exported as a loop jumps if anything is somewhere else at its end than at its start. This
// compares every moving part of the scene at t = duration (the frame after the last) with t = 0, names what causes a
// jump (a layer, a track, an action, a switch, the camera, the look, or a layer that draws differently), and can repair
// the common causes. Nothing here changes the scene except `fixLoop`, which returns a new one.
import type { Layer, SceneSpec, Track } from "@anim/spec";
import { actionOffsets, actionTracks } from "./actions";
import type { CanvasFactory } from "./drawing";
import { switchState } from "./face";
import { createRenderer, defaultFactory, layerMatrix, type CanvasLike } from "./index";
import { cameraMatrix, lookAt } from "./look";
import { apply, invert, mul, type Mat } from "./matrix";
import { layerPivot } from "./bounds";
import { evalTrack } from "./tracks";

export type LoopIssue = { level: "error" | "warning"; kind: "layer" | "track" | "action" | "switch" | "camera" | "look" | "pixels"; id: string; at?: number; message: string };
export type LoopReport = {
  ok: boolean;
  duration: number;
  fps: number;
  /** Whole-frame check: how much the frame changes across the seam, against a usual frame-to-frame change (0–255). */
  seam: { change: number; usual: number } | null;
  issues: LoopIssue[];
};

const angle = (m: Mat) => Math.atan2(m[1], m[0]);
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const r2 = (v: number) => +v.toFixed(2);

/** Every "@name" track reference in a value, with where it is used. */
function trackUsers(spec: SceneSpec): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (name: string, by: string) => out.set(name, [...(out.get(name) ?? []), by]);
  const walk = (v: unknown, by: string) => {
    if (typeof v === "string" && v.startsWith("@")) add(v.slice(1), by);
    else if (Array.isArray(v)) v.forEach((x) => walk(x, by));
    else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x, by);
  };
  for (const l of spec.layers) walk({ t: l.transform, p: l.params, s: l.shadow }, l.id);
  walk(spec.camera, "camera");
  walk(spec.look, "look");
  for (const k of spec.ik ?? []) walk(k.mix, `ik ${k.id}`);
  for (const a of spec.actions ?? []) {
    walk(a.weight, `action ${a.id}`);
    for (const n of Object.values(a.tracks ?? {})) add(n, `action ${a.id}`);
  }
  return out;
}

/** When a track last changes value (its last key that differs from the one before), for messages. */
function lastChange(tr: Track): number {
  for (let i = tr.keys.length - 1; i > 0; i--) if (tr.keys[i][1] !== tr.keys[i - 1][1]) return tr.keys[i][0];
  return tr.keys[0][0];
}

/** Mean absolute difference of two RGBA frames, per color channel (0–255). */
function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return d / ((a.length / 4) * 3);
}

/**
 * Checks that the scene loops: everything at its end (t = duration, the frame that would follow the last) is where it
 * was at t = 0. With `render`, also compares rendered frames (needs the scene's images loaded): the whole frame across the
 * seam against a usual frame-to-frame change, and each drawing layer alone (particles whose motion doesn't fit the
 * scene's length show up there).
 */
export function loopReport(spec: SceneSpec, opts: { make?: CanvasFactory; render?: boolean; size?: [number, number] } = {}): LoopReport {
  const make = opts.make ?? defaultFactory;
  const { duration: D, fps, width: W } = spec.meta;
  const issues: LoopIssue[] = [];
  const tol = W * 0.004; // scene units: a jump under ~half a percent of the width doesn't read as a jump
  const byId = new Map(spec.layers.map((l) => [l.id, l]));
  const blamed = new Set<string>();

  // actions: one-shots that end somewhere else than they started (look_at holding its pose, a carried cup)
  for (const a of spec.actions ?? []) {
    let off: string | null = null;
    if (a.type === "attach" || a.type === "follow") {
      const [o0, oD] = [actionOffsets({ ...spec, actions: [a] }, a.part, 0, make), actionOffsets({ ...spec, actions: [a] }, a.part, D, make)];
      if (o0 && oD && (Math.hypot(oD.x - o0.x, oD.y - o0.y) > tol || Math.abs(wrapA(oD.rotation - o0.rotation)) > 0.02)) off = a.type === "attach" ? `leaves ${a.part} where it was carried to` : `${a.part} is swinging differently`;
    } else
      for (const [ch, name] of Object.entries(a.tracks ?? {})) {
        const tr = spec.tracks[name];
        if (tr && Math.abs(evalTrack(tr, D) - evalTrack(tr, 0)) > (ch === "rotation" ? 0.01 : ch === "opacity" ? 0.02 : tol)) off = `${ch} ends at ${r2(evalTrack(tr, D))} but starts at ${r2(evalTrack(tr, 0))}`;
      }
    if (!off) continue;
    for (const name of Object.values(a.tracks ?? {})) blamed.add(name);
    blamed.add(`action:${a.part}`);
    const hint = a.type === "look_at" || a.type === "gaze" ? "; give it a hold time so it turns back before the end" : a.type === "path" ? "; end the path before the scene does" : "";
    issues.push({ level: "error", kind: "action", id: a.id, at: a.end ?? a.start, message: `${a.type} on ${a.part}: ${off}, so it snaps back when the video loops${hint}` });
  }

  // tracks: a keyed value that doesn't come back to where it started, or a loop that doesn't fit the scene
  const users = trackUsers(spec);
  for (const [name, tr] of Object.entries(spec.tracks)) {
    if (blamed.has(name) || !users.has(name)) continue;
    const v0 = evalTrack(tr, 0), vD = evalTrack(tr, D);
    const range = Math.max(1e-6, ...tr.keys.map((k) => Math.abs(k[1] - tr.keys[0][1])));
    const P = tr.keys[tr.keys.length - 1][0];
    if (Math.abs(vD - v0) > Math.max(1e-6, range * 0.02)) {
      blamed.add(name);
      issues.push({ level: "error", kind: "track", id: name, at: lastChange(tr), message: `@${name} (used by ${users.get(name)!.join(", ")}) ends at ${r2(vD)} but starts at ${r2(v0)}; key it back to ${r2(v0)} by ${D}s` });
    } else if (tr.loop && P > 0 && Math.abs(D / P - Math.round(D / P)) > 1e-3)
      issues.push({ level: "warning", kind: "track", id: name, message: `@${name} repeats every ${r2(P)}s, which doesn't fit the ${D}s scene a whole number of times; it lines up at the seam by chance only` });
  }

  // switches: a face or view that is different at the end
  for (const w of spec.switches ?? []) {
    const [a, b] = [switchState(w, 0).option, switchState(w, D).option];
    if (a !== b) issues.push({ level: "error", kind: "switch", id: w.id, at: w.keys[w.keys.length - 1][0], message: `${w.id} shows "${b}" at the end but "${a}" at the start; key it back to "${a}" before the end` });
  }

  // camera and look
  const [c0, cD] = [cameraMatrix(spec, null, 0), cameraMatrix(spec, null, D)];
  if (c0.some((v, i) => Math.abs(v - cD[i]) > (i < 4 ? 1e-3 : tol))) issues.push({ level: "error", kind: "camera", id: "camera", message: "The camera is somewhere else at the end than at the start" });
  const [l0, lD] = [lookAt(spec.look, spec, 0), lookAt(spec.look, spec, D)];
  if (l0 && lD && JSON.stringify(l0, (_, v) => (typeof v === "number" ? +v.toFixed(3) : v)) !== JSON.stringify(lD, (_, v) => (typeof v === "number" ? +v.toFixed(3) : v)))
    issues.push({ level: "error", kind: "look", id: "look", message: "The look (grade, fog, light…) is different at the end than at the start" });

  // layers: where each one is (relative to its parent, so a moving character is reported once, not every part of it)
  const dt = 1 / fps;
  for (const l of spec.layers) {
    if (blamed.has(`action:${l.id}`)) continue;
    const parent = l.parent === undefined ? null : (byId.get(l.parent) ?? null);
    const local = (t: number) => mul(invert(layerMatrix(spec, parent, t, make)), layerMatrix(spec, l, t, make));
    const p = l.type === "bone" || l.pivot ? (l.pivot ?? [0, 0]) : safePivot(spec, l, make);
    const [m0, mD] = [local(0), local(D)];
    const [a0, aD] = [apply(m0, ...p), apply(mD, ...p)];
    const jump = Math.hypot(aD[0] - a0[0], aD[1] - a0[1]), turn = Math.abs(wrapA(angle(mD) - angle(m0)));
    if (jump > tol || turn > 0.02) {
      const cause = layerCause(spec, l, users, blamed);
      if (cause !== "known") issues.push({ level: "error", kind: "layer", id: l.id, message: `${l.id} is ${jump > tol ? `${Math.round(jump)} units away` : `turned ${Math.round((turn * 180) / Math.PI)}°`} at the end from where it starts${cause}` });
      continue;
    }
    // same place, different speed: a hitch rather than a jump
    const [s0, sD] = [apply(local(dt), ...p), apply(local(D - dt), ...p)];
    const v0 = [s0[0] - a0[0], s0[1] - a0[1]], vD = [aD[0] - sD[0], aD[1] - sD[1]];
    if (Math.hypot(v0[0] - vD[0], v0[1] - vD[1]) > tol * 0.5) issues.push({ level: "warning", kind: "layer", id: l.id, message: `${l.id} moves at a different speed just after the start than just before the end, so the loop hitches` });
  }

  let seam: LoopReport["seam"] = null;
  if (opts.render) {
    const [w, h] = opts.size ?? [320, Math.round((320 * spec.meta.height) / spec.meta.width)];
    const frame = (s: SceneSpec, t: number) => {
      const c = make(w, h) as CanvasLike;
      createRenderer(c, s, { createCanvas: make }).render(t);
      return (c.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, w, h).data;
    };
    const change = frameDiff(frame(spec, D), frame(spec, 0));
    const steps = [1, 2, 3, 4, 5].map((k) => (k * D) / 6).map((t) => frameDiff(frame(spec, t), frame(spec, t + dt))).sort((a, b) => a - b);
    const usual = steps[2];
    seam = { change: r2(change), usual: r2(usual) };
    if (change > Math.max(1, usual * 3)) issues.push({ level: issues.some((i) => i.level === "error") ? "warning" : "error", kind: "pixels", id: "frame", at: D, message: `The last frame jumps to the first: the picture changes by ${r2(change)} across the seam against a usual ${r2(usual)} between frames` });
    // each layer that draws, alone: animation inside an object (particles) that doesn't fit the scene's length
    const reported = new Set(issues.map((i) => i.id));
    for (const l of spec.layers) {
      if (l.type === "group" || l.type === "bone" || reported.has(l.id)) continue;
      const chain = new Set<string>();
      for (let x: Layer | undefined = l; x && chain.size <= spec.layers.length; x = x.parent === undefined ? undefined : byId.get(x.parent)) chain.add(x.id);
      const alone: SceneSpec = { ...spec, look: undefined, camera: undefined, layers: spec.layers.filter((x) => chain.has(x.id)), overlays: [] };
      const d = frameDiff(frame(alone, D), frame(alone, 0));
      if (d > 0.5) issues.push({ level: "error", kind: "layer", id: l.id, message: `${l.id} (${l.type}) draws differently at the end than at the start: its own animation doesn't fit the ${D}s scene` });
    }
  }
  return { ok: !issues.some((i) => i.level === "error"), duration: D, fps, seam, issues };
}

/** A layer's pivot, or its origin when finding one would need rendering an object that draws nothing. */
function safePivot(spec: SceneSpec, l: Layer, make: CanvasFactory): [number, number] {
  try {
    return layerPivot(spec, l, make);
  } catch {
    return [0, 0];
  }
}

/** Why a layer is off at the end: its own keyed transform (named), or "known" when an action already explains it. */
function layerCause(spec: SceneSpec, l: Layer, users: Map<string, string[]>, blamed: Set<string>): string {
  const own = Object.values(l.transform ?? {}).filter((v): v is `@${string}` => typeof v === "string").map((v) => v.slice(1));
  if (own.some((n) => blamed.has(n))) return "known";
  const ik = spec.ik?.find((k) => k.upper === l.id || k.lower === l.id);
  if (ik) return ` (its IK target ${ik.target} doesn't return)`;
  void users;
  return own.length ? ` (keyed by ${own.map((n) => `@${n}`).join(", ")})` : "";
}

/**
 * Repairs the usual causes, as one new scene: a look_at or gaze that holds to the end turns back before it; a keyed value
 * that ends elsewhere gets a key back to its start value at the end; a switch is keyed back to its first option. Returns
 * the new scene and what was changed (nothing changes when there is nothing to fix).
 */
export function fixLoop(spec: SceneSpec, make: CanvasFactory = defaultFactory): { spec: SceneSpec; fixed: string[] } {
  const D = spec.meta.duration, fixed: string[] = [];
  let out: SceneSpec = { ...spec, tracks: { ...spec.tracks } };
  out.actions = spec.actions?.map((a) => {
    if ((a.type !== "look_at" && a.type !== "gaze") || a.end === undefined || (a.hold !== undefined && a.hold + (a.end - a.start) <= D)) return a;
    const hold = Math.max(a.end, +(D - (a.end - a.start)).toFixed(3));
    fixed.push(`${a.id} turns back by ${D}s (holds until ${hold}s)`);
    const next = { ...a, hold };
    // recompile its tracks with the return in them
    for (const [ch, tr] of Object.entries(actionTracks(out, next, make))) if (a.tracks?.[ch as keyof typeof a.tracks]) out.tracks[a.tracks[ch as keyof typeof a.tracks]!] = tr!;
    return next;
  });
  const users = trackUsers(out);
  const owned = new Set((out.actions ?? []).flatMap((a) => Object.values(a.tracks ?? {})));
  for (const [name, tr] of Object.entries(out.tracks)) {
    if (!users.has(name) || owned.has(name) || tr.loop) continue;
    const v0 = evalTrack(tr, 0);
    if (Math.abs(evalTrack(tr, D) - v0) < 1e-9) continue;
    const last = tr.keys[tr.keys.length - 1][0];
    // come back over the last second (or what is left of the scene), never on top of the last key
    const back = Math.max(last + 1e-3, D);
    out.tracks[name] = { ...tr, keys: [...tr.keys.filter(([t]) => t < back - 1e-9), [Math.min(D, back), v0]] };
    fixed.push(`@${name} comes back to ${r2(v0)} at ${D}s`);
  }
  out = {
    ...out,
    switches: out.switches?.map((w) => {
      const first = switchState(w, 0).option;
      if (switchState(w, D).option === first) return w;
      const at = +Math.max(w.keys[w.keys.length - 1][0] + 0.05, D - Math.max(0.2, w.fade)).toFixed(3);
      fixed.push(`${w.id} goes back to "${first}" at ${at}s`);
      return { ...w, keys: [...w.keys.filter(([t]) => t < at), [Math.min(D, at), first] as [number, string]] };
    }),
  };
  return { spec: fixed.length ? out : spec, fixed };
}
