import type { Layer, SceneSpec } from "@anim/spec";
import "./objects";
import { layerPivot } from "./bounds";
import { ctxOf, drawFrame, frameIndexAt, type CanvasFactory } from "./drawing";
import { IDENTITY, mul, rotate, scale, translate, type Mat } from "./matrix";
import { BLENDS } from "./objects/drawing";
import { drawWith, getObject, makeEnv, parseParams, type Ctx2D } from "./registry";
import { resolve } from "./resolve";

export { catalog, validateScene, objectTypes, getObject, defineObject, type ObjectDef, type Env, type ValidationResult } from "./registry";
export { evalTrack, integrate, EASE } from "./tracks";
export { rng } from "./rng";
export { resolve } from "./resolve";
export { BRUSH_PRESETS, drawStroke, strokePath, frameIndexAt, drawingPivot, type CanvasFactory } from "./drawing";
export { invert, apply, mul, type Mat } from "./matrix";
export { objectBounds, layerPivot, type Box } from "./bounds";

/** Webfonts objects draw with; hosts should load these (e.g. document.fonts.load) before rendering. */
export const ENGINE_FONTS = ['italic 400 46px "Fraunces Variable"', "400 19px Figtree"];

/** Minimal canvas surface the renderer needs (a DOM canvas, OffscreenCanvas or a node canvas). */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: "2d"): unknown;
}

export interface RenderOptions {
  /** Editor-only onion skin: neighbouring drawing frames tinted before (red) / after (green). Never used for export. */
  onion?: { before: number; after: number; opacity: number; beforeColor: string; afterColor: string };
}

export interface Renderer {
  render(t: number, options?: RenderOptions): void;
  setSpec(spec: SceneSpec): void;
  dispose(): void;
}

export const defaultFactory: CanvasFactory = (w, h) => {
  if (typeof OffscreenCanvas === "undefined") throw new Error("No OffscreenCanvas: pass createCanvas to createRenderer");
  return new OffscreenCanvas(w, h);
};

/** Maps a layer's own coordinates to scene coordinates: camera, then the layer transform (rotate/scale about the layer's pivot). */
export function layerMatrix(spec: SceneSpec, layer: Layer | null, t: number, make: CanvasFactory = defaultFactory): Mat {
  let m = IDENTITY;
  if (spec.camera) {
    const cam = resolve(spec.camera, spec, t);
    const cx = cam.x ?? spec.meta.width / 2, cy = cam.y ?? spec.meta.height / 2;
    m = mul(mul(translate(cx, cy), scale(cam.zoom)), translate(-cx, -cy));
  }
  if (layer?.transform) {
    const tr = resolve(layer.transform, spec, t);
    const [px, py] = layerPivot(spec, layer, make);
    m = mul(m, mul(mul(mul(translate(tr.x + px, tr.y + py), rotate(tr.rotation)), scale(tr.scale)), translate(-px, -py)));
  }
  return m;
}

/** Deterministic: render(t) depends only on the spec and t. The caller owns the clock. */
export function createRenderer(canvas: CanvasLike, initial: SceneSpec, opts: { createCanvas?: CanvasFactory } = {}): Renderer {
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  const make = opts.createCanvas ?? defaultFactory;
  let spec = initial;
  // scratch surface for compositing drawing layers (cleared before every use, so it carries no state between frames)
  let scratch = make(canvas.width, canvas.height);

  function drawDrawing(l: Layer, t: number, base: Mat, M: Mat, options?: RenderOptions) {
    const frames = l.frames ?? [];
    const idx = frameIndexAt(frames, t);
    if (idx < 0 && !options?.onion) return;
    const p = resolve(parseParams(getObject("drawing")!, l.params), spec, t) as { opacity: number; blend: keyof typeof BLENDS };
    if (scratch.width !== canvas.width || scratch.height !== canvas.height) scratch = make(canvas.width, canvas.height);
    const g = ctxOf(scratch);
    const full = mul(base, M);
    const pxPerUnit = Math.sqrt(Math.abs(full[0] * full[3] - full[1] * full[2]));
    const composite = (i: number, alpha: number, tint?: string) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, scratch.width, scratch.height);
      g.setTransform(...full);
      drawFrame(g, frames[i], spec, make, pxPerUnit);
      if (tint) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = "source-in";
        g.fillStyle = tint;
        g.fillRect(0, 0, scratch.width, scratch.height);
        g.globalCompositeOperation = "source-over";
      }
      ctx!.save();
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.globalAlpha = alpha;
      ctx!.globalCompositeOperation = tint ? "source-over" : BLENDS[p.blend];
      ctx!.drawImage(scratch as CanvasImageSource, 0, 0);
      ctx!.restore();
    };
    const o = options?.onion;
    if (o) {
      for (let k = o.before; k >= 1; k--) if (idx - k >= 0) composite(idx - k, o.opacity * (1 - (k - 1) / (o.before + 1)), o.beforeColor);
      for (let k = o.after; k >= 1; k--) if (idx + k < frames.length) composite(idx + k, o.opacity * (1 - (k - 1) / (o.after + 1)), o.afterColor);
    }
    if (idx >= 0) composite(idx, p.opacity);
  }

  return {
    render(rawT, options) {
      const { width: W, height: H, duration } = spec.meta;
      const t = Math.min(Math.max(rawT, 0), duration);
      // fit the logical scene into the canvas; letterbox instead of stretching
      const s = Math.min(canvas.width / W, canvas.height / H);
      const base: Mat = [s, 0, 0, s, (canvas.width - W * s) / 2, (canvas.height - H * s) / 2];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(...base);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();

      const env = makeEnv(spec, t, {}, ctx);
      for (const l of spec.layers) {
        const def = getObject(l.type);
        if (!def) continue;
        const M = layerMatrix(spec, l, t, make);
        if (l.type === "drawing") {
          drawDrawing(l, t, base, M, options);
          continue;
        }
        ctx.save();
        ctx.setTransform(...mul(base, M));
        drawWith(ctx, def, parseParams(def, l.params), t, env);
        ctx.restore();
      }
      for (const o of spec.overlays) {
        const def = getObject(o.type);
        if (def) drawWith(ctx, def, parseParams(def, o.params), t, env);
      }
      ctx.restore();
    },
    setSpec(next) {
      spec = next;
    },
    dispose() {},
  };
}
