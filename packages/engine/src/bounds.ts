import type { Layer, SceneSpec } from "@anim/spec";
import { ctxOf, drawingPivot, type CanvasFactory, type Surface } from "./drawing";
import { drawWith, getObject, makeEnv, parseParams } from "./registry";

export type Box = [number, number, number, number];

const K = 0.25; // measure at quarter resolution: plenty for handles and pivots, cheap to scan
let scratch: Surface | null = null;

/**
 * What an object layer covers at time t, in its own (untransformed) coordinates, found by rendering it alone
 * and scanning for painted pixels. Clipped to the scene. Null if nothing is drawn.
 */
export function objectBounds(spec: SceneSpec, layer: Layer, t: number, make: CanvasFactory): Box | null {
  const def = getObject(layer.type);
  if (!def || layer.type === "drawing") return null;
  const w = Math.ceil(spec.meta.width * K), h = Math.ceil(spec.meta.height * K);
  if (!scratch || scratch.width !== w || scratch.height !== h) scratch = make(w, h);
  const g = ctxOf(scratch);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.setTransform(K, 0, 0, K, 0, 0);
  drawWith(g, def, parseParams(def, layer.params), t, makeEnv(spec, t, {}, g));
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0 / K, y0 / K, (x1 + 1) / K, (y1 + 1) / K];
}

const pivotCache = new WeakMap<object, { key: string; pivot: [number, number] }>();

/**
 * Point a layer rotates and scales around: its explicit `pivot` if set. Drawings: center of everything drawn. Objects: center of the area they
 * cover over the whole scene (sampled at 5 times), so it stays put while the object animates.
 */
export function layerPivot(spec: SceneSpec, layer: Layer, make: CanvasFactory): [number, number] {
  if (layer.pivot) return layer.pivot;
  // an image layer's area is in its params: no need to render it
  const p = layer.params;
  if (layer.type === "image" && typeof p.w === "number" && typeof p.h === "number") {
    const x = typeof p.x === "number" ? p.x : 0, y = typeof p.y === "number" ? p.y : 0;
    return [x + p.w / 2, y + p.h / 2];
  }
  if (layer.type === "drawing") return drawingPivot(layer) ?? [0, 0];
  const key = `${spec.meta.width}x${spec.meta.height}/${spec.meta.duration}`;
  const hit = pivotCache.get(layer.params);
  if (hit?.key === key) return hit.pivot;
  let u: Box | null = null;
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    const b = objectBounds(spec, layer, k * spec.meta.duration, make);
    if (b) u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b;
  }
  const pivot: [number, number] = u ? [(u[0] + u[2]) / 2, (u[1] + u[3]) / 2] : [spec.meta.width / 2, spec.meta.height / 2];
  pivotCache.set(layer.params, { key, pivot });
  return pivot;
}
