import { createCanvas } from "@napi-rs/canvas";
import type { SceneSpec, SceneSpecInput } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { apply, cameraMatrix, createRenderer, depthOf, registerImage, validateScene, type RenderOptions } from "../src";
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

/** A wall far back, a lamp-lit window, a girl in the middle, a plant up front. */
function shot(extra: Partial<SceneSpecInput> = {}): SceneSpec {
  return valid({
    version: 1,
    meta: { title: "shot", duration: 6, fps: 30, width: 320, height: 180 },
    tracks: { walk: { keys: [[0, 0], [6, 60]], ease: "linear" } },
    layers: [
      { id: "wall", type: "image", plane: "background", params: { asset: "wall", w: 320, h: 180 } },
      { id: "window", type: "image", plane: "background", params: { asset: "sky", x: 200, y: 20, w: 80, h: 70 } },
      { id: "girl", type: "group", plane: "midground", pivot: [120, 160] },
      { id: "girl_body", type: "image", parent: "girl", params: { asset: "body", x: 100, y: 80, w: 40, h: 80 } },
      { id: "plant", type: "image", plane: "foreground", params: { asset: "plant", x: 10, y: 110, w: 40, h: 70 } },
    ],
    assets: { wall: solid("/l/wall.png", 32, 18, "#c8b89a"), sky: solid("/l/sky.png", 8, 7, "#ffffff"), body: solid("/l/body.png", 4, 8, "#3050a0"), plant: solid("/l/plant.png", 4, 7, "#2f6a3a") },
    ...extra,
  });
}
const FULL = {
  exposure: 0.2,
  contrast: 0.15,
  saturation: -0.1,
  temperature: 0.3,
  vignette: 0.4,
  bloom: { amount: 0.4, threshold: 0.7 },
  fog: { amount: 0.5, color: "#a0b0d0", near: 0.3 },
  dof: { amount: 0.8, focus: 0.5 },
  light: { color: "#ffd9a0", amount: 0.3, direction: 250 },
};

