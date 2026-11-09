import type { Layer, SceneSpec } from "@anim/spec";
import "./objects";
import { layerPivot } from "./bounds";
import { ctxOf, drawFrame, frameIndexAt, type CanvasFactory } from "./drawing";
import { getImage, setCanvasFactory } from "./images";
import { IDENTITY, mul, rotate, scale, translate, type Mat } from "./matrix";
import { BLENDS } from "./objects/drawing";
import { drawWith, getObject, makeEnv, parseParams, type Ctx2D } from "./registry";
import { resolve } from "./resolve";
import { actionOffsets } from "./actions";
import { clampBone, drawMesh, meshPose, solveIK } from "./rig";

export { catalog, validateScene, objectTypes, getObject, defineObject, type ObjectDef, type Env, type ValidationResult } from "./registry";
export { evalTrack, integrate, EASE } from "./tracks";
export { rng } from "./rng";
export { resolve } from "./resolve";
export { BRUSH_PRESETS, drawStroke, strokePath, frameIndexAt, drawingPivot, type CanvasFactory } from "./drawing";
export { invert, apply, mul, type Mat } from "./matrix";
export { objectBounds, layerPivot, type Box } from "./bounds";
export { registerImage, getImage, imageSources, frameUrl, type Bitmap } from "./images";
export { boneTip, clampBone, solveIK, meshPose, meshTriangles, drawMesh, rigProblems, skeleton, mirrorBone, type MeshPose, type RigProblem, type SkeletonKind, type SkeletonOptions } from "./rig";
export { compileActions, lookAtKeys, actionTracks, actionOffsets, fitPeriod, MAX_TURN } from "./actions";

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

/**
 * Maps a layer's own coordinates to scene coordinates: camera, then each rig ancestor's transform from the root down,
 * then the layer's own (each rotates/scales about its own pivot). Bones in an IK chain take their solved rotation, and
 * every bone stays within its joint limits. `rest`: the bind pose, with every bone's own motion left out (for skinning).
 */
export function layerMatrix(spec: SceneSpec, layer: Layer | null, t: number, make: CanvasFactory = defaultFactory, rest = false): Mat {
  let m = IDENTITY;
  if (spec.camera) {
    const cam = resolve(spec.camera, spec, t);
    const cx = cam.x ?? spec.meta.width / 2, cy = cam.y ?? spec.meta.height / 2;
    m = mul(mul(translate(cx, cy), scale(cam.zoom)), translate(-cx, -cy));
  }
  // a missing parent ends the chain; the length cap guards against cycles in unvalidated specs
  const chain: Layer[] = [];
  for (let l = layer; l && chain.length <= spec.layers.length; l = l.parent === undefined ? null : (spec.layers.find((x) => x.id === l!.parent) ?? null)) chain.unshift(l);
  // the lower bone's IK rotation, solved together with its upper bone (which comes first in the chain)
  let solvedLower: { id: string; r: number; mix: number } | null = null;
  for (const l of chain) {
    const bone = l.type === "bone";
    if (rest && bone) continue;
    // actions add on top of the layer's own transform
    const add = actionOffsets(spec, l.id, t);
    const ik = bone ? spec.ik?.find((k) => k.upper === l.id) : undefined;
    const lower = solvedLower?.id === l.id ? solvedLower : null;
    if (!l.transform && !add && !ik && !lower) continue;
    const tr = resolve({ x: 0, y: 0, rotation: 0, scale: 1, ...l.transform }, spec, t);
    const [px, py] = layerPivot(spec, l, make);
    const x = tr.x + (add?.x ?? 0), y = tr.y + (add?.y ?? 0), k = tr.scale + (add?.scale ?? 0);
    let r = tr.rotation + (add?.rotation ?? 0);
    if (ik) {
      const s = solveIK(spec, ik, m, { x, y, r, k }, t, make);
      if (s) {
        r += (s.upper - r) * s.mix;
        solvedLower = { id: ik.lower, r: s.lower, mix: s.mix };
      }
    } else if (lower) r += (lower.r - r) * lower.mix;
    if (bone) r = clampBone(l, r);
    const mirror: Mat = (add?.flip ?? 0) >= 0.5 ? [-1, 0, 0, 1, 0, 0] : IDENTITY;
    m = mul(m, mul(mul(mul(mul(translate(x + px, y + py), rotate(r)), scale(k)), mirror), translate(-px, -py)));
  }
  return m;
}

/** Deterministic: render(t) depends only on the spec and t. The caller owns the clock. */
export function createRenderer(canvas: CanvasLike, initial: SceneSpec, opts: { createCanvas?: CanvasFactory } = {}): Renderer {
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("2D canvas context unavailable");
  const make = opts.createCanvas ?? defaultFactory;
  setCanvasFactory(make);
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
        let params = parseParams(def, l.params);
        const fade = actionOffsets(spec, l.id, t)?.opacity ?? 0;
        if (fade && "opacity" in params) params = { ...params, opacity: (resolve(params.opacity, spec, t) as number) + fade };
        const pose = l.mesh && meshPose(spec, l, t, make);
        const asset = pose ? spec.assets?.[String(l.params.asset)] : undefined;
        const img = asset && getImage(asset.src);
        if (pose && img) {
          // a mesh layer: the image bent by its bones (opacity as the image object applies it)
          const opacity = resolve(params.opacity, spec, t) as number;
          if (opacity > 0) {
            ctx.globalAlpha *= Math.min(1, opacity);
            const full = mul(base, M);
            drawMesh(ctx, img as CanvasImageSource & { width: number; height: number }, pose, 1.5 / (Math.sqrt(Math.abs(full[0] * full[3] - full[1] * full[2])) || 1));
          }
        } else if (!pose) drawWith(ctx, def, params, t, env);
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
export { MotionSchema, paintingBoxToScene, type Motion } from "./objects/backgrounds/painting";
