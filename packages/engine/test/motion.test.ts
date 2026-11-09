import { createCanvas } from "@napi-rs/canvas";
import type { SceneSpec, SceneSpecInput } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { actionOffsets, applyClip, apply, boneTip, clipsOf, easeOf, evalTrack, layerMatrix, layerPivot, motionProblems, registerImage, removeClip, skeleton, validateScene } from "../src";
import { factory, hashes } from "./helpers";

function solid(src: string, w: number, h: number, color: string) {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  registerImage(src, c);
  return { src, width: w, height: h };
}
const valid = (input: unknown): SceneSpec => {
  const r = validateScene(input);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.spec;
};

/** A rigged person (human template) with IK on the left arm, a cup on a table, and a hanging lantern. */
function scene(extra: Partial<SceneSpecInput> = {}): SceneSpec {
  const bones = skeleton("human", "girl_bone", "girl", [100, 40, 200, 340], { hair: true });
  const lower = bones.find((b) => b.id === "girl_bone_lower_arm_l")!;
  return valid({
    version: 1,
    meta: { title: "m", duration: 8, fps: 30, width: 400, height: 400 },
    layers: [
      // within reach of the left hand (shoulder at ~(162, 127), arm ~87 long)
      { id: "cup", type: "image", pivot: [195, 195], params: { asset: "cup", x: 188, y: 188, w: 14, h: 14 } },
      { id: "girl", type: "group", pivot: [150, 340] },
      { id: "girl_body", type: "image", parent: "girl", params: { asset: "body", x: 110, y: 120, w: 80, h: 200 } },
      { id: "girl_head", type: "image", parent: "girl_body", pivot: [150, 100], params: { asset: "head", x: 125, y: 45, w: 50, h: 55 } },
      ...bones,
      { id: "hand_target", type: "group", pivot: boneTip(lower) },
      { id: "lamp_post", type: "group", pivot: [320, 100] },
      { id: "lantern", type: "image", parent: "lamp_post", pivot: [320, 100], params: { asset: "cup", x: 310, y: 100, w: 20, h: 30 } },
    ],
    assets: { cup: solid("/m/cup.png", 4, 4, "#f0f0f0"), body: solid("/m/body.png", 8, 20, "#c04070"), head: solid("/m/head.png", 5, 5, "#f0c0a0") },
    ik: [{ id: "arm_ik", upper: "girl_bone_upper_arm_l", lower: "girl_bone_lower_arm_l", target: "hand_target", mix: 0 }],
    ...extra,
  });
}
const L = (s: SceneSpec, id: string) => s.layers.find((l) => l.id === id)!;
const hand = (s: SceneSpec, t: number) => apply(layerMatrix(s, L(s, "girl_bone_lower_arm_l"), t, factory), ...boneTip(L(s, "girl_bone_lower_arm_l")));
const pivotAt = (s: SceneSpec, id: string, t: number) => apply(layerMatrix(s, L(s, id), t, factory), ...layerPivot(s, L(s, id), factory));
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe("curves", () => {
  it("named eases: anticipate pulls back, overshoot goes past, settle wobbles to exactly 1", () => {
    const [a, o, s] = [easeOf("anticipate"), easeOf("overshoot"), easeOf("settle")];
    expect(Math.min(...[0.1, 0.2, 0.3].map(a))).toBeLessThan(0);
    expect(Math.max(...[0.7, 0.8, 0.9].map(o))).toBeGreaterThan(1);
    for (const f of [a, o, s]) {
      expect(f(0)).toBeCloseTo(0, 9);
      expect(f(1)).toBeCloseTo(1, 9);
    }
  });

  it("Bézier eases match their curve; a key's own ease shapes only its segment", () => {
    const lin = easeOf([0.25, 0.25, 0.75, 0.75]);
    for (const k of [0.1, 0.5, 0.9]) expect(lin(k)).toBeCloseTo(k, 4);
    const ease = easeOf([0.42, 0, 0.58, 1]); // CSS ease-in-out
    expect(ease(0.5)).toBeCloseTo(0.5, 4);
    expect(ease(0.25)).toBeLessThan(0.25);
    const tr = { keys: [[0, 0, [0.36, -0.2, 0.3, 1.2]], [1, 10], [2, 0]] as never, ease: "linear" as const };
    expect(evalTrack(tr, 0.1)).toBeLessThan(0); // anticipation
    expect(evalTrack(tr, 1.5)).toBeCloseTo(5, 9); // the next segment uses the track's linear ease
    // a track without per-key eases is unchanged
    expect(evalTrack({ keys: [[0, 0], [1, 10]], ease: "linear" }, 0.3)).toBeCloseTo(3, 9);
  });
});

