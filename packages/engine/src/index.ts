import type { Layer, SceneSpec } from "@anim/spec";
import "./objects";
import { layerPivot } from "./bounds";
import { ctxOf, drawFrame, frameIndexAt, type CanvasFactory } from "./drawing";
import { getImage, setCanvasFactory } from "./images";
import { apply, IDENTITY, mul, rotate, scale, translate, type Mat } from "./matrix";
import { BLENDS } from "./objects/drawing";
import { drawWith, getObject, makeEnv, parseParams, type Ctx2D } from "./registry";
import { resolve } from "./resolve";
import { actionOffsets } from "./actions";
import { clampBone, drawMesh, meshPose, solveIK } from "./rig";
import { switchVisibility } from "./face";
import { blurPixels, bloomPixels, cameraMatrix, contactShadow, depthOf, dofRadius, gradePixels, grades, lookAt, PASSES, treatPixels, type Effect, type Quality } from "./look";

export { catalog, validateScene, objectTypes, getObject, defineObject, type ObjectDef, type Env, type ValidationResult } from "./registry";
export { evalTrack, integrate, EASE } from "./tracks";
export { rng } from "./rng";
export { resolve } from "./resolve";
export { BRUSH_PRESETS, drawStroke, strokePath, frameIndexAt, drawingPivot, type CanvasFactory } from "./drawing";
export { invert, apply, mul, type Mat } from "./matrix";
export { objectBounds, layerPivot, type Box } from "./bounds";
export { registerImage, getImage, imageSources, frameUrl, type Bitmap } from "./images";
export { boneTip, clampBone, solveIK, meshPose, meshTriangles, drawMesh, rigProblems, skeleton, mirrorBone, type MeshPose, type RigProblem, type SkeletonKind, type SkeletonOptions } from "./rig";
export { setTransformAt, switchState, switchVisibility, setSwitchKey, applyExpression, applyPose, characterOf, poseProblems, EXPRESSIONS, BASE_OPTION, POSES, type Expression, type Pose, type FaceSlot, type PoseProblem } from "./face";
export { applyClip, removeClip, clipsOf, motionProblems, CLIP_NAMES, CLIP_INFO, type ClipName, type ClipArgs, type ClipResult, type MotionProblem } from "./clips";
export { bezier, easeOf } from "./tracks";
export { depthOf, cameraMatrix, lookAt, PLANE_DEPTH, PASSES, type Effect, type Quality } from "./look";
export { compileActions, lookAtKeys, actionTracks, actionOffsets, fitPeriod, requiredTurn, MAX_TURN, MAX_GAZE } from "./actions";

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
  /** How finely blur and bloom are sampled; the scene itself is the same at every quality. Default final. */
  quality?: Quality;
  /** Effects left out (troubleshooting in the editor). Never used for export. */
  off?: Effect[];
  /** A canvas of another shape than the scene: letterbox it (contain, the default) or fill it around the camera's focus (cover). */
  fit?: "contain" | "cover";
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
  // the camera: zoom, its cyclic move, and parallax by the layer's depth
  let m = cameraMatrix(spec, layer, t);
  // a missing parent ends the chain; the length cap guards against cycles in unvalidated specs
  const chain: Layer[] = [];
  for (let l = layer; l && chain.length <= spec.layers.length; l = l.parent === undefined ? null : (spec.layers.find((x) => x.id === l!.parent) ?? null)) chain.unshift(l);
  // the lower bone's IK rotation, solved together with its upper bone (which comes first in the chain)
  let solvedLower: { id: string; r: number; mix: number } | null = null;
  for (const l of chain) {
    const bone = l.type === "bone";
    if (rest && bone) continue;
    // actions add on top of the layer's own transform
    const add = actionOffsets(spec, l.id, t, make);
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

  function drawDrawing(l: Layer, t: number, base: Mat, M: Mat, options?: RenderOptions, vis = 1) {
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
    if (idx >= 0) composite(idx, p.opacity * vis);
  }

  // a second scratch for layers that get their own treatment (fog, depth of field, clipping), and one for clip shapes
  let own = make(canvas.width, canvas.height), shape = make(canvas.width, canvas.height);

  /** Draws one (non-drawing) layer with g's transform already at its matrix. */
  function paint(g: Ctx2D, sp: SceneSpec, l: Layer, def: NonNullable<ReturnType<typeof getObject>>, t: number, full: Mat, vis: number, env: ReturnType<typeof makeEnv>) {
    g.globalAlpha = vis;
    let params = parseParams(def, l.params);
    const fade = actionOffsets(sp, l.id, t, make)?.opacity ?? 0;
    if (fade && "opacity" in params) params = { ...params, opacity: (resolve(params.opacity, sp, t) as number) + fade };
    const pose = l.mesh && meshPose(sp, l, t, make);
    const asset = pose ? sp.assets?.[String(l.params.asset)] : undefined;
    const img = asset && getImage(asset.src);
    if (pose && img) {
      // a mesh layer: the image bent by its bones (opacity as the image object applies it)
      const opacity = resolve(params.opacity, sp, t) as number;
      if (opacity > 0) {
        g.globalAlpha *= Math.min(1, opacity);
        drawMesh(g, img as CanvasImageSource & { width: number; height: number }, pose, 1.5 / (Math.sqrt(Math.abs(full[0] * full[3] - full[1] * full[2])) || 1));
      }
    } else if (!pose) drawWith(g, def, params, t, env);
  }

  /** Where a layer draws on the canvas (device pixels), padded by `pad`; the whole canvas when it can't be told cheaply. */
  function deviceBox(l: Layer, full: Mat, pad: number): [number, number, number, number] {
    const p = l.params;
    let box: [number, number, number, number] = [0, 0, canvas.width, canvas.height];
    if (l.type === "image" && !l.mesh && [p.w, p.h].every((v) => typeof v === "number") && [p.x ?? 0, p.y ?? 0].every((v) => typeof v === "number")) {
      const x = (p.x as number | undefined) ?? 0, y = (p.y as number | undefined) ?? 0;
      const pts = [[x, y], [x + (p.w as number), y], [x, y + (p.h as number)], [x + (p.w as number), y + (p.h as number)]].map(([a, b]) => apply(full, a, b));
      box = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
    }
    return [Math.max(0, Math.floor(box[0] - pad)), Math.max(0, Math.floor(box[1] - pad)), Math.min(canvas.width, Math.ceil(box[2] + pad)), Math.min(canvas.height, Math.ceil(box[3] + pad))];
  }

  return {
    render(rawT, options) {
      const off = new Set(options?.off ?? []);
      // with the camera switched off (troubleshooting), the shot holds still
      const sp: SceneSpec = off.has("camera") && spec.camera ? { ...spec, camera: { ...spec.camera, motion: undefined, parallax: 0 } } : spec;
      const quality = options?.quality ?? "final";
      const { width: W, height: H, duration } = sp.meta;
      const t = Math.min(Math.max(rawT, 0), duration);
      // fit the scene into the canvas: letterboxed (contain), or filling it around the camera's focus (cover, for a
      // render of another shape); never stretched
      const cover = options?.fit === "cover";
      const s = cover ? Math.max(canvas.width / W, canvas.height / H) : Math.min(canvas.width / W, canvas.height / H);
      const [fx, fy] = sp.camera?.focus ?? [W / 2, H / 2];
      const ox = cover ? Math.min(0, Math.max(canvas.width - W * s, canvas.width / 2 - fx * s)) : (canvas.width - W * s) / 2;
      const oy = cover ? Math.min(0, Math.max(canvas.height - H * s, canvas.height / 2 - fy * s)) : (canvas.height - H * s) / 2;
      const base: Mat = [s, 0, 0, s, ox, oy];
      const look = lookAt(sp.look, sp, t, off);
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

      const env = makeEnv(sp, t, {}, ctx);
      for (const l of sp.layers) {
        const def = getObject(l.type);
        if (!def) continue;
        // a switched-off option (another face state or view) draws nothing; a fading one draws part-transparent
        const vis = switchVisibility(sp, l, t);
        if (vis <= 0) continue;
        if (l.shadow && !off.has("shadows")) {
          ctx.save();
          ctx.setTransform(...base);
          contactShadow(ctx, sp, l, t, look?.light?.direction ?? 250, make);
          ctx.restore();
        }
        const M = layerMatrix(sp, l, t, make);
        if (l.type === "drawing") {
          drawDrawing(l, t, base, M, options, vis);
          continue;
        }
        // groups and bones draw nothing: no treatment for them
        const draws = l.type !== "group" && l.type !== "bone";
        const depth = look ? depthOf(sp, l) : 0.5;
        const blur = look && quality !== "draft" ? dofRadius(look, depth, canvas.width) : 0;
        const fogged = !!look?.fog && depth > look.fog.near;
        const full = mul(base, M);
        if (!draws || (!fogged && blur < 0.5 && !l.clip)) {
          ctx.save();
          ctx.setTransform(...full);
          paint(ctx, sp, l, def, t, full, vis, env);
          ctx.restore();
          continue;
        }
        // its own treatment: drawn alone, clipped, fogged and blurred by its depth, then laid onto the frame
        if (own.width !== canvas.width || own.height !== canvas.height) [own, shape] = [make(canvas.width, canvas.height), make(canvas.width, canvas.height)];
        const g = ctxOf(own);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
        g.clearRect(0, 0, own.width, own.height);
        g.setTransform(...full);
        paint(g, sp, l, def, t, full, vis, makeEnv(sp, t, {}, g));
        const clipTo = l.clip ? sp.layers.find((x) => x.id === l.clip) : undefined;
        const clipDef = clipTo && getObject(clipTo.type);
        if (clipTo && clipDef) {
          const h = ctxOf(shape);
          h.setTransform(1, 0, 0, 1, 0, 0);
          h.clearRect(0, 0, shape.width, shape.height);
          const cm = mul(base, layerMatrix(sp, clipTo, t, make));
          h.setTransform(...cm);
          paint(h, sp, clipTo, clipDef, t, cm, 1, makeEnv(sp, t, {}, h));
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalAlpha = 1;
          g.globalCompositeOperation = "destination-in";
          g.drawImage(shape as CanvasImageSource, 0, 0);
          g.globalCompositeOperation = "source-over";
        }
        if (look && (fogged || blur >= 0.5)) {
          const [x0, y0, x1, y1] = deviceBox(l, full, blur * 3 + 2);
          if (x1 > x0 && y1 > y0) {
            const img = g.getImageData(x0, y0, x1 - x0, y1 - y0);
            if (fogged) treatPixels(img.data, look, depth, [0, 0, x1 - x0, y1 - y0], x1 - x0);
            if (blur >= 0.5) blurPixels(img.data, x1 - x0, y1 - y0, blur, PASSES[quality]);
            g.putImageData(img, x0, y0);
          }
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(own as CanvasImageSource, 0, 0);
        ctx.restore();
      }
      for (const o of sp.overlays) {
        const def = getObject(o.type);
        if (def) drawWith(ctx, def, parseParams(def, o.params), t, env);
      }
      ctx.restore();
      // the frame's grade and bloom, on the finished pixels
      if (look && (grades(look) || look.light)) {
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (look.bloom && quality !== "draft") bloomPixels(img.data, canvas.width, canvas.height, look.bloom.amount, look.bloom.threshold, PASSES[quality]);
        gradePixels(img.data, canvas.width, canvas.height, look);
        ctx.putImageData(img, 0, 0);
      }
    },
    setSpec(next) {
      spec = next;
    },
    dispose() {},
  };
}
export { MotionSchema, paintingBoxToScene, type Motion } from "./objects/backgrounds/painting";
