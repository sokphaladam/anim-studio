import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { actionOffsets, apply, compileActions, createRenderer, evalTrack, fitPeriod, imageSources, layerMatrix, registerImage, validateScene, MAX_TURN } from "../src";
import type { SceneSpec, SceneSpecInput } from "@anim/spec";
import { factory, hashes } from "./helpers";

/** A solid-color image registered under src, so image layers can draw it. */
function solid(src: string, w: number, h: number, color: string) {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  registerImage(src, c);
  return { src, width: w, height: h };
}

/** Girl-on-balcony shaped rig: background, clock, character group → body → head (+ awake head). */
export function rigScene(): SceneSpecInput {
  return {
    version: 1,
    meta: { title: "rig", duration: 6, fps: 30, width: 320, height: 180 },
    layers: [
      { id: "balcony_background", type: "image", params: { asset: "bg", w: 320, h: 180 } },
      { id: "clock", type: "image", params: { asset: "clock", x: 40, y: 20, w: 30, h: 30 } },
      { id: "girl", type: "group", pivot: [200, 160] },
      { id: "girl_body", type: "image", parent: "girl", params: { asset: "body", x: 150, y: 120, w: 100, h: 40 } },
      { id: "girl_head", type: "image", parent: "girl_body", pivot: [150, 130], params: { asset: "head", x: 120, y: 115, w: 30, h: 30 } },
    ],
    assets: {
      bg: solid("/t/bg.png", 32, 18, "#203040"),
      clock: solid("/t/clock.png", 8, 8, "#f0e0c0"),
      body: solid("/t/body.png", 10, 4, "#c04070"),
      head: solid("/t/head.png", 6, 6, "#f0c0a0"),
    },
    actions: [{ id: "look", type: "look_at", part: "girl_head", target: "clock", start: 3, end: 5 }],
  };
}

const valid = (input: unknown) => {
  const r = validateScene(input);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.spec;
};
const errorsOf = (input: unknown) => {
  const r = validateScene(input);
  return r.ok ? [] : r.errors;
};

describe("layered scene spec", () => {
  it("a rigged scene validates; old scenes without assets still do", () => {
    expect(errorsOf(rigScene())).toEqual([]);
    expect(errorsOf({ version: 1, meta: { title: "x", duration: 2, width: 10, height: 10 }, layers: [{ id: "a", type: "paper" }] })).toEqual([]);
  });

  it("rejects missing assets, unknown parents and circular parents", () => {
    const s = rigScene();
    s.layers[1].params = { asset: "nope", w: 1, h: 1 };
    expect(errorsOf(s).join()).toMatch(/Unknown asset "nope"/);
    const p = rigScene();
    p.layers[3].parent = "ghost";
    expect(errorsOf(p).join()).toMatch(/Unknown parent layer "ghost"/);
    const c = rigScene();
    c.layers[2].parent = "girl_head";
    expect(errorsOf(c).join()).toMatch(/circular parents/);
  });

  it("rejects actions outside the scene or aimed at nothing", () => {
    const s = rigScene();
    s.actions = [{ id: "look", type: "look_at", part: "girl_head", target: "moon", start: 3, end: 7 }];
    const e = errorsOf(s).join("\n");
    expect(e).toMatch(/Unknown target layer "moon"/);
    expect(e).toMatch(/past the 6s duration/);
  });

  it("image layers list their assets for loading", () => {
    expect(imageSources(valid(rigScene()))).toEqual(["/t/bg.png", "/t/clock.png", "/t/body.png", "/t/head.png"]);
  });
});

