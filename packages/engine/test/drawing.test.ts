import { createCanvas } from "@napi-rs/canvas";
import type { SceneSpec } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { createRenderer, frameIndexAt, validateScene } from "../src";
import { factory, hashes, loadExample } from "./helpers";

const pixel = (spec: SceneSpec, t: number, x: number, y: number) => {
  const c = createCanvas(spec.meta.width, spec.meta.height);
  createRenderer(c, spec, { createCanvas: factory }).render(t);
  return [...c.getContext("2d").getImageData(x, y, 1, 1).data];
};

const ring = (cx: number, cy: number, r: number) => Array.from({ length: 25 }, (_, a) => [cx + Math.cos((a / 24) * Math.PI * 2) * r, cy + Math.sin((a / 24) * Math.PI * 2) * r, 0.5] as [number, number, number]);
const scene = (strokes: unknown[]) => {
  const r = validateScene({
    version: 1,
    meta: { title: "t", duration: 1, fps: 12, width: 200, height: 200 },
    layers: [
      { id: "bg", type: "paper", params: { color: "#ffffff" } },
      { id: "d", type: "drawing", frames: [{ start: 0, strokes }] },
    ],
  });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.spec;
};

describe("drawing layers", () => {
  it("every brush preset paints its own way", () => {
    // pressure varies along the line so thinning shows
    const line = Array.from({ length: 30 }, (_, i) => [20 + i * 5, 100 + Math.sin(i / 3) * 20, 0.2 + (i % 10) / 12] as [number, number, number]);
    const look = (preset: string) => hashes(scene([{ tool: "brush", preset, color: "#203040", size: 14, points: line }]), [0], undefined, [200, 200])[0];
    const all = ["pencil", "ink", "brush-pen", "marker", "wash", "airbrush"].map(look);
    expect(new Set(all).size).toBe(all.length);
  });

  it("holds a frame until the next one starts", () => {
    const f = [{ start: 0, strokes: [] }, { start: 0.5, strokes: [] }];
    expect([frameIndexAt(f, 0), frameIndexAt(f, 0.49), frameIndexAt(f, 0.5), frameIndexAt(f, 0.9)]).toEqual([0, 0, 1, 1]);
    expect(frameIndexAt([{ start: 0.2, strokes: [] }], 0.1)).toBe(-1);
  });

  it("fill stays inside a closed outline", () => {
    const s = scene([{ tool: "brush", color: "#000000", size: 4, points: ring(100, 100, 50) }, { tool: "fill", at: [100, 100], color: "#ff0000" }]);
    expect(pixel(s, 0, 100, 100)).toEqual([255, 0, 0, 255]);
    expect(pixel(s, 0, 10, 10)).toEqual([255, 255, 255, 255]);
  });

  it("eraser removes earlier strokes on its own layer only", () => {
    const line = { tool: "brush", color: "#000000", size: 10, points: [[20, 100, 0.5], [180, 100, 0.5]] };
    const s = scene([line, { tool: "eraser", size: 30, points: [[100, 100, 0.5]] }]);
    expect(pixel(s, 0, 100, 100)).toEqual([255, 255, 255, 255]); // erased back to the paper below
    expect(pixel(s, 0, 40, 100)[0]).toBeLessThan(40);
  });

  it("onion skin changes the editor view but rendering without it is unchanged", () => {
    const spec = loadExample("bouncing-ball");
    const onion = { before: 2, after: 2, opacity: 0.4, beforeColor: "#ff5d6c", afterColor: "#3ccf91" };
    const [plain] = hashes(spec, [0.5]);
    expect(hashes(spec, [0.5], { onion })[0]).not.toBe(plain);
    expect(hashes(spec, [0.5])[0]).toBe(plain);
  });

  it("rejects out-of-order frames and frames on object layers", () => {
    const bad = validateScene({
      version: 1,
      meta: { title: "t", duration: 1, width: 10, height: 10 },
      layers: [
        { id: "d", type: "drawing", frames: [{ start: 0.5, strokes: [] }, { start: 0.2, strokes: [] }] },
        { id: "p", type: "paper", frames: [] },
      ],
    });
    expect(bad.ok ? [] : bad.errors.join("\n")).toMatch(/time order[\s\S]*Only drawing layers/);
  });
});
