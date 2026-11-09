import { createCanvas } from "@napi-rs/canvas";
import type { SceneSpec, SceneSpecInput } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { apply, boneTip, createRenderer, layerMatrix, meshPose, mirrorBone, registerImage, rigProblems, skeleton, validateScene } from "../src";
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

/**
 * An arm: shoulder at (100, 100), elbow at (160, 100), hand at (220, 100), on a body group that can move. The arm image
 * spans the whole limb; `mesh` makes it bend with the bones.
 */
function arm(o: { mesh?: boolean; lower?: number; ik?: { target: [number, number]; parented?: boolean; bend?: 1 | -1; mix?: number }; bodyX?: SceneSpecInput["tracks"] } = {}): SceneSpecInput {
  return {
    version: 1,
    meta: { title: "arm", duration: 4, fps: 30, width: 320, height: 200 },
    tracks: o.bodyX ?? {},
    layers: [
      { id: "body", type: "group", pivot: [100, 100], ...(o.bodyX && { transform: { x: "@move" } }) },
      { id: "upper", type: "bone", parent: "body", pivot: [100, 100], params: { length: 60 } },
      { id: "lower", type: "bone", parent: "upper", pivot: [160, 100], params: { length: 60, min: -2, max: 2 }, ...(o.lower !== undefined && { transform: { rotation: o.lower } }) },
      { id: "arm", type: "image", parent: "body", params: { asset: "arm", x: 100, y: 90, w: 120, h: 20 }, ...(o.mesh && { mesh: { bones: ["upper", "lower"], cols: 12, rows: 2 } }) },
      ...(o.ik ? [{ id: "hand_target", type: "group", ...(o.ik.parented && { parent: "body" }), pivot: o.ik.target }] : []),
    ],
    assets: { arm: solid("/t/arm.png", 120, 20, "#d07040") },
    ...(o.ik && { ik: [{ id: "arm_ik", upper: "upper", lower: "lower", target: "hand_target", bend: o.ik.bend ?? 1, mix: o.ik.mix ?? 1 }] }),
  };
}

/** Where the end of the lower bone (the hand) is in the scene at t. */
const hand = (spec: SceneSpec, t = 0) => apply(layerMatrix(spec, spec.layers.find((l) => l.id === "lower")!, t), ...boneTip(spec.layers.find((l) => l.id === "lower")!));
const elbow = (spec: SceneSpec, t = 0) => apply(layerMatrix(spec, spec.layers.find((l) => l.id === "upper")!, t), 160, 100);
const close = (a: number[], b: number[], tol = 1e-3) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(tol);

describe("bones (FK) and joint limits", () => {
  it("rotating the lower bone swings the hand about the elbow; limits clamp it", () => {
    close(hand(valid(arm())), [220, 100]);
    close(hand(valid(arm({ lower: Math.PI / 2 }))), [160, 160]);
    // max is 2 rad: asking for 3 stops at 2
    const h = hand(valid(arm({ lower: 3 })));
    close(h, [160 + 60 * Math.cos(2), 100 + 60 * Math.sin(2)]);
  });
});

describe("two-bone IK", () => {
  it("puts the hand on the target, and a scene-root target stays put while the body moves", () => {
    const move = { move: { keys: [[0, 0], [4, 30]] as [number, number][], ease: "linear" as const } };
    const spec = valid(arm({ ik: { target: [180, 150] }, bodyX: move }));
    for (const t of [0, 1, 2.5, 4]) close(hand(spec, t), [180, 150]);
    // the shoulder did move with the body
    close(apply(layerMatrix(spec, spec.layers.find((l) => l.id === "upper")!, 4), 100, 100), [130, 100]);
  });

  it("a target parented to the body travels with it", () => {
    const move = { move: { keys: [[0, 0], [4, 30]] as [number, number][], ease: "linear" as const } };
    const spec = valid(arm({ ik: { target: [180, 150], parented: true }, bodyX: move }));
    close(hand(spec, 4), [210, 150]);
  });

  it("bend picks the side the elbow goes to; mix 0 leaves the bones' own rotation", () => {
    const up = elbow(valid(arm({ ik: { target: [180, 40], bend: 1 } })));
    const down = elbow(valid(arm({ ik: { target: [180, 40], bend: -1 } })));
    expect(Math.sign(up[1] - down[1])).not.toBe(0);
    close(hand(valid(arm({ ik: { target: [180, 40] }, lower: 0.5 }))), [180, 40]);
    close(hand(valid(arm({ ik: { target: [180, 40], mix: 0 }, lower: 0.5 }))), hand(valid(arm({ lower: 0.5 }))));
  });

  it("an out-of-reach target straightens the limb toward it", () => {
    const h = hand(valid(arm({ ik: { target: [400, 100] } })));
    close(h, [220, 100], 0.01);
  });
});

