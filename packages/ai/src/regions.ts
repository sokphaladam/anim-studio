import type { Motion } from "@anim/engine";
import { z } from "zod";
import { extractJson } from "./json";
import type { Provider } from "./types";

const LABELS = ["person", "head", "hand", "animal", "window", "lamp", "screen", "candle", "plant", "hanging"] as const;

const RegionsSchema = z.object({
  indoor: z.boolean().default(true),
  regions: z
    .array(z.object({ label: z.enum(LABELS), box_2d: z.tuple([z.number(), z.number(), z.number(), z.number()]) }))
    .max(16)
    .default([]),
});
const regionsJsonSchema = z.toJSONSchema(RegionsSchema, { io: "input" });

const SYSTEM = `You look at an illustration and find the parts that could move a little in a looping animation.
Output JSON only: {"indoor": true|false, "regions": [{"label": "...", "box_2d": [ymin, xmin, ymax, xmax]}]} with box coordinates normalized to 0-1000.
Labels:
- "person": a person's upper body (shoulders to waist), one box per person
- "head": a person's head with hair
- "hand": a hand that is writing, drawing or typing
- "animal": a cat, dog or other animal's whole body
- "window": a window pane showing the outdoors (one box per pane or window)
- "lamp": a lamp, light bulb or glowing light source standing or on a wall
- "hanging": a lamp or plant hanging from the ceiling
- "screen": a glowing computer, phone or TV screen
- "candle": a candle flame
- "plant": a potted plant standing on something
Only include clearly visible things, at most 12. "indoor" is false if the picture is outdoors.`;

export type PaintingInfo = { motions: Motion[]; windows: [number, number, number, number][]; indoor: boolean };

/** A cycle near `want` seconds that divides the duration, so the scene loops without a jump. */
const fit = (want: number, duration: number) => duration / Math.max(1, Math.round(duration / want));

/** Gemini-style [ymin, xmin, ymax, xmax] on 0-1000 → [x0, y0, x1, y1] fractions, clamped and ordered. */
function toBox([y0, x0, y1, x1]: [number, number, number, number]): Motion["box"] {
  const c = (v: number) => Math.min(1, Math.max(0, v / 1000));
  return [Math.min(c(x0), c(x1)), Math.min(c(y0), c(y1)), Math.max(c(x0), c(x1)), Math.max(c(y0), c(y1))];
}

/**
 * Asks a vision model what in the painting can move and turns it into painting motions: people and animals breathe,
 * heads nod, a writing hand moves, plants sway, lights flicker. Windows come back separately so rain can stay outside.
 */
export async function findMotions(png: Uint8Array, provider: Provider, duration: number, signal?: AbortSignal): Promise<PaintingInfo> {
  const image = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  const text = await provider.generateJSON({ system: SYSTEM, user: "Find the parts of this illustration that could move.", schema: regionsJsonSchema, image, signal });
  const r = RegionsSchema.parse(extractJson(text));
  const motions: Motion[] = [];
  const windows: Motion["box"][] = [];
  for (const { label, box_2d } of r.regions) {
    const box = toBox(box_2d);
    if (box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01) continue;
    const add = (kind: Motion["kind"], period: number, extra: Partial<Motion> = {}) => motions.push({ kind, box, amount: 1, period: fit(period, duration), ...extra });
    if (label === "person") add("breathe", 4);
    else if (label === "head") add("nod", 3);
    else if (label === "hand") add("write", 2);
    else if (label === "animal") add("breathe", 3);
    else if (label === "plant") add("sway", 4);
    else if (label === "hanging") add("hang", 4);
    else if (label === "lamp" || label === "candle") add("flicker", 3, { color: "#ffc98a", amount: label === "candle" ? 1.4 : 1 });
    else if (label === "screen") add("flicker", 2, { color: "#9ecbff", amount: 0.7 });
    else if (label === "window") windows.push(box);
  }
  // heads after bodies, so a nodding head is drawn over a breathing body
  motions.sort((a, b) => Number(a.kind === "nod" || a.kind === "write") - Number(b.kind === "nod" || b.kind === "write"));
  return { motions, windows, indoor: r.indoor };
}
