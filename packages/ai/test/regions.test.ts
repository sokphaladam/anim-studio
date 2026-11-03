import { expect, it } from "vitest";
import { findMotions, type Provider } from "../src";

const vision = (answer: unknown): Provider & { images: string[] } => {
  const images: string[] = [];
  return { name: "mock", model: "mock", vision: true, images, generateJSON: async ({ image }) => (images.push(image ?? ""), JSON.stringify(answer)) };
};

it("turns what the vision model sees into loop-safe motions, heads after bodies", async () => {
  const p = vision({ indoor: true, regions: [{ label: "head", box_2d: [100, 400, 300, 500] }, { label: "person", box_2d: [250, 350, 700, 600] }, { label: "lamp", box_2d: [50, 50, 150, 120] }, { label: "window", box_2d: [100, 600, 500, 900] }, { label: "animal", box_2d: [700, 100, 690, 110] }] });
  const info = await findMotions(new Uint8Array([1, 2, 3]), p, 10);
  expect(p.images[0]).toMatch(/^data:image\/png;base64,/);
  expect(info.motions.map((m) => [m.kind, m.period])).toEqual([["breathe", 10 / 3], ["flicker", 10 / 3], ["nod", 10 / 3]]);
  expect(info.motions[0].box).toEqual([0.35, 0.25, 0.6, 0.7]);
  expect(info.windows).toEqual([[0.6, 0.1, 0.9, 0.5]]); // the degenerate animal box was dropped
});