describe("mesh deformation", () => {
  it("at rest the mesh is exactly the image; bending the elbow bends the image at the elbow, not the whole limb", () => {
    const rest = meshPose(valid(arm({ mesh: true })), valid(arm({ mesh: true })).layers[3], 0)!;
    rest.posed.forEach((p, i) => close(p, rest.rest[i]));

    const bent = valid(arm({ mesh: true, lower: 1.2 }));
    const pose = meshPose(bent, bent.layers[3], 0)!;
    const moved = (x: number) => {
      const i = pose.rest.findIndex((q) => Math.abs(q[0] - x) < 1e-6 && Math.abs(q[1] - 100) < 1e-6);
      return Math.hypot(pose.posed[i][0] - pose.rest[i][0], pose.posed[i][1] - pose.rest[i][1]);
    };
    expect(moved(100)).toBeLessThan(1); // shoulder end stays
    expect(moved(140)).toBeLessThan(5); // upper arm barely moves
    expect(moved(220)).toBeGreaterThan(50); // the hand swings round
    expect(moved(180)).toBeGreaterThan(moved(160)); // smooth, more toward the hand
    expect(rigProblems(bent, factory)).toEqual([]);
  });

  it("parts of the image far from the listed bones stay put", () => {
    const base = arm({ mesh: true, lower: 1.2 });
    const spec = valid({ ...base, layers: base.layers.map((l) => (l.id === "arm" ? { ...l, mesh: { bones: ["lower"], cols: 12, rows: 2 } } : l)) });
    const pose = meshPose(spec, spec.layers[3], 0)!;
    const moved = (x: number) => {
      const i = pose.rest.findIndex((q) => Math.abs(q[0] - x) < 1e-6 && Math.abs(q[1] - 100) < 1e-6);
      return Math.hypot(pose.posed[i][0] - pose.rest[i][0], pose.posed[i][1] - pose.rest[i][1]);
    };
    expect(moved(100)).toBeLessThan(moved(220) * 0.1);
    expect(moved(220)).toBeGreaterThan(50);
  });

  it("renders deterministically, and the bend shows up where a rigid image would not change", () => {
    const flat = valid(arm({ mesh: true }));
    const bent = valid(arm({ mesh: true, lower: 1.2 }));
    const a = hashes(bent, [0, 1, 0, 2], undefined, [320, 200]);
    expect(new Set(a).size).toBe(1);
    expect(hashes(flat, [0], undefined, [320, 200])[0]).not.toBe(a[0]);
    // a mesh-less image ignores bones it isn't parented to: the existing rigid behaviour
    expect(hashes(valid(arm({ lower: 1.2 })), [0], undefined, [320, 200])).toEqual(hashes(valid(arm()), [0], undefined, [320, 200]));
  });

  it("the mesh at rest draws the same picture as the plain image (no seams)", () => {
    const px = (spec: SceneSpec) => {
      const c = createCanvas(320, 200);
      createRenderer(c, spec, { createCanvas: factory }).render(0);
      return c.getContext("2d").getImageData(0, 0, 320, 200).data;
    };
    const a = px(valid(arm({ mesh: true }))), b = px(valid(arm()));
    let off = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) off++;
    expect(off).toBeLessThan(40); // only antialiased border pixels may differ
  });

  it("warns when a bend folds the mesh over itself", () => {
    // the top row follows the upper bone, the rest the lower one: bending the elbow turns the rows over each other
    const base = arm({ mesh: true, lower: 2 });
    const weights = Array.from({ length: 13 * 3 }, (_, i) => (i < 13 ? [1, 0] : [0, 1]));
    const folded = valid({ ...base, layers: base.layers.map((l) => (l.id === "arm" ? { ...l, mesh: { bones: ["upper", "lower"], cols: 12, rows: 2, weights } } : l)) });
    expect(rigProblems(folded, factory).map((p) => p.message).join()).toMatch(/folds over itself|stretches/);
  });
});

