import { describe, expect, it } from "vitest";
import { extractJson, generateScene, type GenerateEvent, type Provider } from "../src";

const storyboard = { title: "rainy cat", mood: "calm night", palette: { sky: "#1b2340" }, beats: [{ at: 0, label: "Fade in" }, { at: 6, label: "Lightning" }] };
const good = {
  version: 1,
  meta: { title: "rainy cat", duration: 12, fps: 30, width: 1280, height: 720 },
  palette: { sky: "#1b2340" },
  tracks: { fade: { keys: [[0, 0], [1, 1], [11, 1], [12, 0]] } },
  layers: [{ id: "bg", type: "paper", params: { color: "$sky" } }],
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
