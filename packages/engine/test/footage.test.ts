import { createCanvas } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import { createRenderer, frameUrl, imageSources, registerImage, validateScene } from "../src";

// 10 one-color frames at 10 fps: a 1 s clip in a 2 s scene, so it loops
const frames = "/test-clip/";
for (let i = 0; i < 10; i++) {
  const c = createCanvas(4, 4);
  const g = c.getContext("2d");
  g.fillStyle = `rgb(${i * 25},0,0)`;
  g.fillRect(0, 0, 4, 4);
  registerImage(frameUrl(frames, i), c);
}
const spec = (() => {
  const r = validateScene({ version: 1, meta: { title: "clip", duration: 2, fps: 30, width: 4, height: 4 }, layers: [{ id: "v", type: "footage", params: { frames, count: 10, fps: 10, crossfade: 0.2 } }] });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.spec;
})();
const red = (t: number) => {
  const c = createCanvas(4, 4);
  createRenderer(c, spec, { createCanvas: (w, h) => createCanvas(w, h) }).render(t);
  return c.getContext("2d").getImageData(1, 1, 1, 1).data[0];
};

it("lists every frame for preloading", () => {
  expect(imageSources(spec)).toHaveLength(10);
  expect(imageSources(spec)[0]).toBe("/test-clip/001.jpg");
});

it("plays frame by frame, loops, and crossfades the end into the start", () => {
  expect(red(0.05)).toBe(0);
  expect(red(0.35)).toBe(75);
  expect(red(1.35)).toBe(75); // second time round
  // 0.1 s into the 0.2 s crossfade: halfway between frame 9 (225) and frame 0 (0)
  expect(red(0.9)).toBeGreaterThan(100);
  expect(red(0.9)).toBeLessThan(125);
});

it("a placed clip plays once in its window, trimmed, over the layers below", () => {
  // starts at 0.5 s, skips 0.2 s of the clip and cuts 0.3 s off its end: frames 2–6 play from 0.5 s to 1 s
  const r = validateScene({ version: 1, meta: { title: "shot", duration: 2, fps: 30, width: 4, height: 4 }, layers: [
    { id: "bg", type: "paper", params: { color: "#0000ff" } },
    { id: "v", type: "footage", params: { frames, count: 10, fps: 10, start: 0.5, trimIn: 0.2, trimOut: 0.3, loop: false, shot: "scene" } },
  ] });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  const px = (t: number) => {
    const c = createCanvas(4, 4);
    createRenderer(c, r.spec, { createCanvas: (w, h) => createCanvas(w, h) }).render(t);
    return [...c.getContext("2d").getImageData(1, 1, 1, 1).data.slice(0, 3)];
  };
  expect(px(0.2)[2]).toBeGreaterThan(200); // before it: the paper
  expect(px(0.55)).toEqual([50, 0, 0]); // frame 2
  expect(px(0.95)).toEqual([150, 0, 0]); // frame 6
  expect(px(1.2)[2]).toBeGreaterThan(200); // after it: the paper again, no loop
});

it("a held clip shows each drawing for a while, as hand animation does", () => {
  const r = validateScene({ version: 1, meta: { title: "held", duration: 4, fps: 30, width: 4, height: 4 }, layers: [{ id: "v", type: "footage", params: { frames, count: 10, fps: 10, crossfade: 0, hold: 2.5 } }] });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  const at = (t: number) => {
    const c = createCanvas(4, 4);
    createRenderer(c, r.spec, { createCanvas: (w, h) => createCanvas(w, h) }).render(t);
    return c.getContext("2d").getImageData(1, 1, 1, 1).data[0];
  };
  // 2.5 drawings a second: frame 0 holds until 0.4 s, then frame 4
  expect([0.05, 0.35, 0.45, 0.75].map(at)).toEqual([0, 0, 100, 100]);
});

it("a ping-pong clip plays forward then backward, so its end meets its start", () => {
  const r = validateScene({ version: 1, meta: { title: "pp", duration: 4, fps: 30, width: 4, height: 4 }, layers: [{ id: "v", type: "footage", params: { frames, count: 10, fps: 10, pingpong: true } }] });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  const at = (t: number) => {
    const c = createCanvas(4, 4);
    createRenderer(c, r.spec, { createCanvas: (w, h) => createCanvas(w, h) }).render(t);
    return c.getContext("2d").getImageData(1, 1, 1, 1).data[0];
  };
  expect(at(0.35)).toBe(75); // forward: frame 3
  expect(at(1.65)).toBe(75); // backward: 0.35 s before the 2 s cycle ends, frame 3 again
  expect(at(2.05)).toBe(0); // the next cycle starts where the last one ended
});
