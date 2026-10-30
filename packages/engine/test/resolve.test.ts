import { describe, expect, it } from "vitest";
import { validateScene, resolve } from "../src";

const base = (layers: unknown[]) => ({
  version: 1,
  meta: { title: "t", duration: 4, width: 1280, height: 720 },
  palette: { fox: "#e9773c" },
  tracks: { awake: { keys: [[0, 0], [2, 1]], ease: "linear" } },
  layers,
});

describe("references", () => {
  it("resolves $palette and @track values", () => {
    const r = validateScene(base([{ id: "f", type: "fox", params: { x: 1, y: 2, color: "$fox", awake: "@awake" } }]));
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(resolve(r.spec.layers[0].params, r.spec, 1)).toEqual({ x: 1, y: 2, color: "#e9773c", awake: 0.5 });
  });
  it("rejects unknown references", () => {
    const r = validateScene(base([{ id: "f", type: "fox", params: { x: 1, y: 2, color: "$nope", awake: "@missing" } }]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/Unknown palette color "\$nope"/);
      expect(r.errors.join("\n")).toMatch(/Unknown track "@missing"/);
    }
  });
  it("rejects unknown object types and bad params", () => {
    const r = validateScene(base([{ id: "a", type: "dragon", params: {} }, { id: "b", type: "fox", params: { x: "left", y: 2 } }]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toMatch(/layers\[0\]\.type: Unknown object type "dragon"/);
      expect(r.errors.join("\n")).toMatch(/layers\[1\]\.params\.x/);
    }
  });
  it("rejects key times past the duration", () => {
    const s = base([]);
    s.tracks.awake.keys.push([9, 1]);
    expect(validateScene(s).ok).toBe(false);
  });
});
