import { describe, expect, it } from "vitest";
import { paintingPrompts } from "../src/generate";

const IDEA =
  "Cozy lofi anime illustration, 12-second seamless loop, dusk turning to night with a cool evening mist, static camera, wide shot of a high-rise apartment living room. A young woman in an oversized beige sweater sits on a window bench at a long wooden desk. On the desk: a record player and a ceramic mug. Motion: steam rising gently from the mug, the record turning. Everything stays in place, nothing floats.";

describe("single-painting prompts", () => {
  it("paints the still scene: one person, the time of day first and weighted, no loop, camera or motion words", () => {
    const { paint } = paintingPrompts(IDEA);
    expect(paint.positive).toMatch(/^1girl, solo, from side, looking away, \(dusk turning to night with a cool evening mist:1\.3\), night, dark/);
    expect(paint.positive).toMatch(/sits on a window bench at a long wooden desk/);
    expect(paint.positive).not.toMatch(/12-second|seamless loop|static camera|Motion:|steam rising|nothing floats/);
    expect(paint.negative).toMatch(/multiple people.*looking at viewer/);
    // steam is in the motion but not the scene: it is painted so the video has something to move
    expect(paint.positive).toMatch(/mug, steam/);
  });

  it("tags what will move even when the scene already names it, so the painter doesn't leave it out", () => {
    const { paint } = paintingPrompts("Rainy night, a girl at a side table. On the table: a steaming mug and a record player. Motion: steam curling from mug, rain on the window.");
    expect(paint.positive).toMatch(/mug, steam, rain, raindrops on window/);
  });

  it("moves only what the Motion part names, and holds the rest still", () => {
    const { video } = paintingPrompts(IDEA);
    expect(video).toMatch(/^steam rising gently from the mug, the record turning\. The camera stays completely still/);
    expect(video).not.toMatch(/Everything stays in place/);
  });

  it("a scene with nobody in it, in daylight, gets no person and no night tags; no Motion part still moves gently", () => {
    const p = paintingPrompts("Cozy lofi anime illustration, sunny morning, an empty café with wooden tables and a record player.");
    expect(p.paint.positive).toMatch(/^no humans, scenery, \(sunny morning:1\.3\), an empty café/);
    expect(p.paint.positive).not.toMatch(/night, dark|steam/);
    expect(p.paint.negative).not.toMatch(/looking at viewer/);
    expect(p.video).toMatch(/^Gentle natural motion/);
  });

  it("paints and moves in the chosen style; lofi by default", () => {
    const lofi = paintingPrompts(IDEA);
    const retro = paintingPrompts(IDEA, "retro");
    expect(lofi.paint.positive).toMatch(/thick clean outlines/);
    expect(retro.paint.positive).toMatch(/1990s \(style\), retro artstyle/);
    expect(retro.paint.positive).not.toMatch(/thick clean outlines/);
    expect(retro.paint.negative).toMatch(/glossy/);
    expect(retro.video).toMatch(/1990s hand-drawn cel animation style/);
    expect(paintingPrompts(IDEA, "cinematic").video).toMatch(/Cinematic anime film style/);
  });
});
