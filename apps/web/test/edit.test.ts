import { apply, layerMatrix, validateScene } from "@anim/engine";
import type { SceneSpec, Stroke } from "@anim/spec";
import { beforeEach, describe, expect, it } from "vitest";
import { useStudio } from "../src/store";
import { addGaze, setClipWeight, setKeyEase, tracksOf, addIK, addSkeleton, addStroke, addView, removeAction, setSwitch, type ViewResponse, applyRecut, approveAsset, removeIK, reparentKeepingPlace, setBoneParams, setIK, setMesh, deleteFrame, deleteLayer, duplicateFrame, insertBlankFrame, moveFrame, profilesOf, renameLayer, setDuration, setTransform, transformStroke } from "../src/store/edit";
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

describe("part checks (M8)", () => {
  const spec = {
    version: 1,
    meta: { title: "t", duration: 4, fps: 24, width: 200, height: 200 },
    palette: {},
    tracks: {},
    overlays: [],
    beats: [],
    layers: [{ id: "head", type: "image", params: { asset: "head", x: 50, y: 20, w: 40, h: 20 } }],
    assets: {
      src: { src: "/a.png", width: 100, height: 100, kind: "source" },
      m: { src: "/m.png", width: 100, height: 100, kind: "mask", from: "src" },
      head: { src: "/h.png", width: 20, height: 10, kind: "image", from: "src", mask: "m", crop: [30, 40, 50, 50], review: "halo", approved: true },
    },
    characters: { girl: { name: "girl", look: "girl, hoodie", reference: "src", palette: {} } },
  } as unknown as SceneSpec;

  it("a re-cut keeps the part where it was in the scene and resets approval", () => {
    // the new crop starts 2 px further left/up and is 4 px bigger: 2 scene units per source px
    const next = applyRecut(spec, "head", { src: "/h2.png", width: 24, height: 14, crop: [28, 38, 52, 52], checks: [{ name: "edges", status: "pass" }], review: null }, { grow: 2, holes: 0, specks: 0, feather: 0 });
    expect(next.layers[0].params).toMatchObject({ x: 46, y: 16, w: 48, h: 28 });
    expect(next.assets!.head).toMatchObject({ src: "/h2.png", crop: [28, 38, 52, 52], cleanup: { grow: 2 } });
    expect(next.assets!.head.review).toBeUndefined();
    expect(next.assets!.head.approved).toBeUndefined();
    valid(next);
    expect(approveAsset(next, "head", true).assets!.head.approved).toBe(true);
  });

  it("hands saved profiles and only their reference paintings to the next generation", () => {
    expect(profilesOf(spec)).toEqual({ characters: spec.characters, assets: { src: spec.assets!.src } });
    expect(profilesOf({ ...spec, characters: undefined })).toEqual({});
  });
});

