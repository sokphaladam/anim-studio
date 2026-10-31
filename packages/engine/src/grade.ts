import { ART_STYLES, type StyleId } from "@anim/spec";
import { ctxOf, type CanvasFactory, type Surface } from "./drawing";
import type { Ctx2D } from "./registry";
import { rng } from "./rng";

const GRAIN = 128;
let grainTile: Surface | null = null;

/** Seeded noise tile, made once; deterministic across runs. */
function grain(make: CanvasFactory) {
  if (grainTile) return grainTile;
  grainTile = make(GRAIN, GRAIN);
  const g = ctxOf(grainTile);
  const img = g.createImageData(GRAIN, GRAIN);
  const r = rng(1234);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(r() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return grainTile;
}

/**
 * The art style's final look over the whole frame: color grade, tint, bloom on the lights and film grain.
 * Pure function of (canvas pixels, style, frame), so rendering stays deterministic.
 */
export function applyGrade(ctx: Ctx2D, canvas: { width: number; height: number }, style: StyleId, frame: number, scratch: Surface, make: CanvasFactory) {
  const gr = ART_STYLES[style].grade;
  const { width: w, height: h } = canvas;
  const s = ctxOf(scratch);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalAlpha = 1;
  s.globalCompositeOperation = "copy";
  s.drawImage(canvas as CanvasImageSource, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "copy";
  ctx.filter = `saturate(${gr.saturate}) contrast(${gr.contrast}) brightness(${gr.brightness})`;
  ctx.drawImage(scratch as CanvasImageSource, 0, 0);
  ctx.filter = "none";
  if (gr.bloom > 0) {
    // the brightest parts, blurred and added back: lamps and windows glow
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = gr.bloom;
    ctx.filter = `brightness(0.75) contrast(2.2) blur(${Math.round(Math.max(w, h) / 90)}px)`;
    ctx.drawImage(scratch as CanvasImageSource, 0, 0);
    ctx.filter = "none";
  }
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = gr.tintAmount * 4;
  ctx.fillStyle = gr.tint;
  ctx.fillRect(0, 0, w, h);
  if (gr.grain > 0) {
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = gr.grain * 2;
    const pattern = ctx.createPattern(grain(make) as CanvasImageSource, "repeat");
    if (pattern) {
      // a different grain offset every frame, chosen by the frame number
      const r = rng(frame + 1);
      ctx.translate(Math.floor(r() * GRAIN), Math.floor(r() * GRAIN));
      ctx.fillStyle = pattern;
      ctx.fillRect(-GRAIN, -GRAIN, w + GRAIN, h + GRAIN);
    }
  }
  ctx.restore();
}