describe("blending and phase", () => {
  it("weight scales what an action adds, and a weight track fades it", () => {
    const r = applyClip(scene(), "breathing", { character: "girl", start: 0 }, factory);
    if (!r.ok) throw new Error(r.problem);
    const full = actionOffsets(r.spec, "girl_bone_spine", 2)!.scale;
    expect(full).toBeGreaterThan(0);
    const w = (weight: unknown, tracks = {}) => valid({ ...r.spec, tracks: { ...r.spec.tracks, ...tracks }, actions: r.spec.actions!.map((a) => ({ ...a, weight })) });
    expect(actionOffsets(w(0.5), "girl_bone_spine", 2)!.scale).toBeCloseTo(full / 2, 9);
    const fading = w("@fade", { fade: { keys: [[0, 0], [8, 1]], ease: "linear" } });
    expect(actionOffsets(fading, "girl_bone_spine", 2)!.scale).toBeCloseTo(full * 0.25, 9);
  });

  it("phase starts a loop part-way through its cycle", () => {
    const r = applyClip(scene(), "walk_cycle", { character: "girl", start: 0, period: 1 });
    if (!r.ok) throw new Error(r.problem);
    const l = actionOffsets(r.spec, "girl_bone_upper_leg_l", 0.25)!.rotation, rr = actionOffsets(r.spec, "girl_bone_upper_leg_r", 0.75)!.rotation;
    expect(rr).toBeCloseTo(l, 6); // the right leg is half a stride behind
    expect(Math.abs(l)).toBeGreaterThan(0.05);
  });
});

describe("secondary motion", () => {
  it("trails when the driver turns, is still when it is still, deterministic, and joins at the loop seam", () => {
    // the lamp post rocks back and forth once over the scene: a periodic driver
    const s = valid({ ...scene(), tracks: { rock: { keys: [[0, 0], [2, 0.3], [6, -0.3], [8, 0]], ease: "inOut" } }, layers: scene().layers.map((l) => (l.id === "lamp_post" ? { ...l, transform: { rotation: "@rock" } } : l)) });
    const r = applyClip(s, "follow_through", { character: "girl", start: 0, target: "lantern" });
    if (!r.ok) throw new Error(r.problem);
    const f = (t: number) => actionOffsets(r.spec, "lantern", t, factory)!.rotation;
    expect(Math.abs(f(1.5))).toBeGreaterThan(0.005);
    expect(f(1.5)).toBe(f(1.5));
    expect(f(0)).toBeCloseTo(f(8), 9);
    // continuous: no jump between neighbouring frames anywhere, including across the seam
    const frames = Array.from({ length: 241 }, (_, i) => f(i / 30));
    const jumps = frames.slice(1).map((v, i) => Math.abs(v - frames[i]));
    expect(Math.max(...jumps, Math.abs(frames[0] - frames[240]))).toBeLessThan(0.05);
    const still = applyClip(scene(), "follow_through", { character: "girl", start: 0, target: "lantern" });
    expect(still.ok && actionOffsets(still.spec, "lantern", 3, factory)!.rotation).toBeCloseTo(0, 9);
  });
});

