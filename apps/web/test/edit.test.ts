import { validateScene } from "@anim/engine";
import type { SceneSpec, Stroke } from "@anim/spec";
import { beforeEach, describe, expect, it } from "vitest";
import { useStudio } from "../src/store";
import { addStroke, deleteFrame, deleteLayer, duplicateFrame, insertBlankFrame, moveFrame, renameLayer, setDuration, setTransform, transformStroke } from "../src/store/edit";
import { visibleSpec } from "../src/canvas/CanvasView";
import { blankScene } from "../src/store/scenes";

const dot = (x: number): Stroke => ({ tool: "brush", preset: "ink", color: "#000000", size: 4, points: [[x, 10, 0.5]] });
const frames = (s: SceneSpec) => s.layers.find((l) => l.id === "drawing-1")!.frames!.map((f) => [Math.round(f.start * s.meta.fps), f.strokes.length]);
const valid = (s: SceneSpec) => {
  const r = validateScene(s);
  expect(r.ok ? [] : r.errors).toEqual([]);
};

describe("drawing edits", () => {
  const base = blankScene("16:9"); // 24 fps

  it("auto-frame starts a new drawing on an empty frame; otherwise the held drawing is edited", () => {
    let s = addStroke(base, "drawing-1", 0, dot(1), true);
    s = addStroke(s, "drawing-1", 3, dot(2), true);
    s = addStroke(s, "drawing-1", 3, dot(3), true);
    expect(frames(s)).toEqual([[0, 1], [3, 2]]);
    s = addStroke(s, "drawing-1", 5, dot(4), false);
    expect(frames(s)).toEqual([[0, 1], [3, 3]]);
    valid(s);
  });

  it("keeps untouched frames identical (engine caches stay valid)", () => {
    const a = addStroke(base, "drawing-1", 0, dot(1), true);
    const b = addStroke(a, "drawing-1", 4, dot(2), true);
    expect(b.layers[1].frames![0]).toBe(a.layers[1].frames![0]);
  });

  it("insert, duplicate, delete and move frames", () => {
    let s = addStroke(base, "drawing-1", 0, dot(1), true);
    expect(insertBlankFrame(s, "drawing-1", 0)).toBeNull();
    s = insertBlankFrame(s, "drawing-1", 2)!;
    expect(frames(s)).toEqual([[0, 1], [2, 0]]);
    s = duplicateFrame(s, "drawing-1", 0)!; // on a key: copies to the next frame
    expect(frames(s)).toEqual([[0, 1], [1, 1], [2, 0]]);
    expect(moveFrame(s, "drawing-1", 1, 2)).toBeNull(); // occupied
    s = moveFrame(s, "drawing-1", 1, 5)!;
    expect(frames(s)).toEqual([[0, 1], [2, 0], [5, 1]]);
    s = deleteFrame(s, "drawing-1", 2)!;
    expect(frames(s)).toEqual([[0, 1], [5, 1]]);
    expect(deleteFrame(s, "drawing-1", 3)).toBeNull();
    valid(s);
  });

  it("auto-key turns transform changes into keyframes", () => {
    let s = setTransform(base, "drawing-1", { x: 0 }, 0, true);
    s = setTransform(s, "drawing-1", { x: 300 }, 24, true);
    const l = s.layers[1];
    expect(l.transform?.x).toBe("@drawing-1-x");
    expect(s.tracks["drawing-1-x"].keys).toEqual([[0, 0], [1, 300]]);
    // without auto-key a static value is just set
    expect(setTransform(base, "drawing-1", { y: 5 }, 10, false).layers[1].transform?.y).toBe(5);
    valid(s);
  });

  it("transforms stroke geometry about a center", () => {
    const s = transformStroke({ tool: "brush", preset: "ink", color: "#000000", size: 2, points: [[2, 0, 0.5]] }, 0, 0, 2, Math.PI / 2, [0, 0]);
    if (s.tool !== "brush") throw new Error();
    expect(s.size).toBe(4);
    expect(s.points[0][0]).toBeCloseTo(0);
    expect(s.points[0][1]).toBeCloseTo(4);
  });
});

