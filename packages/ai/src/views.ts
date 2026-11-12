// Head-angle variants: the same character (saved look and seed) painted again turned to the side, with only the head cut
// out, so a scene can switch to it when a head has to turn further than a flat cut-out can.
import type { AssetCheck } from "@anim/spec";
import { LOOK, paintPrompt } from "./generate";
import type { LayeredTools } from "./layered";
import { count, defaultCleanup, intersect, maskFrom, maskImage, palette, paletteDrift, recut, reviewOf } from "./masks";
import { AIError } from "./types";

export type View = "three_quarter" | "profile";
export type ViewRequest = { look: string; seed?: number; view: View; facing: "left" | "right"; /** The front head's PNG, to check the new one is the same character. */ front: Uint8Array };
type Stored = { src: string; width: number; height: number };
export type ViewResult = { image: Stored & { crop: [number, number, number, number]; checks: AssetCheck[]; review?: string }; source: Stored; mask: Stored };

const WORDS: Record<View, string> = { three_quarter: "three-quarter view, head turned to the side", profile: "profile, from side" };
/** Palette distance past which the new head is flagged as possibly someone else (as for reused characters). */
const DRIFT = 60;

/** Paints the character turned to one side and cuts out its head. Throws (with a fix) when no head can be found or cut. */
export async function paintView(req: ViewRequest, tools: LayeredTools, signal?: AbortSignal): Promise<ViewResult> {
  const { painter } = tools;
  if (!painter.removeBackground || !painter.segment) throw new AIError("The image painter can't separate layers", "Install the segmentation models: npm run setup:painter --layered");
  const png = await painter.paint({
    positive: paintPrompt(`solo, ${req.look}, ${WORDS[req.view]}, facing ${req.facing}, upper body, centered, simple background, white background`),
    negative: `${LOOK.negative}, multiple people, front view, looking at viewer, cropped head, frame, border`,
    width: 1024,
    height: 1024,
    seed: req.seed ?? Math.floor(Math.random() * 2 ** 31),
    signal,
  });
  const src = await tools.decode(png);
  const { width: w, height: h } = src;
  const all = maskFrom(await tools.decode(await painter.removeBackground(png, signal)), w, h);
  const head = intersect(maskFrom(await tools.decode(await painter.segment(png, "head", signal)), w, h), all);
  if (count(head) < 50) throw new AIError("Couldn't find the head in the turned painting", "Try again: a new painting usually works.");
  const cleanup = defaultCleanup(w, h);
  const cut = recut(src, head, cleanup, "head");
  const fail = cut.checks.find((c) => c.status === "fail");
  if (fail) throw new AIError(`The turned head didn't separate cleanly: ${fail.note}`, "Try again.");
  const drift = paletteDrift(palette(await tools.decode(req.front)), palette(cut.image));
  const checks: AssetCheck[] = [
    ...cut.checks,
    drift > DRIFT ? { name: "identity", status: "review", note: `Its colors differ from the front head (distance ${Math.round(drift)}); check it is the same character` } : { name: "identity", status: "pass", note: "Matches the front head's colors" },
  ];
  const review = reviewOf(checks);
  return {
    image: { src: tools.store(tools.encode(cut.image)), width: cut.image.width, height: cut.image.height, crop: cut.crop, checks, ...(review ? { review } : {}) },
    source: { src: tools.store(png), width: w, height: h },
    mask: { src: tools.store(tools.encode(maskImage(head, w, h))), width: w, height: h },
  };
}
