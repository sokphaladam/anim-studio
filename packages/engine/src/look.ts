// The finishing pass: depth planes, the camera's cyclic move with parallax, the frame's look (grade, bloom, vignette),
// per-layer fog, light and depth of field, and contact shadows. Pixel work is plain arithmetic on RGBA arrays (no canvas
// filters, whose results differ between browsers and the export's canvas), so preview and export compute the same values.
import type { Layer, Look, SceneSpec } from "@anim/spec";
import { fitPeriod } from "./actions";
import type { CanvasFactory } from "./drawing";
import { layerMatrix } from "./index";
import { apply, IDENTITY, mul, scale, translate, type Mat } from "./matrix";
import type { Ctx2D } from "./registry";
import { resolve } from "./resolve";

/** Depth of each plane: 0 = nearest, 1 = farthest. */
export const PLANE_DEPTH = { foreground: 0.15, midground: 0.5, background: 0.9 } as const;

/** How far a layer is: its own depth or plane, else its rig parent's, else midground. */
export function depthOf(spec: SceneSpec, layer: Layer | null): number {
  for (let l = layer, n = 0; l && n <= spec.layers.length; l = l.parent === undefined ? null : (spec.layers.find((x) => x.id === l!.parent) ?? null), n++) {
    if (l.depth !== undefined) return l.depth;
    if (l.plane) return PLANE_DEPTH[l.plane];
  }
  return PLANE_DEPTH.midground;
}

/**
 * The camera for a layer at time t: zoom about the camera point, plus the cyclic motion (which returns to its start
 * over a period fitted to the scene, so loops stay seamless). With parallax, far layers zoom and pan less than near ones.
 * Identity when the scene has no camera.
 */
export function cameraMatrix(spec: SceneSpec, layer: Layer | null, t: number, opts: { still?: boolean } = {}): Mat {
  if (!spec.camera) return IDENTITY;
  const cam = resolve(spec.camera, spec, t);
  const { width: W, height: H, duration: D } = spec.meta;
  const cx = cam.x ?? W / 2, cy = cam.y ?? H / 2;
  let zoom = cam.zoom, dx = 0, dy = 0;
  const m = cam.motion;
  if (m && !opts.still) {
    const P = fitPeriod(m.period ?? D, D), a = (2 * Math.PI * t) / P;
    if (m.kind === "push") zoom *= 1 + 0.06 * m.amount * (1 - Math.cos(a)) * 0.5;
    else if (m.kind === "pan") dx = 0.04 * W * m.amount * Math.sin(a);
    else {
      dx = 0.025 * W * m.amount * Math.sin(a);
      dy = 0.015 * H * m.amount * Math.sin(2 * a);
    }
  }
  // far layers follow the camera less
  const k = 1 - cam.parallax * depthOf(spec, layer);
  const z = 1 + (zoom - 1) * k;
  return mul(translate(-dx * k, -dy * k), mul(mul(translate(cx, cy), scale(z)), translate(-cx, -cy)));
}

/** The look's values at t, with the parts switched off left out. */
export type LookAt = { exposure: number; contrast: number; saturation: number; temperature: number; vignette: number; bloom?: { amount: number; threshold: number }; fog?: { amount: number; color: [number, number, number]; near: number }; dof?: { amount: number; focus: number }; light?: { color: [number, number, number]; amount: number; direction: number } };
export type Effect = "camera" | "grade" | "bloom" | "fog" | "dof" | "light" | "shadows";

const rgb = (h: string): [number, number, number] => {
  const x = h.length === 4 ? h.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : h;
  return [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number];
};

export function lookAt(look: Look | undefined, spec: SceneSpec, t: number, off: ReadonlySet<Effect> = new Set()): LookAt | null {
  if (!look) return null;
  const v = resolve(look, spec, t) as unknown as { exposure: number; contrast: number; saturation: number; temperature: number; vignette: number; bloom?: { amount: number; threshold: number }; fog?: { amount: number; color: string; near: number }; dof?: { amount: number; focus: number }; light?: { color: string; amount: number; direction: number } };
  const grade = !off.has("grade");
  return {
    exposure: grade ? v.exposure : 0,
    contrast: grade ? v.contrast : 0,
    saturation: grade ? v.saturation : 0,
    temperature: grade ? v.temperature : 0,
    vignette: grade ? v.vignette : 0,
    ...(v.bloom && !off.has("bloom") && v.bloom.amount > 0 && { bloom: v.bloom }),
    ...(v.fog && !off.has("fog") && v.fog.amount > 0 && { fog: { ...v.fog, color: rgb(v.fog.color) } }),
    ...(v.dof && !off.has("dof") && v.dof.amount > 0 && { dof: v.dof }),
    ...(v.light && !off.has("light") && { light: { ...v.light, color: rgb(v.light.color) } }),
  };
}