describe("rig transforms", () => {
  it("a child follows its parent and rotates about its own pivot", () => {
    const s = valid(rigScene());
    s.layers[2] = { ...s.layers[2], transform: { x: 10, y: -5, rotation: 0, scale: 1 } };
    s.layers[4] = { ...s.layers[4], transform: { x: 0, y: 0, rotation: Math.PI / 2, scale: 1 } };
    const head = s.layers[4];
    // the pivot stays put (plus the group's move); a point right of it swings below it
    expect(apply(layerMatrix(s, head, 0, factory), 150, 130).map((v) => +v.toFixed(6))).toEqual([160, 125]);
    expect(apply(layerMatrix(s, head, 0, factory), 160, 130).map((v) => +v.toFixed(6))).toEqual([160, 135]);
    // the background is not moved by the character
    expect(layerMatrix(s, s.layers[0], 0, factory)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("draw order is the layers order, regardless of parents", () => {
    const s = valid(rigScene());
    const canvas = createCanvas(320, 180);
    const g = canvas.getContext("2d");
    createRenderer(canvas, s, { createCanvas: factory }).render(0);
    // head (last) is drawn over the body where they overlap
    expect([...g.getImageData(148, 125, 1, 1).data.slice(0, 3)]).toEqual([0xf0, 0xc0, 0xa0]);
  });
});

describe("look_at", () => {
  const compiled = () => compileActions(valid(rigScene()), factory);

  it("starts at its start time, reaches the final pose at its end and holds instead of looping", () => {
    const s = compiled();
    const tr = s.tracks["look-rotation"];
    expect(s.actions![0].tracks).toEqual({ rotation: "look-rotation" });
    // the part keeps its own transform; the action adds on top
    expect(s.layers[4].transform).toBeUndefined();
    const at = (t: number) => evalTrack(tr, t);
    expect(at(0)).toBe(0);
    expect(at(2.9)).toBe(0);
    expect(at(3)).toBe(0);
    expect(Math.abs(at(4))).toBeGreaterThan(0);
    expect(Math.abs(at(4))).toBeLessThan(Math.abs(at(5)));
    expect(at(5.9)).toBe(at(5));
    expect(at(6)).toBe(at(5));
    expect(Math.abs(at(5))).toBeLessThanOrEqual(MAX_TURN + 1e-9);
  });

  it("turns toward the target (the clock is up-left of a head that points left: the head tips up)", () => {
    const s = compiled();
    const head = s.layers.find((l) => l.id === "girl_head")!;
    const crown0 = apply(layerMatrix(s, head, 0, factory), 120, 130);
    const crown5 = apply(layerMatrix(s, head, 5, factory), 120, 130);
    expect(crown5[1]).toBeLessThan(crown0[1]);
  });

  it("hold returns to rest after the hold time", () => {
    const s = valid(rigScene());
    s.actions = [{ ...s.actions![0], end: 4, hold: 5 }];
    const tr = compileActions(s, factory).tracks["look-rotation"];
    expect(evalTrack(tr, 4.5)).toBe(evalTrack(tr, 4));
    expect(evalTrack(tr, 6)).toBe(0);
  });

  it("refuses to invent a target", () => {
    const s = valid(rigScene());
    const bad = { ...s, actions: [{ ...s.actions![0], target: "moon" }] } as SceneSpec;
    expect(() => compileActions(bad, factory)).toThrow(/unknown target layer "moon"/);
  });

  it("renders identically at the same t in any scrubbing order; background and clock don't move", () => {
    const s = compiled();
    const times = [2.9, 3, 4, 5, 5.9];
    const forward = hashes(s, times, undefined, [320, 180]);
    expect(hashes(s, [5.9, 3, 4, 2.9, 5], undefined, [320, 180])).toEqual([forward[4], forward[1], forward[2], forward[0], forward[3]]);
    expect(forward[0]).toBe(forward[1]); // still asleep up to 3s
    expect(new Set(forward.slice(1, 4)).size).toBe(3); // turning
    expect(forward[3]).toBe(forward[4]); // held
    expect(layerMatrix(s, s.layers[1], 4, factory)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe("looping actions", () => {
  const withActions = (actions: NonNullable<SceneSpecInput["actions"]>) => {
    const s = rigScene();
    s.actions = actions;
    return compileActions(valid(s), factory);
  };

  it("loops repeat exactly at a period that divides the scene, so the video loops seamlessly", () => {
    expect(fitPeriod(4, 6)).toBe(3);
    expect(fitPeriod(5, 6)).toBe(6);
    expect(fitPeriod(1.2, 6)).toBe(1.2);
    expect(fitPeriod(2.5, 6)).toBe(3);
    const s = withActions([{ id: "breath", type: "breathe", part: "girl_body" }, { id: "nod", type: "bob", part: "girl_head", period: 1.3 }, { id: "rock", type: "sway", part: "clock" }]);
    for (const t of [0.1, 0.77, 2.2])
      for (const id of ["girl_body", "girl_head", "clock"]) {
        const [a, b] = [actionOffsets(s, id, t)!, actionOffsets(s, id, t + 6)!];
        for (const k of ["x", "y", "rotation", "scale", "opacity"] as const) expect(b[k]).toBeCloseTo(a[k], 12);
      }
    expect(actionOffsets(s, "girl_head", 6)!.rotation).toBeCloseTo(actionOffsets(s, "girl_head", 0)!.rotation, 12);
    expect(actionOffsets(s, "girl_body", 2)!.scale).toBeGreaterThan(0);
    expect(actionOffsets(s, "girl_head", 0.65)!.rotation).toBeGreaterThan(0);
  });

  it("actions add up: a head can bob and look at the clock at once, on top of its own transform", () => {
    const s = withActions([{ id: "look", type: "look_at", part: "girl_head", target: "clock", start: 3, end: 5 }, { id: "nod", type: "bob", part: "girl_head", period: 1.2 }]);
    const look = evalTrack(s.tracks["look-rotation"], 5.3), nod = evalTrack(s.tracks["nod-rotation"], 5.3);
    expect(actionOffsets(s, "girl_head", 5.3)!.rotation).toBeCloseTo(look + nod, 9);
  });

  it("blink shows the overlay briefly once per cycle", () => {
    const s = withActions([{ id: "blink", type: "blink", part: "clock", period: 3 }]);
    const shut = [0, 0.5, 1, 1.5, 2, 2.5, 2.85, 2.95].map((t) => actionOffsets(s, "clock", t)!.opacity);
    expect(shut.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(shut[6]).toBe(1);
    expect(actionOffsets(s, "clock", 5.85)!.opacity).toBe(1);
  });

  it("a path goes out through its points and comes back to rest by its end", () => {
    const s = withActions([{ id: "walk", type: "path", part: "girl", start: 1, end: 5, points: [[200, 160], [260, 160], [260, 100]] }]);
    const at = (t: number) => { const o = actionOffsets(s, "girl", t)!; return [Math.round(o.x), Math.round(o.y)]; };
    expect(at(0.5)).toEqual([0, 0]);
    expect(at(3)).toEqual([60, -60]);
    expect(at(5)).toEqual([0, 0]);
    expect(at(6)).toEqual([0, 0]);
    // painted facing right: mirrored only while it walks back left
    const flip = (t: number) => actionOffsets(s, "girl", t)!.flip;
    expect([flip(0.5), flip(2), flip(3.5), flip(4.9), flip(5.5)]).toEqual([0, 0, 0, 1, 0]); // the climb down keeps its facing
    const g = s.layers.find((l) => l.id === "girl")!;
    expect(apply(layerMatrix(s, g, 4.9, factory), 210, 160)[0]).toBeLessThan(apply(layerMatrix(s, g, 2, factory), 210, 160)[0]);
  });

  it("swing reaches toward its target and comes back each cycle", () => {
    const s = withActions([{ id: "sip", type: "swing", part: "girl_head", target: "clock", period: 6 }]);
    expect(actionOffsets(s, "girl_head", 0)!.rotation).toBe(0);
    expect(Math.abs(actionOffsets(s, "girl_head", 4)!.rotation)).toBeGreaterThan(0.1);
    expect(actionOffsets(s, "girl_head", 5.5)!.rotation).toBe(0);
  });

  it("a scene with loops renders identically at the same t, and at t and t + one cycle", () => {
    const s = withActions([{ id: "breath", type: "breathe", part: "girl_body", period: 3 }, { id: "rock", type: "sway", part: "clock", period: 3 }]);
    const [a, b, c] = hashes(s, [1.1, 4.1, 1.1], undefined, [320, 180]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});