describe("history", () => {
  beforeEach(() => useStudio.getState().open(blankScene("16:9"), "drawing-1"));

  it("undoes and redoes any step, and a new edit clears redo", () => {
    const st = () => useStudio.getState();
    const s0 = st().spec!;
    st().commit("a", addStroke(s0, "drawing-1", 0, dot(1), true));
    const s1 = st().spec!;
    st().commit("b", addStroke(s1, "drawing-1", 1, dot(2), true));
    st().undo();
    expect(st().spec).toBe(s1);
    st().undo();
    expect(st().spec).toBe(s0);
    st().redo();
    expect(st().spec).toBe(s1);
    st().commit("c", addStroke(s1, "drawing-1", 2, dot(3), true));
    expect(st().future).toEqual([]);
  });

  it("a drag is one step", () => {
    const st = () => useStudio.getState();
    const s0 = st().spec!;
    st().beginGesture();
    for (let x = 0; x < 5; x++) st().preview(setTransform(s0, "drawing-1", { x }, 0, false));
    st().endGesture("Move");
    expect(st().past.length).toBe(1);
    st().undo();
    expect(st().spec).toBe(s0);
  });
});

describe("scene length", () => {
  it("lengthens without touching content", () => {
    const s = setDuration(blankScene("16:9"), 30);
    expect(s.meta.duration).toBe(30);
    valid(s);
  });

  it("shortening drops what falls past the end and stays valid", async () => {
    const { EXAMPLES } = await import("../src/store/scenes");
    const autumn = EXAMPLES[0].load();
    const s = setDuration(autumn, 5);
    expect(s.meta.duration).toBe(5);
    expect(s.beats.every((b) => b.at <= 5)).toBe(true);
    expect(s.tracks.fade.keys.at(-1)).toEqual([5, 1]);
    valid(s);
    let d = addStroke(blankScene("16:9"), "drawing-1", 200, dot(1), true); // frame 200 at 24 fps = 8.3s
    d = setDuration(d, 5);
    expect(d.layers[1].frames).toEqual([]);
    valid(d);
  });
});

describe("rigged layers", () => {
  const rig = (): SceneSpec => {
    const r = validateScene({
      version: 1,
      meta: { title: "rig", duration: 6, fps: 30, width: 320, height: 180 },
      layers: [
        { id: "clock", type: "image", params: { asset: "clock", w: 10, h: 10 } },
        { id: "girl", type: "group" },
        { id: "girl_body", type: "image", parent: "girl", params: { asset: "body", w: 10, h: 10 } },
        { id: "girl_head", type: "image", parent: "girl_body", pivot: [5, 9], params: { asset: "head", w: 10, h: 10 } },
      ],
      assets: { clock: { src: "/api/images/a.png", width: 1, height: 1 }, body: { src: "/api/images/b.png", width: 1, height: 1 }, head: { src: "/api/images/c.png", width: 1, height: 1 } },
      actions: [{ id: "look", type: "look_at", part: "girl_head", target: "clock", start: 3, end: 5 }],
    });
    if (!r.ok) throw new Error(r.errors.join());
    return r.spec;
  };

  it("renaming a parent or a target keeps the rig and actions pointing at it", () => {
    const s = renameLayer(renameLayer(rig(), "girl_body", "body"), "clock", "wall_clock");
    expect(s.layers.find((l) => l.id === "girl_head")!.parent).toBe("body");
    expect(s.actions![0].target).toBe("wall_clock");
    valid(s);
  });

  it("deleting a parent moves its parts up; deleting a target drops its action", () => {
    let s = deleteLayer(rig(), "girl_body");
    expect(s.layers.find((l) => l.id === "girl_head")!.parent).toBe("girl");
    valid(s);
    s = deleteLayer(rig(), "clock");
    expect(s.actions).toEqual([]);
    valid(s);
  });

  it("hiding a group hides its parts, not the rest", () => {
    expect(visibleSpec(rig(), { girl: true }).layers.map((l) => l.id)).toEqual(["clock"]);
    expect(visibleSpec(rig(), { girl_head: true }).layers.map((l) => l.id)).toEqual(["clock", "girl", "girl_body"]);
  });

  it("asset references survive undo and redo", () => {
    const st = useStudio.getState();
    st.open(rig());
    st.commit("Move clock", setTransform(useStudio.getState().spec!, "clock", { x: 20 }, 0, false));
    st.commit("Delete head", deleteLayer(useStudio.getState().spec!, "girl_head"));
    st.undo();
    st.undo();
    expect(useStudio.getState().spec).toEqual(rig());
    st.redo();
    expect(useStudio.getState().spec!.assets).toEqual(rig().assets);
    valid(useStudio.getState().spec!);
  });
});