/** Whether the frame-wide grade changes any pixel. */
export const grades = (l: LookAt) => !!(l.exposure || l.contrast || l.saturation || l.temperature || l.vignette || l.bloom || l.light);

/**
 * Grades a frame in place: the scene's light color (multiplied in, so subject and environment sit in the same light),
 * exposure (stops), contrast about mid-grey, saturation about luma, temperature (warmer = more red, less blue), and a
 * vignette darkening toward the corners.
 */
export function gradePixels(d: Uint8ClampedArray, w: number, h: number, l: LookAt) {
  const gain = Math.pow(2, l.exposure), c = 1 + l.contrast, s = 1 + l.saturation;
  const lt = l.light ? l.light.color.map((v) => 1 - l.light!.amount + (l.light!.amount * v) / 255) : [1, 1, 1];
  const warm = l.temperature * 0.12;
  const cx = w / 2, cy = h / 2, rr = 1 / Math.hypot(cx, cy);
  for (let y = 0, i = 0; y < h; y++)
    for (let x = 0; x < w; x++, i += 4) {
      if (!d[i + 3]) continue;
      let r = (d[i] / 255) * gain * lt[0], g = (d[i + 1] / 255) * gain * lt[1], b = (d[i + 2] / 255) * gain * lt[2];
      r = (r - 0.5) * c + 0.5;
      g = (g - 0.5) * c + 0.5;
      b = (b - 0.5) * c + 0.5;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * s;
      g = lum + (g - lum) * s;
      b = lum + (b - lum) * s;
      r *= 1 + warm;
      b *= 1 - warm;
      if (l.vignette) {
        const k = 1 - l.vignette * Math.max(0, Math.hypot(x - cx, y - cy) * rr - 0.35) * 1.4;
        r *= k;
        g *= k;
        b *= k;
      }
      d[i] = r * 255;
      d[i + 1] = g * 255;
      d[i + 2] = b * 255;
    }
}

/**
 * Box-blurs RGBA in place within the rectangle [x0, y0, x1, y1), `passes` times (3 ≈ Gaussian). Colors are weighted by
 * alpha while blurring, so transparent pixels don't darken soft edges.
 */
export function blurPixels(d: Uint8ClampedArray, w: number, h: number, r: number, passes: number, box: [number, number, number, number] = [0, 0, w, h]) {
  r = Math.round(r);
  if (r < 1 || passes < 1) return;
  const [x0, y0, x1, y1] = box, bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  const f = new Float32Array(bw * bh * 4);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = ((y0 + y) * w + x0 + x) * 4, j = (y * bw + x) * 4, a = d[i + 3] / 255;
      f[j] = d[i] * a;
      f[j + 1] = d[i + 1] * a;
      f[j + 2] = d[i + 2] * a;
      f[j + 3] = d[i + 3];
    }
  const tmp = new Float32Array(Math.max(bw, bh) * 4);
  const run = (n: number, len: number, at: (a: number, b: number) => number) => {
    for (let a = 0; a < n; a++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let b = -r; b <= r; b++) sum += f[at(a, Math.min(len - 1, Math.max(0, b))) + c];
        for (let b = 0; b < len; b++) {
          tmp[b * 4 + c] = sum / (2 * r + 1);
          sum += f[at(a, Math.min(len - 1, b + r + 1)) + c] - f[at(a, Math.max(0, b - r)) + c];
        }
      }
      for (let b = 0; b < len; b++) for (let c = 0; c < 4; c++) f[at(a, b) + c] = tmp[b * 4 + c];
    }
  };
  for (let p = 0; p < passes; p++) {
    run(bh, bw, (yy, xx) => (yy * bw + xx) * 4);
    run(bw, bh, (xx, yy) => (yy * bw + xx) * 4);
  }
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = ((y0 + y) * w + x0 + x) * 4, j = (y * bw + x) * 4, a = f[j + 3];
      d[i + 3] = a;
      if (a > 0) {
        d[i] = f[j] / (a / 255);
        d[i + 1] = f[j + 1] / (a / 255);
        d[i + 2] = f[j + 2] / (a / 255);
      }
    }
}

