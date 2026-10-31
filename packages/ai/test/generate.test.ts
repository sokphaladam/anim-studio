import { describe, expect, it } from "vitest";
import { exampleFor, extractJson, tidy, generateScene, type GenerateEvent, type Provider } from "../src";

const storyboard = { title: "rainy cat", mood: "calm night", palette: { sky: "#1b2340" }, beats: [{ at: 0, label: "Fade in" }, { at: 6, label: "Lightning" }] };
const good = {
  version: 1,
  meta: { title: "rainy cat", duration: 12, fps: 30, width: 1280, height: 720 },
  palette: { sky: "#1b2340" },
  tracks: { fade: { keys: [[0, 0], [1, 1], [11, 1], [12, 0]] } },
  layers: [{ id: "bg", type: "paper", params: { color: "$sky" } }, { id: "cat", type: "fox", params: { x: 600, y: 500 } }],
  overlays: [{ type: "fade", params: { reveal: "@fade" } }],
  beats: storyboard.beats,
};
const bad = { ...good, layers: [{ id: "bg", type: "dragon", params: {} }] };

/** Replays canned answers in order and records what it was asked. */
function mock(answers: unknown[]): Provider & { calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  return {
    name: "mock",
    model: "mock",
    calls,
    async generateJSON({ system, user, onToken }) {
      calls.push({ system, user });
      const a = answers.shift();
      const text = typeof a === "string" ? a : JSON.stringify(a);
      for (const ch of text.match(/.{1,4}/g) ?? []) onToken?.(ch);
      return text;
    },
  };
}

const run = async (answers: unknown[]) => {
  const events: GenerateEvent[] = [];
  const p = mock(answers);
  const spec = await generateScene({ prompt: "a cat sleeping on a rainy balcony, lightning at 6s", duration: 12, aspect: "16:9" }, p, (e) => events.push(e));
  return { spec, events, calls: p.calls };
};

