import { validateScene } from "@anim/engine";
import autumn from "@anim/spec/examples/autumn-window.json";
import { expect, it } from "vitest";
import { editScene, type Provider } from "../src";

const scene = (() => {
  const r = validateScene(autumn);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.spec;
})();
const windowIdx = scene.layers.findIndex((l) => l.type === "window");
const bird = { id: "bird", type: "drawing", params: {}, frames: [{ start: 0, strokes: [{ tool: "brush" as const, preset: "ink", color: "#2b2130", size: 6, points: [[400, 300, 0.5], [440, 290, 0.5]] as [number, number, number][] }] }] };
const withBird = { ...scene, layers: [...scene.layers, bird] };

function mock(answers: unknown[]): Provider & { calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  return { name: "mock", model: "mock", calls, generateJSON: async ({ system, user }) => (calls.push({ system, user }), JSON.stringify(answers.shift())) };
}

it("applies a valid patch and changes only that value", async () => {
  const p = mock([{ patch: [{ op: "replace", path: `/layers/${windowIdx}/params/fallSpeed`, value: 2 }] }]);
  const r = await editScene(scene, "make the leaves fall faster", p);
  expect(r.ok && r.patch).toEqual([{ op: "add", path: `/layers/${windowIdx}/params/fallSpeed`, value: 2 }]);
  expect(p.calls).toHaveLength(1);
});

it("hides strokes from the model, and animating a drawing adds a transform and track", async () => {
  const p = mock([{ patch: [{ op: "add", path: "/tracks/birdX", value: { keys: [[0, -400], [3, 800]], ease: "linear" } }, { op: "add", path: "/layers/9/transform", value: { x: "@birdX" } }].map((o) => (o.path.startsWith("/layers") ? { ...o, path: `/layers/${withBird.layers.length - 1}/transform` } : o)) }]);
  const r = await editScene(withBird, "make my bird fly left to right", p);
  expect(p.calls[0].system).toContain("1 hand-drawn frame(s), drawn within x 400..440, y 290..300");
  expect(p.calls[0].system).not.toContain("[400,300,0.5]");
  if (!r.ok) throw new Error(r.errors.join("\n"));
  expect(r.spec.layers.at(-1)?.transform?.x).toBe("@birdX");
  expect(r.spec.layers.at(-1)?.frames).toEqual(bird.frames);
  expect(r.patch.every((o) => o.path.startsWith("/tracks/birdX") || o.path.startsWith(`/layers/${withBird.layers.length - 1}/transform`))).toBe(true);
});

it("retries a broken patch with the errors, then falls back to the full spec", async () => {
  const full = JSON.parse(JSON.stringify(withBird));
  full.layers.at(-1).frames = "summary the model saw";
  full.palette.fox = "#000000";
  const p = mock([{ patch: [{ op: "replace", path: "/layers/99/params/x", value: 1 }] }, { patch: [{ op: "replace", path: "/layers/0/params/top", value: "$nope" }] }, full]);
  const r = await editScene(withBird, "make the fox black", p);
  expect(p.calls[1].user).toMatch(/previous patch failed/);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  expect(r.fullSpec).toBe(true);
  expect(r.patch).toEqual([{ op: "replace", path: "/palette/fox", value: "#000000" }]);
  expect(r.spec.layers.at(-1)?.frames).toEqual(bird.frames); // real strokes restored
});

it("refuses patches that touch stroke data", async () => {
  const p = mock([{ patch: [{ op: "remove", path: `/layers/${withBird.layers.length - 1}/frames/0` }] }, { patch: [] }]);
  const r = await editScene(withBird, "erase the bird", p);
  expect(p.calls[1].user).toMatch(/frames can't be edited/);
  expect(r.ok && r.patch).toEqual([]);
});
