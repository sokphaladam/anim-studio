import { boneTip, skeleton, validateScene } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { describeScene, directMotion, directionProblems, DirectionSchema, type Provider } from "../src";

/** A rigged girl with IK on her left arm and a cup within reach (explicit pivots: nothing needs rendering). */
function scene(): SceneSpec {
  const bones = skeleton("human", "girl_bone", "girl", [100, 40, 200, 340]);
  const lower = bones.find((b) => b.id === "girl_bone_lower_arm_l")!;
  const r = validateScene({
    version: 1,
    meta: { title: "d", duration: 8, fps: 30, width: 400, height: 400 },
    layers: [
      { id: "cup", type: "image", pivot: [195, 195], params: { asset: "a", x: 188, y: 188, w: 14, h: 14 } },
      { id: "window", type: "image", pivot: [350, 80], params: { asset: "a", x: 320, y: 40, w: 60, h: 80 } },
      { id: "girl", type: "group", pivot: [150, 340] },
      { id: "girl_body", type: "image", parent: "girl", pivot: [150, 220], params: { asset: "a", x: 110, y: 120, w: 80, h: 200 } },
      ...bones,
      { id: "hand_target", type: "group", pivot: boneTip(lower) },
    ],
    assets: { a: { src: "/a.png", width: 4, height: 4 } },
    ik: [{ id: "arm_ik", upper: "girl_bone_upper_arm_l", lower: "girl_bone_lower_arm_l", target: "hand_target", mix: 0 }],
  });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.spec;
}

const GOOD = {
  summary: "She looks at her cup, reaches for it, then looks out of the window.",
  clips: [
    { clip: "idle", character: "girl", start: 0 },
    { clip: "look_at", character: "girl", start: 0.5, target: "cup" },
    { clip: "reach", character: "girl", start: 1, target: "cup" },
    { clip: "look_at", character: "girl", start: 4, target: "window" },
  ],
};
const answers = (list: unknown[]) => {
  const asked: string[] = [];
  const p: Provider = { name: "mock", model: "mock", generateJSON: async (a) => (asked.push(a.user), JSON.stringify(list.shift())) };
  return { p, asked };
};

describe("Motion Director", () => {
  it("tells the planner what each character's rig can do", () => {
    const d = describeScene(scene());
    expect(d).toMatch(/character "girl": skeleton \(20 bones, legs\); IK on lower_arm_l; no face overlays/);
    expect(d).toMatch(/things: cup, window/);
  });

  it("applies a good plan as one new scene, leaving the given scene untouched", async () => {
    const s = scene();
    const before = JSON.stringify(s);
    const { p, asked } = answers([GOOD]);
    const r = await directMotion(s, "she reaches for her tea", p);
    expect(asked).toHaveLength(1);
    expect(r.direction.clips).toHaveLength(4);
    expect(new Set(r.spec.actions!.map((a) => a.clip)).size).toBe(4);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("sends back a plan that breaks the motion principles, with what to fix", async () => {
    const lazy = { ...GOOD, clips: GOOD.clips.filter((c) => !(c.clip === "look_at" && c.target === "cup")) };
    const { p, asked } = answers([lazy, GOOD]);
    await directMotion(scene(), "she reaches for her tea", p);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatch(/should look at cup .* before reaching for it/);
  });

  it("catches unknown names, late one-shots, overlapping arm tasks and clips the rig can't do", () => {
    const d = (clips: unknown[]) => directionProblems(scene(), DirectionSchema.parse({ summary: "x", clips })).join("\n");
    expect(d([{ clip: "look_at", character: "girl", start: 1, target: "moon" }])).toMatch(/"moon" is not in the scene/);
    expect(d([{ clip: "idle", character: "cat", start: 0 }])).toMatch(/"cat" is not a rigged character/);
    expect(d([{ clip: "look_at", character: "girl", start: 1, target: "cup" }, { clip: "sip", character: "girl", start: 6, target: "cup" }])).toMatch(/must start by 4.5s/);
    expect(d([{ clip: "write", character: "girl", start: 0, end: 4 }, { clip: "look_at", character: "girl", start: 1, target: "cup" }, { clip: "reach", character: "girl", start: 2, target: "cup" }])).toMatch(/one arm task at a time/);
    expect(d([{ clip: "tail_sway", character: "girl", start: 0 }])).toMatch(/no tail bones/);
  });

  it("refuses to direct a scene with no rigged character", async () => {
    const s = { ...scene(), layers: scene().layers.filter((l) => l.type !== "bone" && l.id !== "hand_target"), ik: [] };
    await expect(directMotion(s, "dance", answers([]).p)).rejects.toThrow(/no rigged character/);
  });
});