/** Bloom: what is brighter than the threshold, blurred wide and added back (glows around lights). */
export function bloomPixels(d: Uint8ClampedArray, w: number, h: number, amount: number, threshold: number, passes: number) {
  const bright = new Uint8ClampedArray(d.length);
  const t = threshold * 255;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (lum <= t) continue;
    const k = (lum - t) / (255 - t || 1);
    bright[i] = d[i] * k;
    bright[i + 1] = d[i + 1] * k;
    bright[i + 2] = d[i + 2] * k;
    bright[i + 3] = 255;
  }
  blurPixels(bright, w, h, Math.max(2, w * 0.012), passes);
  for (let i = 0; i < d.length; i += 4) {
    d[i] += bright[i] * amount;
    d[i + 1] += bright[i + 1] * amount;
    d[i + 2] += bright[i + 2] * amount;
  }
}

/**
 * Fog on one layer, in place (alpha untouched): its colors are pulled toward the fog color the farther it is, starting
 * at the fog's `near` depth.
 */
export function treatPixels(d: Uint8ClampedArray, l: LookAt, depth: number, box: [number, number, number, number], w: number) {
  const fog = l.fog;
  const k = fog ? Math.min(1, Math.max(0, (depth - fog.near) / (1 - fog.near || 1)) * fog.amount) : 0;
  if (!k) return;
  for (let y = box[1]; y < box[3]; y++)
    for (let x = box[0], i = (y * w + x) * 4; x < box[2]; x++, i += 4) if (d[i + 3]) for (let c = 0; c < 3; c++) d[i + c] += (fog!.color[c] - d[i + c]) * k;
}

/**
 * A soft shadow on the ground under a layer (or, for a group, under all its image parts), from where they are at t, so
 * it stays under the feet as the character moves. It falls away from the light.
 */
export function contactShadow(ctx: Ctx2D, spec: SceneSpec, layer: Layer, t: number, lightDirection: number, make: CanvasFactory) {
  const amount = resolve(layer.shadow!.amount, spec, t) as number;
  if (amount <= 0) return;
  const under = (l: Layer) => {
    for (let p: Layer | undefined = l, n = 0; p && n <= spec.layers.length; p = p.parent === undefined ? undefined : spec.layers.find((x) => x.id === p!.parent), n++) if (p.id === layer.id) return true;
    return false;
  };
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of layer.type === "image" ? [layer] : spec.layers.filter((x) => x.type === "image" && under(x))) {
    const p = l.params;
    if (![p.w, p.h].every((v) => typeof v === "number")) continue;
    const x = typeof p.x === "number" ? p.x : 0, y = typeof p.y === "number" ? p.y : 0, w = p.w as number, h = p.h as number;
    const m = layerMatrix(spec, l, t, make);
    for (const [a, b] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const [px, py] = apply(m, a, b);
      x0 = Math.min(x0, px);
      x1 = Math.max(x1, px);
      y1 = Math.max(y1, py);
    }
  }
  if (!isFinite(x0)) return;
  const r = (x1 - x0) * 0.42 * layer.shadow!.size;
  const away = -Math.cos((lightDirection * Math.PI) / 180) * r * 0.25;
  ctx.save();
  ctx.translate((x0 + x1) / 2 + away, y1 - r * 0.03);
  ctx.scale(1, 0.18);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, `rgba(0,0,0,${0.55 * Math.min(1, amount)})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, 2 * r, 2 * r);
  ctx.restore();
}

/** How much depth of field blurs a layer at `depth`, in pixels of a frame `w` wide. */
export const dofRadius = (l: LookAt, depth: number, w: number) => (l.dof ? l.dof.amount * Math.abs(depth - l.dof.focus) * w * 0.012 : 0);

/** Blur passes per quality: draft is fast, final is smooth. */
export const PASSES = { draft: 1, balanced: 2, final: 3 } as const;
export type Quality = keyof typeof PASSES;
