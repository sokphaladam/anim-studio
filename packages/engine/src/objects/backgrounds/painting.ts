import { defineObject, z, num, TAU, withAlpha } from "../common";
import { getImage, makeCanvas, type Bitmap } from "../../images";
import type { Ctx2D } from "../../registry";

/**
 * A moving part of the painting, found by looking at it: box is [x0, y0, x1, y1] as fractions of the image.
 * breathe: rises and falls from its bottom edge · nod: tilts about its bottom (a head on its neck) · write: small
 * back-and-forth (a hand) · sway: rocks about its bottom (plants) · hang: rocks about its top (hanging lamps) ·
 * flicker: a light that glows and flickers.
 */
export const MotionSchema = z.object({
  kind: z.enum(["breathe", "nod", "write", "sway", "hang", "flicker"]),
  box: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]),
  /** 1 = the natural amount; 0 = still. */
  amount: z.number().min(0).max(3).default(1),
  /** Seconds per cycle; use a divisor of the duration so the loop is seamless. */
  period: z.number().positive().default(4),
  color: z.string().optional(),
});
export type Motion = z.infer<typeof MotionSchema>;

type Patch = { canvas: unknown; x: number; y: number; w: number; h: number };
const patches = new WeakMap<object, Map<string, Patch>>();

/** The region cut out of the image with a soft oval edge, made once per image and box. */
function patch(img: Bitmap, box: Motion["box"]): Patch {
  let byBox = patches.get(img);
  if (!byBox) patches.set(img, (byBox = new Map()));
  const key = box.join(",");
  let p = byBox.get(key);
  if (!p) {
    // a little margin so the soft edge falls outside the subject
    const mx = (box[2] - box[0]) * 0.12, my = (box[3] - box[1]) * 0.12;
    const x = Math.max(0, (box[0] - mx) * img.width), y = Math.max(0, (box[1] - my) * img.height);
    const w = Math.max(2, Math.min(img.width, (box[2] + mx) * img.width) - x), h = Math.max(2, Math.min(img.height, (box[3] + my) * img.height) - y);
    const c = makeCanvas(Math.ceil(w), Math.ceil(h));
    const g = c.getContext("2d") as Ctx2D;
    g.drawImage(img as CanvasImageSource, x, y, w, h, 0, 0, w, h);
    g.globalCompositeOperation = "destination-in";
    g.translate(w / 2, h / 2);
    g.scale(w / 2, h / 2);
    const m = g.createRadialGradient(0, 0, 0.55, 0, 0, 1);
    m.addColorStop(0, "rgba(0,0,0,1)");
    m.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = m;
    g.fillRect(-1, -1, 2, 2);
    byBox.set(key, (p = { canvas: c, x, y, w, h }));
  }
  return p;
}

function animate(ctx: Ctx2D, img: Bitmap, m: Motion, t: number) {
  const s = Math.sin((t * TAU) / m.period) * m.amount;
  if (m.kind === "flicker") {
    const cx = ((m.box[0] + m.box[2]) / 2) * img.width, cy = ((m.box[1] + m.box[3]) / 2) * img.height;
    const r = Math.max(m.box[2] - m.box[0], m.box[3] - m.box[1]) * Math.max(img.width, img.height) * 0.9;
    // two quick sines over the slow one: lamplight that breathes and catches
    const a = (0.16 + 0.07 * s + 0.04 * Math.sin(t * 17.3) * Math.sin(t * 5.1)) * Math.min(1, m.amount);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(m.color ?? "#ffc98a", a));
    g.addColorStop(1, withAlpha(m.color ?? "#ffc98a", 0));
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  const p = patch(img, m.box);
  // pivot: bottom-centre for most, top-centre for hanging things
  const px = p.x + p.w / 2, py = m.kind === "hang" ? p.y : p.y + p.h;
  ctx.save();
  ctx.translate(px, py);
  if (m.kind === "breathe") ctx.scale(1 + 0.004 * s, 1 + 0.014 * s);
  if (m.kind === "nod") {
    ctx.rotate(0.035 * s);
    ctx.translate(0, 0.012 * p.h * (s + 1));
  }
  if (m.kind === "write") ctx.translate(0.025 * p.w * Math.sin((t * TAU) / 0.5) * m.amount, 0.01 * p.h * Math.abs(s));
  if (m.kind === "sway" || m.kind === "hang") ctx.rotate(0.025 * s);
  ctx.drawImage(p.canvas as CanvasImageSource, -p.w / 2, m.kind === "hang" ? 0 : -p.h);
  ctx.restore();
}

export const painting = defineObject({
  type: "painting",
  category: "backgrounds",
  description:
    "A painted illustration (made by the image painter, not by you) filling the frame, with a slow camera drift; zoom 1 = fits the frame, panX/panY shift it. Its moving parts (motions) are set for you. Put light, particles and fx after it.",
  params: z.object({
    src: z.string().min(1),
    zoom: num.default(1.06),
    panX: num.default(0),
    panY: num.default(0),
    /** Seconds per full gentle sway of the camera; 0 = still. Use a divisor of the duration. */
    swaySeconds: num.default(12),
    motions: z.array(MotionSchema).default([]),
  }),
  draw(ctx, p, t, env) {
    const img = getImage(p.src);
    if (!img) {
      // not loaded yet (or missing): a dark frame instead of nothing
      ctx.fillStyle = "#15121c";
      ctx.fillRect(0, 0, env.width, env.height);
      return;
    }
    const sway = p.swaySeconds > 0 ? Math.sin((t * TAU) / p.swaySeconds) : 0;
    const k = Math.max(env.width / img.width, env.height / img.height) * p.zoom * (1 + 0.01 * sway);
    // work in image pixels from here, so motion boxes (image fractions) line up at any zoom
    ctx.translate((env.width - img.width * k) / 2 + p.panX + sway * 6, (env.height - img.height * k) / 2 + p.panY);
    ctx.scale(k, k);
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    for (const m of p.motions) animate(ctx, img, m as Motion, t);
  },
});

/** Where a box (image fractions) of a painting layer lands in scene coordinates, at rest. For clipping rain to windows. */
export function paintingBoxToScene(box: [number, number, number, number], img: { width: number; height: number }, scene: { width: number; height: number }, zoom = 1.06) {
  const k = Math.max(scene.width / img.width, scene.height / img.height) * zoom;
  const ox = (scene.width - img.width * k) / 2, oy = (scene.height - img.height * k) / 2;
  return [ox + box[0] * img.width * k, oy + box[1] * img.height * k, ox + box[2] * img.width * k, oy + box[3] * img.height * k].map(Math.round) as [number, number, number, number];
}