const pixels = (spec: SceneSpec, t: number, opts?: RenderOptions, size: [number, number] = [320, 180]) => {
  const c = createCanvas(...size);
  createRenderer(c, spec, { createCanvas: factory }).render(t, opts);
  return c.getContext("2d").getImageData(0, 0, ...size).data;
};
const px = (d: Uint8ClampedArray, x: number, y: number, w = 320) => [...d.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((v, i) => v === b[i]);

describe("depth and camera", () => {
  it("planes give depths; children inherit their parent's", () => {
    const s = shot();
    const L = (id: string) => s.layers.find((l) => l.id === id)!;
    expect([depthOf(s, L("wall")), depthOf(s, L("girl_body")), depthOf(s, L("plant"))]).toEqual([0.9, 0.5, 0.15]);
  });

  it("the camera's move is cyclic, and with parallax near planes travel further than far ones", () => {
    const s = shot({ camera: { motion: { kind: "pan", amount: 1 }, parallax: 0.8 } });
    const L = (id: string) => s.layers.find((l) => l.id === id)!;
    expect(cameraMatrix(s, L("plant"), 0)).toEqual(cameraMatrix(s, L("plant"), 6).map((v, i) => (Math.abs(v - cameraMatrix(s, L("plant"), 0)[i]) < 1e-9 ? cameraMatrix(s, L("plant"), 0)[i] : v)));
    const shift = (id: string) => Math.abs(apply(cameraMatrix(s, L(id), 1.5), 0, 0)[0]);
    expect(shift("plant")).toBeGreaterThan(shift("wall") * 2);
    // without a camera nothing changes
    expect(cameraMatrix(shot(), L("plant"), 1.5)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("cover fills a canvas of another shape around the focus; contain letterboxes", () => {
    const s = shot({ camera: { focus: [120, 120] } });
    const tall = pixels(s, 0, { fit: "cover" }, [90, 160]);
    expect(px(tall, 45, 2, 90)).not.toEqual([0, 0, 0]); // no bars
    expect(px(tall, 45, 80, 90)).toEqual([48, 80, 160]); // the girl (at the focus) is in the middle
    const boxed = pixels(s, 0, {}, [90, 160]);
    expect(px(boxed, 45, 2, 90)).toEqual([0, 0, 0]);
  });
});

describe("the look", () => {
  it("is deterministic and render order doesn't matter", () => {
    const s = shot({ look: FULL, camera: { motion: { kind: "drift", amount: 0.5 }, parallax: 0.5 } });
    const [a, b, c] = hashes(s, [2, 4, 2], undefined, [320, 180]);
    expect(a).toBe(c);
    expect(a).not.toBe(b);
  });

  it("each effect switches off on its own: off equals the look without it", () => {
    for (const [k, effect] of [["bloom", "bloom"], ["fog", "fog"], ["dof", "dof"], ["light", "light"]] as const) {
      const { [k]: _gone, ...rest } = FULL;
      void _gone;
      expect(same(pixels(shot({ look: FULL }), 1, { off: [effect] }), pixels(shot({ look: rest }), 1))).toBe(true);
    }
  });

  it("fog pulls far planes toward its color and leaves near ones; light tints everything alike", () => {
    const plain = pixels(shot(), 1), foggy = pixels(shot({ look: { fog: { amount: 0.6, color: "#a0b0d0", near: 0.3 } } }), 1);
    expect(px(foggy, 5, 5)).not.toEqual(px(plain, 5, 5)); // the wall
    expect(px(foggy, 20, 150)).toEqual(px(plain, 20, 150)); // the plant
    const lit = pixels(shot({ look: { light: { color: "#ff8000", amount: 1 } } }), 1);
    expect(px(lit, 5, 5)[2]).toBe(0); // no blue in an orange light
  });

  it("depth of field softens the far window's edge and keeps the in-focus girl sharp", () => {
    const edge = (d: Uint8ClampedArray) => px(d, 199, 50)[0];
    const sharp = pixels(shot(), 1), soft = pixels(shot({ look: { dof: { amount: 1, focus: 0.5 } } }), 1);
    expect(edge(soft)).toBeGreaterThan(edge(sharp));
    expect(px(soft, 99, 120)).toEqual(px(sharp, 99, 120));
    // draft skips the blur; balanced and final sample it differently but stay close
    expect(same(pixels(shot({ look: { dof: { amount: 1, focus: 0.5 } } }), 1, { quality: "draft" }), sharp)).toBe(true);
    const bal = pixels(shot({ look: { dof: { amount: 1, focus: 0.5 } } }), 1, { quality: "balanced" });
    expect(Math.abs(edge(bal) - edge(soft))).toBeLessThan(40);
  });
});

describe("shadows, clipping and loops", () => {
  it("a contact shadow stays under the feet as the character walks", () => {
    const s = shot({ layers: shot().layers.map((l) => (l.id === "girl" ? { ...l, shadow: { amount: 1 }, transform: { x: "@walk" } } : l)) });
    const darkest = (d: Uint8ClampedArray) => {
      // along the row just under the feet (y = 161), right of the foreground plant, the darkest point
      let best = 0, bx = 0;
      for (let x = 60; x < 320; x++) {
        const v = 600 - px(d, x, 161).reduce((a, b) => a + b, 0);
        if (v > best) [best, bx] = [v, x];
      }
      return bx;
    };
    const a = darkest(pixels(s, 0)), b = darkest(pixels(s, 3));
    expect(b - a).toBeGreaterThan(25);
    expect(b - a).toBeLessThan(35); // moved with her 30 units
    expect(same(pixels(s, 3, { off: ["shadows"] }), pixels(shot({ layers: shot().layers.map((l) => (l.id === "girl" ? { ...l, transform: { x: "@walk" } } : l)) }), 3))).toBe(true);
  });

  it("a clipped layer only draws inside its clip layer (rain on the window, not the wall)", () => {
    const rain = { id: "rain", type: "window-rain", clip: "window", params: { x0: 0, y0: 0, x1: 320, y1: 180, intensity: 2 } };
    const s = shot({ layers: [...shot().layers, rain] });
    const without = pixels(shot(), 2), withRain = pixels(s, 2);
    for (let y = 0; y < 180; y += 3)
      for (let x = 0; x < 320; x += 3) {
        const inWindow = x >= 200 && x < 280 && y >= 20 && y < 90;
        if (!inWindow) expect(px(withRain, x, y)).toEqual(px(without, x, y));
      }
    const r = validateScene({ ...shot(), layers: [...shot().layers, { ...rain, clip: "nope" }] });
    expect(r.ok ? "" : r.errors.join()).toMatch(/Unknown clip layer "nope"/);
  });

  it("rain, dust, flicker and window rain are back where they started when the scene loops", () => {
    for (const type of ["rain", "dust", "flicker", "window-rain"]) {
      const s = valid({ version: 1, meta: { title: "p", duration: 6, width: 160, height: 90 }, layers: [{ id: "p", type, params: type === "flicker" ? { x: 80, y: 45, radius: 60 } : { x1: 160, y1: 90 } }] });
      const [start, end, mid] = hashes(s, [0, 6, 2.2], undefined, [160, 90]);
      expect(start, type).toBe(end);
      expect(start, type).not.toBe(mid);
    }
  });
});