describe("templates, mirroring and diagnostics", () => {
  it("a human template is a connected skeleton with no problems; animal options add tail and ears", () => {
    const bones = skeleton("human", "girl", "girl", [100, 0, 200, 300], { hair: true });
    expect(bones.map((b) => b.id)).toEqual(expect.arrayContaining(["girl_hips", "girl_head", "girl_lower_arm_l", "girl_lower_arm_r", "girl_foot_r", "girl_hair_3"]));
    const spec = valid({ version: 1, meta: { title: "s", duration: 2, width: 300, height: 300 }, layers: [{ id: "girl", type: "group" }, ...bones] });
    expect(rigProblems(spec, factory)).toEqual([]);
    const cat = skeleton("animal", "cat", "cat", [0, 0, 100, 60], { tail: true, ears: true }).map((b) => b.id);
    expect(cat).toEqual(expect.arrayContaining(["cat_tail_3", "cat_ear_l", "cat_lower_back_leg"]));
  });

  it("mirrors a bone onto the other side about an axis", () => {
    const bones = skeleton("human", "g", "g", [100, 0, 200, 300]);
    const spec = valid({ version: 1, meta: { title: "s", duration: 2, width: 300, height: 300 }, layers: [{ id: "g", type: "group" }, ...bones] });
    const l = spec.layers.find((x) => x.id === "g_upper_arm_l")!;
    const moved = { ...spec, layers: spec.layers.map((x) => (x.id === l.id ? { ...x, params: { ...x.params, angle: 1, min: -0.5, max: 1.5 } } : x)) };
    const m = mirrorBone(moved, l.id, 150)!;
    const r = m.layers.find((x) => x.id === "g_upper_arm_r")!;
    expect(r.pivot).toEqual([300 - l.pivot![0], l.pivot![1]]);
    expect(r.params).toMatchObject({ angle: +(Math.PI - 1).toFixed(3), min: -1.5, max: 0.5 });
    expect(mirrorBone(moved, "g_hips", 150)).toBeNull();
  });

  it("flags a disconnected joint and IK that bends against the drawing", () => {
    const spec = valid({ ...arm({ ik: { target: [180, 150], bend: -1 } }), layers: arm({ ik: { target: [180, 150] } }).layers.map((l) => (l.id === "lower" ? { ...l, pivot: [175, 100] } : l)) });
    const msgs = rigProblems(spec, factory).map((p) => p.message).join("\n");
    expect(msgs).toMatch(/disconnected/);
    // straight arms have no drawn bend; bend a copy to see the check
    const drawnBent = valid({ ...arm({ ik: { target: [180, 150], bend: -1 } }), layers: arm({ ik: { target: [180, 150] } }).layers.map((l) => (l.id === "lower" ? { ...l, params: { length: 60, angle: 0.6 } } : l)) });
    expect(rigProblems(drawnBent, factory).map((p) => p.message).join()).toMatch(/opposite way/);
  });

  it("rejects bad rig references", () => {
    const base = arm({ mesh: true, ik: { target: [180, 150] } });
    const errors = (patch: (s: SceneSpecInput) => SceneSpecInput) => {
      const r = validateScene(patch(structuredClone(base)));
      return r.ok ? "" : r.errors.join("\n");
    };
    expect(errors((s) => ({ ...s, ik: [{ ...s.ik![0], lower: "body" }] }))).toMatch(/not a bone layer/);
    expect(errors((s) => ({ ...s, ik: [{ ...s.ik![0], upper: "lower", lower: "upper" }] }))).toMatch(/must be a child/);
    expect(errors((s) => ({ ...s, ik: [{ ...s.ik![0], target: "lower" }] }))).toMatch(/part of the limb/);
    expect(errors((s) => ({ ...s, layers: s.layers.map((l) => (l.id === "arm" ? { ...l, mesh: { bones: ["upper"], cols: 1, rows: 1, weights: [[1]] } } : l)) }))).toMatch(/Expected 4 vertex weights/);
    expect(errors((s) => ({ ...s, layers: s.layers.map((l) => (l.id === "upper" ? { ...l, pivot: undefined } : l)) }))).toMatch(/needs a pivot/);
    expect(errors((s) => ({ ...s, layers: s.layers.map((l) => (l.id === "body" ? { ...l, mesh: { bones: ["upper"] } } : l)) }))).toMatch(/Only image layers/);
  });
});
