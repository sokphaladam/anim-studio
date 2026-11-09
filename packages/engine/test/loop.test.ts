import { createCanvas } from "@napi-rs/canvas";
import type { SceneSpec, SceneSpecInput } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { compileActions, createRenderer, fixLoop, loopReport, registerImage, validateScene } from "../src";
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
  return compileActions(r.spec, factory);
};

/** A lofi loop: a breathing, nodding girl in the rain with dust and a pushing camera; everything fitted to 6 s. */
function lofi(extra: Partial<SceneSpecInput> = {}): SceneSpec {
  return valid({
    version: 1,
    meta: { title: "loop", duration: 6, fps: 30, width: 320, height: 180 },
    layers: [
      { id: "room", type: "image", plane: "background", params: { asset: "room", w: 320, h: 180 } },
      { id: "clock", type: "image", params: { asset: "clock", x: 30, y: 20, w: 30, h: 30 } },
      { id: "rain", type: "rain", params: { x1: 320, y1: 180, intensity: 1 } },
      { id: "dust", type: "dust", params: { x1: 320, y1: 180 } },
      { id: "girl", type: "group", pivot: [160, 170], shadow: { amount: 0.5 } },
      { id: "girl_body", type: "image", parent: "girl", params: { asset: "body", x: 140, y: 100, w: 40, h: 70 } },
      { id: "girl_head", type: "image", parent: "girl_body", pivot: [160, 100], params: { asset: "head", x: 145, y: 70, w: 30, h: 30 } },
      { id: "girl_smile", type: "image", parent: "girl_head", params: { asset: "clock", x: 152, y: 90, w: 16, h: 4 } },
    ],
    assets: { room: solid("/lp/room.png", 32, 18, "#304050"), clock: solid("/lp/clock.png", 4, 4, "#f0e0c0"), body: solid("/lp/body.png", 4, 7, "#c04070"), head: solid("/lp/head.png", 3, 3, "#f0c0a0") },
    actions: [
      { id: "breathe", type: "breathe", part: "girl_body", start: 0 },
      { id: "bob", type: "bob", part: "girl_head", start: 0, period: 1.5 },
    ],
    camera: { motion: { kind: "push", amount: 0.5 }, parallax: 0.3 },
    look: { vignette: 0.3, fog: { amount: 0.3, color: "#a0b0d0", near: 0.4 } },
    switches: [{ id: "girl_mouth", kind: "mouth", character: "girl", options: { neutral: null, smile: "girl_smile" }, keys: [[0, "neutral"], [2, "smile"], [4, "neutral"]] }],
    ...extra,
  });
}

const frames = (spec: SceneSpec, times: number[]) => {
  const c = createCanvas(160, 90);
  const r = createRenderer(c, spec, { createCanvas: factory });
  return times.map((t) => (r.render(t), new Uint8Array(c.getContext("2d").getImageData(0, 0, 160, 90).data)));
};
const diff = (a: Uint8Array, b: Uint8Array) => {
  let d = 0;
  for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return d / ((a.length / 4) * 3);
};

describe("loop validation", () => {
  it("a scene built to loop passes, and three plays in a row have no jump at the seams", () => {
    const s = lofi();
    const r = loopReport(s, { make: factory, render: true });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    // play it three times over: frame i shows (i mod N)/fps; the step into each new cycle is like any other step
    const N = 180, times = Array.from({ length: N * 3 }, (_, i) => (i % N) / 30).filter((_, i) => i % N > N - 4 || i % N < 3);
    const f = frames(s, times);
    const steps = f.slice(1).map((x, i) => diff(f[i], x));
    const seams = steps.filter((_, i) => times[i + 1] === 0);
    const usual = steps.filter((_, i) => times[i + 1] !== 0).sort((a, b) => a - b)[Math.floor(steps.length / 2)];
    expect(seams).toHaveLength(2);
    for (const s2 of seams) expect(s2).toBeLessThanOrEqual(Math.max(1, usual * 3));
  });

  it("names a look_at that holds to the end, a track that doesn't come back, and a face left changed; fixLoop repairs them", () => {
    const s = lofi({
      tracks: { slide: { keys: [[0, 0], [5, 40]], ease: "inOut" } },
      layers: lofi().layers.map((l) => (l.id === "clock" ? { ...l, transform: { x: "@slide" } } : l)),
      actions: [...lofi().actions!.map((a) => ({ ...a, tracks: undefined })), { id: "look", type: "look_at", part: "girl_head", target: "clock", start: 2, end: 3 }],
      switches: [{ id: "girl_mouth", kind: "mouth", character: "girl", options: { neutral: null, smile: "girl_smile" }, keys: [[0, "neutral"], [2, "smile"]] }],
    });
    const r = loopReport(s, { make: factory });
    expect(r.ok).toBe(false);
    const by = (kind: string) => r.issues.find((i) => i.kind === kind);
    expect(by("action")).toMatchObject({ id: "look", at: 3, message: expect.stringMatching(/look_at on girl_head.*hold time/) });
    expect(by("track")).toMatchObject({ id: "slide", at: 5, message: expect.stringMatching(/used by clock/) });
    expect(by("switch")).toMatchObject({ id: "girl_mouth", message: expect.stringMatching(/"smile" at the end/) });
    // the moved clock is explained by its track, not reported again as a layer
    expect(r.issues.filter((i) => i.id === "clock")).toEqual([]);
    const fixed = fixLoop(s, factory);
    expect(fixed.fixed).toHaveLength(3);
    const after = loopReport(validateScene(fixed.spec).ok ? fixed.spec : (() => { throw new Error("invalid"); })(), { make: factory, render: true });
    expect(after.issues).toEqual([]);
    expect(fixLoop(fixed.spec, factory).fixed).toEqual([]);
  });

  it("catches an object whose own animation doesn't fit the scene (snow repeating every 4 s in 6 s)", () => {
    const s = lofi({ layers: [...lofi().layers, { id: "snow", type: "snow", params: { x1: 320, y1: 180, period: 4 } }] });
    const r = loopReport(s, { make: factory, render: true });
    expect(r.issues.find((i) => i.id === "snow")).toMatchObject({ level: "error", kind: "layer" });
  });

  it("warns about a hitch: same place at the seam, different speed", () => {
    const s = lofi({ tracks: { glide: { keys: [[0, 0], [6, 0]], ease: "linear" }, x: { keys: [[0, 0], [3, 30], [6, 0]], ease: "linear" } }, layers: lofi().layers.map((l) => (l.id === "clock" ? { ...l, transform: { x: "@x" } } : l)) });
    const r = loopReport(s, { make: factory });
    expect(r.issues.find((i) => i.id === "clock")).toMatchObject({ level: "warning", message: expect.stringMatching(/hitches/) });
    expect(r.ok).toBe(true);
  });
});
