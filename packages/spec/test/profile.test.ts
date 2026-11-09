import { validateScene } from "@anim/engine";
import { describe, expect, it } from "vitest";

const base = {
  version: 1,
  meta: { title: "t", duration: 4, width: 100, height: 100 },
  layers: [{ id: "girl_body", type: "image", params: { asset: "girl_body", x: 0, y: 0, w: 10, h: 10 } }],
  assets: {
    girl_source: { src: "/api/images/a.png", width: 10, height: 10, kind: "source" },
    girl_mask: { src: "/api/images/b.png", width: 10, height: 10, kind: "mask", from: "girl_source" },
    girl_body: { src: "/api/images/c.png", width: 10, height: 10, from: "girl_source" },
  },
};

describe("character profiles and part provenance", () => {
  it("a scene from before M8 (no profiles, checks or crops) still validates unchanged", () => {
    const r = validateScene(base);
    expect(r.ok ? r.spec.characters : r.errors).toBeUndefined();
  });

  it("accepts a profile, a mask reference, a crop and a checklist", () => {
    const r = validateScene({
      ...base,
      assets: { ...base.assets, girl_body: { ...base.assets.girl_body, mask: "girl_mask", crop: [0, 0, 10, 10], cleanup: { grow: -1 }, checks: [{ name: "edges", status: "pass" }] } },
      characters: { girl: { name: "girl", look: "girl, hoodie", reference: "girl_source", palette: { c1: "#c83c6e" }, proportions: { head: 0.3, aspect: 0.5 }, seed: 7 } },
    });
    expect(r.ok ? [] : r.errors).toEqual([]);
    if (r.ok) expect(r.spec.assets!.girl_body.cleanup).toEqual({ grow: -1, holes: 0, specks: 0, feather: 0 });
  });

  it("rejects a profile whose reference is missing, a mask that isn't a mask, and an empty crop", () => {
    const r = validateScene({
      ...base,
      assets: { ...base.assets, girl_body: { ...base.assets.girl_body, mask: "girl_source", crop: [5, 5, 5, 9] } },
      characters: { girl: { name: "girl", look: "girl", reference: "nope" } },
    });
    expect(r.ok ? [] : r.errors.join("\n")).toMatch(/not a mask asset[\s\S]*crop must be[\s\S]*Unknown reference asset "nope"/);
  });
});