describe("rigging edits (M9)", () => {
  const base = {
    version: 1,
    meta: { title: "t", duration: 4, fps: 24, width: 400, height: 400 },
    palette: {},
    tracks: {},
    overlays: [],
    beats: [],
    layers: [{ id: "girl", type: "group", params: {}, pivot: [200, 380] }],
    assets: { body: { src: "/b.png", width: 10, height: 10, kind: "image" } },
  } as unknown as SceneSpec;
  const rigged = () => {
    const s = addSkeleton(base, "girl", "human", [150, 80, 250, 380])!;
    return { ...s, layers: [...s.layers, { id: "body", type: "image", parent: "girl", params: { asset: "body", x: 150, y: 80, w: 100, h: 300 }, mesh: { bones: ["girl_bone_upper_arm_l", "girl_bone_lower_arm_l"], cols: 8, rows: 8 } }] } as SceneSpec;
  };

  it("adds a skeleton once, parented to the character, and the scene stays valid", () => {
    const s = rigged();
    expect(s.layers.find((l) => l.id === "girl_bone_hips")?.parent).toBe("girl");
    expect(addSkeleton(s, "girl", "human", [0, 0, 1, 1])).toBeNull();
    valid(s);
  });

  it("adds IK with a target at the limb's end, flips and removes it (target and all)", () => {
    const r = addIK(rigged(), "girl_bone_lower_arm_l", 0)!;
    const ik = r.spec.ik![0];
    expect(ik).toMatchObject({ upper: "girl_bone_upper_arm_l", lower: "girl_bone_lower_arm_l", target: r.target });
    expect(r.spec.layers.find((l) => l.id === r.target)?.parent).toBeUndefined();
    valid(r.spec);
    expect(addIK(r.spec, "girl_bone_lower_arm_l", 0)).toBeNull();
    expect(addIK(r.spec, "girl_bone_hips", 0)).toBeNull(); // no bone parent: not a limb
    expect(setIK(r.spec, ik.id, { bend: -1 }).ik![0].bend).toBe(-1);
    const gone = removeIK(r.spec, ik.id);
    expect(gone.ik).toEqual([]);
    expect(gone.layers.some((l) => l.id === r.target)).toBe(false);
  });

  it("deleting or renaming a bone keeps IK chains and meshes valid", () => {
    const r = addIK(rigged(), "girl_bone_lower_arm_l", 0)!;
    const del = deleteLayer(r.spec, "girl_bone_upper_arm_l");
    expect(del.ik).toEqual([]);
    expect(del.layers.find((l) => l.id === "body")?.mesh?.bones).toEqual(["girl_bone_lower_arm_l"]);
    valid(del);
    const ren = renameLayer(r.spec, "girl_bone_lower_arm_l", "forearm");
    expect(ren.ik![0].lower).toBe("forearm");
    expect(ren.layers.find((l) => l.id === "body")?.mesh?.bones).toContain("forearm");
    valid(ren);
    const noMesh = deleteLayer(deleteLayer(rigged(), "girl_bone_upper_arm_l"), "girl_bone_lower_arm_l");
    expect(noMesh.layers.find((l) => l.id === "body")?.mesh).toBeUndefined();
  });

  it("re-parenting an IK target keeps it where it is on screen", () => {
    const r = addIK(rigged(), "girl_bone_lower_arm_l", 0)!;
    const moved = { ...r.spec, layers: r.spec.layers.map((l) => (l.id === "girl" ? { ...l, transform: { x: 30, y: -10, rotation: 0, scale: 1 } } : l)) } as SceneSpec;
    const at = (s: SceneSpec) => {
      const l = s.layers.find((x) => x.id === r.target)!;
      return apply(layerMatrix(s, l, 0), ...l.pivot!);
    };
    const follows = reparentKeepingPlace(moved, r.target, "girl", 0);
    expect(follows.layers.find((l) => l.id === r.target)?.parent).toBe("girl");
    expect(at(follows)[0]).toBeCloseTo(at(moved)[0], 1);
    expect(at(follows)[1]).toBeCloseTo(at(moved)[1], 1);
    valid(follows);
  });

  it("edits bone params and limits, and sets or clears a mesh", () => {
    let s = setBoneParams(rigged(), "girl_bone_lower_arm_l", { min: -1, max: 1.5 });
    expect(s.layers.find((l) => l.id === "girl_bone_lower_arm_l")?.params).toMatchObject({ min: -1, max: 1.5 });
    s = setBoneParams(s, "girl_bone_lower_arm_l", { min: undefined, max: undefined });
    expect("min" in s.layers.find((l) => l.id === "girl_bone_lower_arm_l")!.params).toBe(false);
    expect(setMesh(s, "body", null).layers.find((l) => l.id === "body")?.mesh).toBeUndefined();
    valid(s);
  });
});