describe("generateScene", () => {
  it("a valid spec passes on the first try, with storyboard first", async () => {
    const { spec, events, calls } = await run([storyboard, good]);
    expect(spec?.layers[0].type).toBe("paper");
    expect(calls).toHaveLength(2);
    expect(events.find((e) => e.type === "repairing")).toBeUndefined();
    const types = events.map((e) => e.type);
    expect(types.indexOf("storyboard")).toBeLessThan(types.indexOf("done"));
    // the catalog and example are in the spec prompt; hand-drawn layers are not offered
    expect(calls[1].system).toMatch(/- fox \(characters\)/);
    expect(calls[1].system).not.toMatch(/- drawing \(/);
  });

  it("an invalid spec triggers repair with the exact errors", async () => {
    const { spec, events, calls } = await run([storyboard, bad, good]);
    expect(spec).not.toBeNull();
    const rep = events.find((e) => e.type === "repairing");
    expect(rep && rep.type === "repairing" && rep.errors.join()).toMatch(/Unknown object type "dragon"/);
    expect(calls[2].system).toMatch(/Unknown object type "dragon"/);
    expect(events.at(-1)).toMatchObject({ type: "done", repairs: 1 });
  });

  it("gives up after 3 repairs and reports the errors", async () => {
    const { spec, events, calls } = await run([storyboard, bad, bad, bad, "not json at all"]);
    expect(spec).toBeNull();
    expect(calls).toHaveLength(5);
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("forces the requested size/duration and keeps times inside the scene", async () => {
    const off = { ...good, meta: { title: "x", duration: 99, width: 10, height: 10 }, tracks: { fade: { keys: [[20, 0], [0, 1]] } } };
    const { spec } = await run([storyboard, off]);
    expect(spec?.meta).toMatchObject({ duration: 12, width: 1280, height: 720 });
    expect(spec?.tracks.fade.keys).toEqual([[0, 1], [12, 0]]);
  });

  it("extracts JSON wrapped in fences or chatter", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} hope it helps')).toEqual({ a: 2 });
  });
});

it("repairs a valid scene that is only a background", async () => {
  const empty = { ...good, layers: [good.layers[0]] };
  const events: GenerateEvent[] = [];
  const spec = await generateScene({ prompt: "a dog on a rainy balcony", duration: 12, aspect: "16:9" }, mock([storyboard, empty, good]), (e) => events.push(e));
  expect(events.find((e) => e.type === "repairing")).toMatchObject({ errors: [expect.stringMatching(/only a background/)] });
  expect(spec?.layers.map((l) => l.type)).toEqual(["paper", "fox"]);
});

it("picks the example scene closest to the idea", () => {
  expect(JSON.parse(exampleFor("a dog sleeping on a rainy balcony at night")).meta.title).toBe("1 a.m. focus");
  expect(JSON.parse(exampleFor("a fox by an autumn window")).meta.title).toBe("autumn window");
});

it("wires unused tracks to the param they are named after and un-sticks a black fade", () => {
  const spec = {
    ...good,
    tracks: { rainIntensity: { keys: [[0, 0], [6, 1]] as [number, number][], ease: "inOut" as const } },
    layers: [...good.layers, { id: "rain", type: "rain", params: { intensity: 0 } }],
    overlays: [{ type: "fade", params: { reveal: 0 } }],
  };
  const t = tidy(spec as never);
  expect(t.layers[2].params.intensity).toBe("@rainIntensity");
  expect(t.overlays[0].params.reveal).toBe("@fade");
  expect(t.tracks.fade.keys).toEqual([[0, 0], [1, 1], [11, 1], [12, 0]]);
});

it("painted mode: unloads the model, paints the background only, then adds a drawing layer per subject and effects", async () => {
  const order: string[] = [];
  const p = mock([{ ...storyboard, scene: "desk, night, rain", subjects: ["girl studying", "cat", "Cat"] }, { ...good, layers: [{ id: "cat", type: "fox", params: { x: 1, y: 1 } }, { id: "rain", type: "rain", params: {} }] }]);
  p.unload = async () => void order.push("unload");
  let painted = "", negative = "";
  const spec = await generateScene({ prompt: "rainy study night", duration: 12, aspect: "16:9", style: "lofi-cozy", mode: "painted" }, p, () => {}, undefined, async (a) => {
    order.push("paint");
    painted = a.positive;
    negative = a.negative;
    return { src: "/api/images/abc.png", png: new Uint8Array() };
  });
  expect(order).toEqual(["unload", "paint"]);
  expect(painted).toMatch(/^no humans, scenery, desk, night, rain, lofi anime illustration.*absurdres$/);
  expect(negative).toMatch(/1girl, 1boy, person/);
  expect(spec?.meta.style).toBe("lofi-cozy");
  expect(spec?.palette).toMatchObject({ lamp: "#ffc38a" });
  expect(spec?.layers.map((l) => [l.id, l.type])).toEqual([["painting", "painting"], ["girl-studying", "drawing"], ["cat", "drawing"], ["cat-2", "drawing"], ["rain", "rain"]]);
  expect(spec?.layers[1].frames).toEqual([{ start: 0, strokes: [] }]);
});

it("video mode: paints the first frame, animates it, and builds the clip scene without a spec call", async () => {
  const p = mock([{ ...storyboard, scene: "1girl, tablet", motion: "She draws. Rain falls." }]);
  let videoPrompt = "";
  const spec = await generateScene(
    { prompt: "girl drawing", duration: 12, aspect: "16:9", style: "anime", mode: "video" },
    p,
    () => {},
    undefined,
    async () => ({ src: "/api/images/a.png", png: new Uint8Array([1]) }),
    async (a) => {
      videoPrompt = a.positive;
      expect([a.width, a.height, a.frames, a.fps]).toEqual([1280, 704, 121, 24]);
      return { frames: "/api/images/abc/", count: 121, fps: 24 };
    },
  );
  expect(videoPrompt).toMatch(/^She draws\. Rain falls\. The picture: 1girl, tablet\./);
  expect(p.calls).toHaveLength(1); // storyboard only
  expect(spec?.layers).toEqual([{ id: "video", type: "footage", params: { frames: "/api/images/abc/", count: 121, fps: 24 } }]);
  expect(spec?.overlays.map((o) => o.type)).toEqual(["vignette", "fade"]);
});
