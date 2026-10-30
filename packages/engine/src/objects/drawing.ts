import { defineObject, z, num } from "./common";

export const BLENDS = { normal: "source-over", multiply: "multiply", screen: "screen", add: "lighter" } as const;

/** Rendering is done by the renderer from layer.frames; this definition gives validation and the catalog entry. */
export const drawing = defineObject({
  type: "drawing",
  category: "drawing",
  description: "Hand-drawn frame-by-frame layer (vector strokes in `frames`); usually made by the user, animate it with a layer transform.",
  params: z.object({ opacity: num.default(1), blend: z.enum(["normal", "multiply", "screen", "add"]).default("normal") }),
  draw() {},
});
