import { createCanvas } from "@napi-rs/canvas";
import type { SceneSpec, SceneSpecInput } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { applyExpression, applyPose, compileActions, createRenderer, evalTrack, layerMatrix, MAX_GAZE, poseProblems, registerImage, skeleton, switchVisibility, validateScene } from "../src";
import { factory } from "./helpers";

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

/** A face: head with eye-state and mouth overlays switched by face slots, irises, a cup to look at, a side view. */
function face(extra: Partial<SceneSpecInput> = {}): SceneSpecInput {
  return {
    version: 1,
    meta: { title: "face", duration: 6, fps: 30, width: 320, height: 200 },
    layers: [
      { id: "cup", type: "image", params: { asset: "cup", x: 280, y: 100, w: 20, h: 20 } },
      { id: "girl", type: "group", pivot: [100, 190] },
      { id: "girl_body", type: "image", parent: "girl", params: { asset: "body", x: 70, y: 110, w: 60, h: 80 } },
      { id: "girl_head", type: "image", parent: "girl_body", pivot: [100, 110], params: { asset: "head", x: 75, y: 60, w: 50, h: 50 } },
      { id: "girl_eyes_closed", type: "image", parent: "girl_head", params: { asset: "lids", x: 85, y: 78, w: 30, h: 6 } },
      { id: "girl_mouth_smile", type: "image", parent: "girl_head", params: { asset: "smile", x: 92, y: 96, w: 16, h: 4 } },
      { id: "girl_irises", type: "image", parent: "girl_head", params: { asset: "iris", x: 88, y: 79, w: 24, h: 4 } },
      { id: "girl_head_profile", type: "image", parent: "girl_body", pivot: [100, 110], params: { asset: "head", x: 75, y: 60, w: 50, h: 50 } },
    ],
    assets: {
      cup: solid("/f/cup.png", 4, 4, "#ffffff"),
      body: solid("/f/body.png", 6, 8, "#c04070"),
      head: solid("/f/head.png", 5, 5, "#f0c0a0"),
      lids: solid("/f/lids.png", 6, 2, "#603020"),
      smile: solid("/f/smile.png", 4, 1, "#a02020"),
      iris: solid("/f/iris.png", 6, 1, "#203040"),
    },
    switches: [
      { id: "girl_eyes", kind: "eyes", character: "girl", options: { open: null, closed: "girl_eyes_closed" }, keys: [[0, "open"]] },
      { id: "girl_mouth", kind: "mouth", character: "girl", options: { neutral: null, smile: "girl_mouth_smile" }, keys: [[0, "neutral"]] },
      { id: "girl_view", kind: "view", character: "girl", options: { front: "girl_head", profile: "girl_head_profile" }, keys: [[0, "front"]], fade: 0.5 },
    ],
    ...extra,
  };
}

const pixels = (spec: SceneSpec, t: number) => {
  const c = createCanvas(320, 200);
  createRenderer(c, spec, { createCanvas: factory }).render(t);
  return c.getContext("2d").getImageData(0, 0, 320, 200).data;
};

describe("switches", () => {
  it("shows one option at a time, cross-fades, and hides everything under a hidden option", () => {
    const s = valid(face());
    const sw = (keys: [number, string][]) => ({ ...s, switches: s.switches!.map((w) => (w.id === "girl_view" ? { ...w, keys } : w)) });
    const v = sw([[0, "front"], [2, "profile"]]);
    const L = (id: string) => v.layers.find((l) => l.id === id)!;
    expect(switchVisibility(v, L("girl_head"), 1)).toBe(1);
    expect(switchVisibility(v, L("girl_head_profile"), 1)).toBe(0);
    expect(switchVisibility(v, L("girl_head"), 2.25)).toBeCloseTo(0.5);
    expect(switchVisibility(v, L("girl_head_profile"), 2.25)).toBeCloseTo(0.5);
    expect(switchVisibility(v, L("girl_head_profile"), 3)).toBe(1);
    // the front face's overlays go with the front head
    expect(switchVisibility(v, L("girl_irises"), 3)).toBe(0);
    expect(switchVisibility(v, L("girl_body"), 3)).toBe(1);
  });

  it("closing the eyes changes only the eye area: the rest of the face is untouched", () => {
    const open = valid(face());
    const shut = applyExpression(open, "girl", "eyes-closed", 0).spec;
    const a = pixels(open, 1), b = pixels(shut, 1);
    // eye overlay: x 85..115, y 78..84 in scene units = pixels here (scene 320×200 drawn at 320×200)
    for (let i = 0; i < a.length; i += 4) {
      const x = (i / 4) % 320, y = Math.floor(i / 4 / 320);
      const inEyes = x >= 84 && x <= 116 && y >= 77 && y <= 85;
      if (!inEyes) expect(a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]).toBe(true);
    }
    expect(a.some((v, i) => v !== b[i])).toBe(true);
  });
});

describe("expressions", () => {
  it("keys every face slot, and reports slots whose art lacks the option", () => {
    const r = applyExpression(valid(face()), "girl", "surprised", 2);
    expect(r.spec.switches!.find((w) => w.id === "girl_eyes")!.keys).toEqual([[0, "open"], [2, "open"]]);
    expect(r.spec.switches!.find((w) => w.id === "girl_mouth")!.keys).toEqual([[0, "neutral"], [2, "neutral"]]);
    expect(r.missing).toEqual(["eyes: wide", "mouth: open"]);
    const happy = applyExpression(valid(face()), "girl", "happy", 1).spec;
    expect(happy.switches!.find((w) => w.id === "girl_mouth")!.keys.at(-1)).toEqual([1, "smile"]);
    valid(happy);
  });
});

