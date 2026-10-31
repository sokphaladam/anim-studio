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
