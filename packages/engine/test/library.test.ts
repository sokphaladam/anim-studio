import type { SceneSpec } from "@anim/spec";
import { describe, expect, it } from "vitest";
import { catalog, validateScene } from "../src";
import { hashes, loadExample } from "./helpers";

// one object on a plain background, as a 12 s scene
const scene = (type: string, params: Record<string, unknown>): SceneSpec => {
  const r = validateScene({ version: 1, meta: { title: type, duration: 12, fps: 30, width: 1280, height: 720 }, layers: [{ id: "bg", type: "paper", params: { color: "#202030" } }, { id: "it", type, params }] });
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.spec;
};
const NEW = ["clouds", "snow", "fireflies", "wall-clock", "bookshelf", "owl"];

describe("library growth", () => {
  it("every new object is in the AI catalog with its description", () => {
    const c = catalog();
    for (const type of NEW) expect(c).toContain(type);
  });

  it("the demo scenes use every new object and animate", () => {
    const used = new Set(["snowy-owl", "reading-room"].flatMap((n) => loadExample(n).layers.map((l) => l.type)));
    for (const type of NEW) expect(used).toContain(type);
    for (const n of ["snowy-owl", "reading-room"]) {
      const s = loadExample(n);
      const [a, mid] = hashes(s, [1, 6]);
      expect(mid).not.toBe(a);
    }
  });

  it.each([
    ["snow", { period: 6 }, 6],
    ["fireflies", { period: 6 }, 6],
    ["clouds", { period: 12 }, 12],
    ["owl", { x: 640, y: 500, blinkEvery: 4, tiltEvery: 6 }, 12],
  ])("%s moves and repeats exactly every period", (type, params, period) => {
    // from 0: the scene is 12 s and render clamps t to the duration
    const [a, b, c] = hashes(scene(type, params), [0, period / 3, period]);
    expect(b).not.toBe(a);
    expect(c).toBe(a);
  });

  it("the wall clock's hands move with speed and stand still at speed 0", () => {
    const [a, b] = hashes(scene("wall-clock", { x: 640, y: 360, radius: 120, time: 3, speed: 30 }), [0, 4]);
    expect(b).not.toBe(a);
    const [c, d] = hashes(scene("wall-clock", { x: 640, y: 360, radius: 120, time: 3, speed: 0 }), [0, 4]);
    expect(d).toBe(c);
    // 3:00 plus 30 clock-minutes per second for 2 s is 4:00
    expect(hashes(scene("wall-clock", { x: 640, y: 360, radius: 120, time: 3, speed: 30 }), [2])).toEqual(hashes(scene("wall-clock", { x: 640, y: 360, radius: 120, time: 4, speed: 0 }), [0]));
  });

  it("the bookshelf is the same for a seed and different for another", () => {
    const shelf = (seed: number) => hashes(scene("bookshelf", { x: 400, y: 650, seed }), [0])[0];
    expect(shelf(3)).toBe(shelf(3));
    expect(shelf(4)).not.toBe(shelf(3));
  });
});
