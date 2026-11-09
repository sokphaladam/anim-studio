import type { SceneSpec } from "@anim/spec";
import { expect, it } from "vitest";
import { clipChecks, sceneChecks, worst, type ClipStats } from "../src";

const scene = (layers: unknown[], assets: Record<string, unknown> = { a: { src: "/api/images/a.png", width: 10, height: 10 } }) =>
  ({ version: 1, meta: { title: "t", duration: 6, fps: 30, width: 1280, height: 720 }, palette: {}, tracks: {}, overlays: [], beats: [], layers, assets }) as unknown as SceneSpec;
const img = (extra: Record<string, unknown> = {}) => ({ id: "head", type: "image", params: { asset: "a", x: 100, y: 100, w: 50, h: 50 }, ...extra });

it("passes a sound scene", () => {
  expect(sceneChecks(scene([img({ pivot: [125, 150] })]))).toEqual([]);
});

it("rejects broken references and flags implausible rigs and parts", () => {
  expect(worst(sceneChecks(scene([img({ params: { asset: "missing", x: 0, y: 0, w: 1, h: 1 } })])))).toBe("fail");
  expect(worst(sceneChecks(scene([img(), img({ id: "hand", parent: "nope" })])))).toBe("fail");
  const flagged = sceneChecks(scene([img({ pivot: [900, 600] })], { a: { src: "/api/images/a.png", width: 10, height: 10, review: "uncertain mask" } }));
  expect(flagged.map((i) => [i.target, i.name, i.status])).toEqual([["a", "asset", "review"], ["head", "pivot", "review"]]);
});

const stats = (o: Partial<ClipStats> = {}, sample: Partial<ClipStats["samples"][number]> = {}): ClipStats => ({ count: 144, fps: 24, width: 1280, height: 704, samples: [0, 1.5, 3, 4.5, 6].map((at) => ({ at, mean: 0.4, spread: 0.2, jump: 0.02, ...sample })), ...o });
const want = { seconds: 6, aspect: 16 / 9 };

it("passes a clip that matches its shot", () => expect(clipChecks(stats(), want)).toEqual([]));

it("rejects clips of the wrong length or shape, blank clips, and flags flicker", () => {
  expect(clipChecks(stats({ count: 48 }), want).map((c) => c.name)).toEqual(["duration"]);
  expect(clipChecks(stats({ width: 720, height: 1280 }), want).map((c) => c.name)).toEqual(["size"]);
  expect(clipChecks(stats({}, { spread: 0.001 }), want)[0]).toMatchObject({ name: "blank", status: "fail" });
  expect(clipChecks(stats({}, { jump: 0.3 }), want)[0]).toMatchObject({ name: "flicker", status: "review" });
  expect(worst(clipChecks(stats({ count: 0 }), want))).toBe("fail");
});