describe("faces, views and gaze (M10)", () => {
  const base = () =>
    ({
      version: 1,
      meta: { title: "t", duration: 4, fps: 24, width: 400, height: 400 },
      palette: {},
      tracks: {},
      overlays: [],
      beats: [],
      layers: [
        { id: "clock", type: "image", params: { asset: "a", x: 300, y: 50, w: 40, h: 40 } },
        { id: "girl", type: "group", params: {} },
        { id: "girl_body", type: "image", parent: "girl", params: { asset: "a", x: 150, y: 200, w: 100, h: 150 } },
        { id: "girl_head", type: "image", parent: "girl_body", pivot: [200, 200], params: { asset: "a", x: 170, y: 140, w: 60, h: 60 } },
        { id: "girl_irises", type: "image", parent: "girl_head", params: { asset: "a", x: 180, y: 165, w: 40, h: 6 } },
        { id: "girl_mouth_smile", type: "image", parent: "girl_head", params: { asset: "a", x: 190, y: 185, w: 20, h: 5 } },
      ],
      assets: { a: { src: "/a.png", width: 10, height: 10, kind: "image" } },
      switches: [{ id: "girl_mouth", kind: "mouth", character: "girl", options: { neutral: null, smile: "girl_mouth_smile" }, keys: [[0, "neutral"]], fade: 0 }],
    }) as unknown as SceneSpec;
  const view: ViewResponse = {
    image: { src: "/v.png", width: 30, height: 40, crop: [10, 10, 40, 50], checks: [{ name: "identity", status: "pass" }], review: null },
    source: { src: "/vs.png", width: 100, height: 100 },
    mask: { src: "/vm.png", width: 100, height: 100 },
  };

  it("adds a painted view beside the head with a view switch starting on the front", () => {
    const s = addView(base(), "girl", "profile_left", view)!;
    const l = s.layers.find((x) => x.id === "girl_head_profile_left")!;
    expect(l).toMatchObject({ parent: "girl_body", pivot: [200, 200], params: { x: 177.5, y: 140, w: 45, h: 60 } }); // centred on the head (170 + 30 - 22.5)
    expect(s.switches!.find((w) => w.id === "girl_view")).toMatchObject({ kind: "view", options: { front: "girl_head", profile_left: "girl_head_profile_left" }, keys: [[0, "front"]] });
    valid(s);
    const two = addView(s, "girl", "three_quarter_left", view)!;
    expect(Object.keys(two.switches!.find((w) => w.id === "girl_view")!.options)).toEqual(["front", "profile_left", "three_quarter_left"]);
  });

  it("adds and removes a gaze (with its tracks)", () => {
    const s = addGaze(base(), "girl", "clock", 1)!;
    const a = s.actions![0];
    expect(a).toMatchObject({ type: "gaze", part: "girl_irises", target: "clock", start: 1 });
    expect(Object.values(a.tracks!).every((n) => n in s.tracks)).toBe(true);
    valid(s);
    const gone = removeAction(s, a.id);
    expect(gone.actions).toEqual([]);
    expect(Object.keys(gone.tracks)).toEqual([]);
  });

  it("deleting or renaming a switched layer keeps switches valid; setSwitch keeps keys sorted", () => {
    const del = deleteLayer(base(), "girl_mouth_smile");
    expect(del.switches).toEqual([]);
    valid(del);
    const ren = renameLayer(base(), "girl_mouth_smile", "smile");
    expect(ren.switches![0].options.smile).toBe("smile");
    valid(ren);
    const k = setSwitch(base(), "girl_mouth", { keys: [[2, "smile"], [0, "neutral"]] });
    expect(k.switches![0].keys).toEqual([[0, "neutral"], [2, "smile"]]);
  });
});

describe("motion edits (M11)", () => {
  const base = () =>
    ({
      version: 1,
      meta: { title: "t", duration: 4, fps: 24, width: 400, height: 400 },
      palette: {},
      tracks: { "head-rotation": { keys: [[0, 0], [1, 0.3], [2, 0]], ease: "inOut" }, "look-rotation": { keys: [[0, 0], [1, 0.2]], ease: "inOut" } },
      overlays: [],
      beats: [],
      layers: [{ id: "head", type: "image", transform: { x: 0, y: 0, rotation: "@head-rotation", scale: 1 }, params: { asset: "a", x: 0, y: 0, w: 10, h: 10 } }],
      assets: { a: { src: "/a.png", width: 10, height: 10, kind: "image" } },
      actions: [{ id: "c-1", type: "bob", part: "head", start: 0, ease: "inOut", amount: 1, clip: "c", tracks: { rotation: "look-rotation" } }],
    }) as unknown as SceneSpec;

  it("sets and clears a key's own ease, Bézier or named", () => {
    let s = setKeyEase(base(), "head-rotation", 1, [0.4, -0.3, 0.2, 1.2]);
    expect(s.tracks["head-rotation"].keys[1]).toEqual([1, 0.3, [0.4, -0.3, 0.2, 1.2]]);
    s = setKeyEase(s, "head-rotation", 0, "settle");
    expect(s.tracks["head-rotation"].keys[0]).toEqual([0, 0, "settle"]);
    valid(s);
    expect(setKeyEase(s, "head-rotation", 1, null).tracks["head-rotation"].keys[1]).toEqual([1, 0.3]);
  });

  it("lists the tracks moving a layer, and blends a clip", () => {
    expect(tracksOf(base(), "head")).toEqual([{ name: "head-rotation", label: "rotation" }, { name: "look-rotation", label: "c · rotation" }]);
    expect(setClipWeight(base(), "c", 0.5).actions![0].weight).toBe(0.5);
  });
});