describe("gaze", () => {
  it("slides the irises toward the target, within bounds, without turning the head or body", () => {
    const s = valid(face({ actions: [{ id: "g", type: "gaze", part: "girl_irises", target: "cup", start: 1, end: 1.3 }] }));
    const c = compileActions(s);
    const a = c.actions![0];
    const dx = evalTrack(c.tracks[a.tracks!.x!], 3), dy = evalTrack(c.tracks[a.tracks!.y!], 3);
    expect(dx).toBeGreaterThan(0); // the cup is to the right
    expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(MAX_GAZE * 24 + 1e-9);
    expect(evalTrack(c.tracks[a.tracks!.x!], 0.5)).toBe(0);
    const head = c.layers.find((l) => l.id === "girl_head")!;
    expect(layerMatrix(c, head, 3)).toEqual(layerMatrix(c, head, 0));
  });

  it("validation: a gaze needs a target and an end", () => {
    const r = validateScene(face({ actions: [{ id: "g", type: "gaze", part: "girl_irises", start: 1 }] }));
    expect(r.ok ? "" : r.errors.join()).toMatch(/needs a target[\s\S]*needs an end/);
  });
});

describe("poses", () => {
  const rigged = () => {
    const s = valid(face());
    return valid({ ...s, layers: [...s.layers, ...skeleton("human", "girl_bone", "girl", [70, 60, 130, 190])], characters: { girl: { name: "girl", look: "girl", palette: { c1: "#c04070" }, proportions: { aspect: 0.5 } } } });
  };

  it("keys every bone to the preset by the end of the transition, and never touches assets or the profile", () => {
    const s = rigged();
    const r = applyPose(s, "girl", "sipping", 1, { duration: 0.5 });
    const rot = (id: string, t: number) => {
      const v = r.spec.layers.find((l) => l.id === id)!.transform!.rotation;
      return typeof v === "string" ? evalTrack(r.spec.tracks[v.slice(1)], t) : v;
    };
    expect(rot("girl_bone_lower_arm_l", 1)).toBe(0);
    expect(rot("girl_bone_lower_arm_l", 1.5)).toBeCloseTo(-1.6);
    expect(rot("girl_bone_upper_leg_r", 1.5)).toBe(0);
    expect(r.spec.switches!.find((w) => w.id === "girl_eyes")!.keys.at(-1)).toEqual([1, "closed"]);
    expect(r.spec.assets).toEqual(s.assets);
    expect(r.spec.characters).toEqual(s.characters);
    valid(r.spec);
    // back to rest
    const back = applyPose(r.spec, "girl", "rest", 3, { duration: 0.5 });
    const v = back.spec.layers.find((l) => l.id === "girl_bone_lower_arm_l")!.transform!.rotation as string;
    expect(evalTrack(back.spec.tracks[v.slice(1)], 3.5)).toBe(0);
  });

  it("looking: turns the head a little and adds a gaze when there are irises; no skeleton is reported", () => {
    const r = applyPose(rigged(), "girl", "looking", 1, { duration: 0.6, target: "cup" });
    expect(r.spec.actions!.some((a) => a.type === "gaze" && a.target === "cup")).toBe(true);
    valid(r.spec);
    expect(applyPose(valid(face()), "girl", "rest", 0).notes.join()).toMatch(/no skeleton/);
  });
});

describe("pose problems", () => {
  it("warns when a look_at needs more turn than a flat head allows, unless a side view is keyed", () => {
    const look = { id: "look", type: "look_at" as const, part: "girl_head", target: "cup", start: 1, end: 2 };
    // the cup is level with the head's center: turning toward it from pointing up needs ~90°
    const plain = valid(face({ actions: [look], switches: [] }));
    expect(poseProblems(plain, factory).map((p) => p.message).join()).toMatch(/generate a three-quarter view/);
    const unkeyed = valid(face({ actions: [look] }));
    expect(poseProblems(unkeyed, factory).map((p) => p.message).join()).toMatch(/key "girl_view" to a side view/);
    const keyed = valid({ ...face({ actions: [look] }), switches: face().switches!.map((w) => (w.id === "girl_view" ? { ...w, keys: [[0, "front"], [1.5, "profile"]] } : w)) });
    expect(poseProblems(keyed, factory)).toEqual([]);
  });

  it("validation: unknown options and layers switched twice are rejected", () => {
    const errs = (sw: unknown) => {
      const r = validateScene({ ...face(), switches: sw });
      return r.ok ? "" : r.errors.join("\n");
    };
    expect(errs([{ id: "a", options: { x: "nope" }, keys: [[0, "x"]] }])).toMatch(/Unknown layer "nope"/);
    expect(errs([{ id: "a", options: { x: "girl_head" }, keys: [[0, "y"]] }])).toMatch(/Unknown option "y"/);
    expect(errs([{ id: "a", options: { x: "girl_head" }, keys: [[0, "x"]] }, { id: "b", options: { y: "girl_head" }, keys: [[0, "y"]] }])).toMatch(/already switched/);
  });
});