describe("contacts and reach", () => {
  it("a reach gets the hand to the cup, holds it there within tolerance, and comes back", () => {
    const s = scene();
    const r = applyClip(s, "reach", { character: "girl", start: 1, end: 1.6, target: "cup" });
    if (!r.ok) throw new Error(r.problem);
    expect(dist(hand(r.spec, 0.5), hand(s, 0.5))).toBeLessThan(1e-6); // untouched before
    for (const t of [1.6, 1.8, 2.0]) expect(dist(hand(r.spec, t), pivotAt(r.spec, "cup", t))).toBeLessThan(2);
    expect(dist(hand(r.spec, 2.6), hand(s, 2.6))).toBeLessThan(2); // back where it rests
    expect(motionProblems(r.spec, factory)).toEqual([]);
    // anticipation: just after the start the handle moves away from the cup before going to it
    const start = dist(pivotAt(r.spec, "hand_target", 1), pivotAt(r.spec, "cup", 1));
    expect(dist(pivotAt(r.spec, "hand_target", 1.09), pivotAt(r.spec, "cup", 1))).toBeGreaterThan(start + 0.5);
  });

  it("a sip carries the cup with the hand, then leaves it where it was put back", () => {
    const s = scene();
    const r = applyClip(s, "sip", { character: "girl", start: 0.5, target: "cup" });
    if (!r.ok) throw new Error(r.problem);
    const rel = (t: number) => [pivotAt(r.spec, "cup", t)[0] - hand(r.spec, t)[0], pivotAt(r.spec, "cup", t)[1] - hand(r.spec, t)[1]];
    const held = [1.2, 1.6, 2.2, 2.7].map(rel);
    for (const h of held) expect(dist(h, held[0])).toBeLessThan(2); // moves with the hand
    expect(dist(pivotAt(r.spec, "cup", 1.6), pivotAt(s, "cup", 1.6))).toBeGreaterThan(10); // was lifted
    expect(dist(pivotAt(r.spec, "cup", 4.5), pivotAt(s, "cup", 4.5))).toBeLessThan(2); // put back
    valid(r.spec);
  });

  it("an out-of-reach target is reported as sliding, not silently missed", () => {
    const s = valid({ ...scene(), layers: scene().layers.map((l) => (l.id === "cup" ? { ...l, pivot: [395, 395] } : l)) });
    const r = applyClip(s, "reach", { character: "girl", start: 1, target: "cup" });
    if (!r.ok) throw new Error(r.problem);
    expect(motionProblems(r.spec, factory).map((p) => p.message).join()).toMatch(/slides/);
  });
});

describe("clip library", () => {
  it("every clip either works on this rig or says why; removing a clip restores the scene", () => {
    const s = scene();
    const ok = (name: Parameters<typeof applyClip>[1], args: Partial<Parameters<typeof applyClip>[2]> = {}) => applyClip(s, name, { character: "girl", start: 1, ...args }, factory);
    for (const n of ["idle", "breathing", "listening", "walk_cycle", "follow_through", "write"] as const) expect(ok(n).ok).toBe(true);
    for (const n of ["look_at", "reach", "sip"] as const) expect(ok(n, { target: "cup" }).ok).toBe(true);
    expect(ok("tail_sway")).toMatchObject({ ok: false, problem: expect.stringMatching(/no tail/) });
    expect(ok("blink")).toMatchObject({ ok: false, problem: expect.stringMatching(/closed-eye/) });
    expect(ok("reach")).toMatchObject({ ok: false, problem: expect.stringMatching(/needs a target/) });
    expect(ok("look_at", { target: "nope" })).toMatchObject({ ok: false });
    const sip = ok("sip", { target: "cup" });
    if (!sip.ok) throw new Error();
    expect(clipsOf(sip.spec).map((c) => c.clip)).toEqual([sip.clip]);
    const back = removeClip(sip.spec, sip.clip);
    expect(back.actions).toEqual(s.actions ?? []);
    expect(back.tracks).toEqual(s.tracks);
  });

  it("listening nods only between its start and end", () => {
    const r = applyClip(scene(), "listening", { character: "girl", start: 2, end: 4 }, factory);
    if (!r.ok) throw new Error(r.problem);
    expect(actionOffsets(r.spec, "girl_bone_head", 1.3)!.rotation).toBe(0);
    expect(Math.abs(actionOffsets(r.spec, "girl_bone_head", 2.6)!.rotation)).toBeGreaterThan(0);
    expect(actionOffsets(r.spec, "girl_bone_head", 5)!.rotation).toBe(0);
  });

  it("walking only happens between start and end; renders are deterministic", () => {
    const r = applyClip(scene(), "walk_cycle", { character: "girl", start: 2, end: 4 });
    if (!r.ok) throw new Error();
    expect(actionOffsets(r.spec, "girl_bone_upper_leg_l", 1.1)!.rotation).toBe(0);
    expect(actionOffsets(r.spec, "girl_bone_upper_leg_l", 5.1)!.rotation).toBe(0);
    expect(Math.abs(actionOffsets(r.spec, "girl_bone_upper_leg_l", 2.1)!.rotation)).toBeGreaterThan(0);
    const h = hashes(r.spec, [2.5, 3, 2.5], undefined, [200, 200]);
    expect(h[0]).toBe(h[2]);
  });
});
