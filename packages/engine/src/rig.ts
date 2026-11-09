// Hybrid rigging: bone layers (FK through the ordinary parent chain), two-bone IK solved at render time, and image
// meshes skinned to bones. Everything is a pure function of the scene and the time, so preview and export match.
import type { IK, Layer, SceneSpec } from "@anim/spec";
import { contactLevel } from "./actions";
import { layerPivot } from "./bounds";
import type { CanvasFactory } from "./drawing";
import { defaultFactory, layerMatrix } from "./index";
import { apply, invert, mul, type Mat } from "./matrix";
import type { Ctx2D } from "./registry";
import { resolve } from "./resolve";

type Pt = [number, number];
type BoneParams = { length: number; angle?: number; min?: number; max?: number };
const params = (l: Layer) => l.params as BoneParams;
const find = (spec: SceneSpec, id: string) => spec.layers.find((l) => l.id === id);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Where a bone ends, in its own coordinates. */
export function boneTip(l: Layer): Pt {
  const [x, y] = l.pivot ?? [0, 0];
  const { length, angle = 0 } = params(l);
  return [x + length * Math.cos(angle), y + length * Math.sin(angle)];
}

/** A bone rotation kept within the bone's joint limits. */
export function clampBone(l: Layer, r: number): number {
  const { min, max } = params(l);
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, r));
}

/** The upper bone's own transform as layerMatrix is about to apply it. */
export type Pose = { x: number; y: number; r: number; k: number };

let depth = 0;

/**
 * Two-bone IK in the upper bone's parent space (`parent` maps that space to the scene): the rotations that put the end of
 * the lower bone on the target's pivot, with joint limits applied (so a limited joint may fall short). Out-of-reach
 * targets straighten the limb toward them. Null when the chain can't be solved (missing layers, zero-length bones).
 */
export function solveIK(spec: SceneSpec, ik: IK, parent: Mat, upper: Pose, t: number, make: CanvasFactory): { upper: number; lower: number; mix: number } | null {
  const U = find(spec, ik.upper), L = find(spec, ik.lower), T = find(spec, ik.target);
  // a target that (wrongly) hangs off the limb would recurse forever in an unvalidated scene
  if (!U?.pivot || !L?.pivot || !T || depth > 8) return null;
  const lt = resolve({ x: 0, y: 0, scale: 1, ...L.transform }, spec, t);
  const P1 = U.pivot, E: Pt = [L.pivot[0] + lt.x, L.pivot[1] + lt.y];
  const l1 = Math.abs(upper.k) * Math.hypot(E[0] - P1[0], E[1] - P1[1]);
  const l2 = Math.abs(upper.k * lt.scale) * params(L).length;
  if (l1 < 1e-6 || l2 < 1e-6) return null;
  depth++;
  let world: Pt;
  try {
    world = apply(layerMatrix(spec, T, t, make), ...layerPivot(spec, T, make));
  } finally {
    depth--;
  }
  const [tx, ty] = apply(invert(parent), ...world);
  const J: Pt = [upper.x + P1[0], upper.y + P1[1]];
  const a1 = Math.atan2(E[1] - P1[1], E[0] - P1[0]), a2 = params(L).angle ?? 0;
  const d = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, Math.hypot(tx - J[0], ty - J[1])));
  const toward = Math.atan2(ty - J[1], tx - J[0]);
  const bendAt = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const r1 = clampBone(U, wrap(toward - ik.bend * bendAt - a1));
  const elbow: Pt = [J[0] + l1 * Math.cos(a1 + r1), J[1] + l1 * Math.sin(a1 + r1)];
  const r2 = clampBone(L, wrap(Math.atan2(ty - elbow[1], tx - elbow[0]) - r1 - a2));
  // a contact holds the limb on its target however the mix is set
  const mix = Math.max(contactLevel(spec, ik.target, t), Math.min(1, Math.max(0, resolve(ik.mix, spec, t) as number)));
  return { upper: r1, lower: r2, mix };
}

/** A deformed image mesh: vertices row by row, their texture position (0–1) and where they are now, in layer coordinates. */
export type MeshPose = { cols: number; rows: number; uv: Pt[]; rest: Pt[]; posed: Pt[] };

function segmentDistance(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const k = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}

/**
 * Where an image layer's mesh vertices are at time t. Each bone moves a vertex by how far the bone has turned from how
 * it was drawn (its rest pose: every bone's own transform ignored); a vertex blends the bones by weight. Without
 * explicit weights, a vertex follows the bones nearest to it, smoothly (inverse fourth power of the distance), and parts
 * of the image far from every listed bone stay where they are: staying counts as a bone half a bone-length away. So
 * ticking only the arm bones bends the arm, not the whole body.
 */
export function meshPose(spec: SceneSpec, layer: Layer, t: number, make: CanvasFactory = defaultFactory): MeshPose | null {
  const mesh = layer.mesh;
  if (!mesh) return null;
  const bones = mesh.bones.map((id) => find(spec, id));
  if (!bones.every((b) => b?.type === "bone" && b.pivot)) return null;
  const p = resolve(layer.params, spec, t) as { x?: number; y?: number; w: number; h: number };
  const x = p.x ?? 0, y = p.y ?? 0;
  const W = layerMatrix(spec, layer, t, make), iW = invert(W);
  const skin: Mat[] = [], segs: [Pt, Pt][] = [];
  for (const b of bones as Layer[]) {
    const rest = layerMatrix(spec, b, t, make, true);
    skin.push(mul(iW, mul(layerMatrix(spec, b, t, make), mul(invert(rest), W))));
    const toLayer = mul(iW, rest);
    segs.push([apply(toLayer, ...b.pivot!), apply(toLayer, ...boneTip(b))]);
  }
  const soft = 0.03 * Math.hypot(p.w, p.h) || 1;
  const reach = 0.5 * (segs.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0) / segs.length) + soft;
  const stay = mesh.weights ? 0 : (1 / reach) ** 4;
  const uv: Pt[] = [], restPts: Pt[] = [], posed: Pt[] = [];
  for (let j = 0, n = 0; j <= mesh.rows; j++)
    for (let i = 0; i <= mesh.cols; i++, n++) {
      const u = i / mesh.cols, v = j / mesh.rows;
      const q: Pt = [x + u * p.w, y + v * p.h];
      const raw = mesh.weights?.[n] ?? segs.map(([a, b]) => (1 / (segmentDistance(q, a, b) + soft)) ** 4);
      const sum = raw.reduce((s, w) => s + w, 0) + stay;
      let px = 0, py = 0;
      if (sum > 0) {
        raw.forEach((w, k) => {
          const [ax, ay] = apply(skin[k], ...q);
          px += (w / sum) * ax;
          py += (w / sum) * ay;
        });
        px += (stay / sum) * q[0];
        py += (stay / sum) * q[1];
      } else [px, py] = q; // no weight: the vertex stays with the layer
      uv.push([u, v]);
      restPts.push(q);
      posed.push([px, py]);
    }
  return { cols: mesh.cols, rows: mesh.rows, uv, rest: restPts, posed };
}

/** The two triangles of every mesh cell, as vertex indices. */
export function meshTriangles(cols: number, rows: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      out.push([a, b, d], [a, d, c]);
    }
  return out;
}

/**
 * Draws an image through its deformed mesh: each triangle of the picture is mapped (affinely) onto its posed triangle.
 * Triangles are clipped `pad` units larger than they are, so no hairline gaps show between them.
 */
export function drawMesh(ctx: Ctx2D, img: CanvasImageSource & { width: number; height: number }, pose: MeshPose, pad: number) {
  const W = img.width, H = img.height;
  for (const [ia, ib, ic] of meshTriangles(pose.cols, pose.rows)) {
    const [u0, v0] = [pose.uv[ia][0] * W, pose.uv[ia][1] * H], [u1, v1] = [pose.uv[ib][0] * W, pose.uv[ib][1] * H], [u2, v2] = [pose.uv[ic][0] * W, pose.uv[ic][1] * H];
    const [x0, y0] = pose.posed[ia], [x1, y1] = pose.posed[ib], [x2, y2] = pose.posed[ic];
    const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (!den) continue;
    const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den, c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
    const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den, d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
    const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
    const out = (px: number, py: number): Pt => {
      const n = Math.hypot(px - cx, py - cy) || 1;
      return [px + ((px - cx) / n) * pad, py + ((py - cy) / n) * pad];
    };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...out(x0, y0));
    ctx.lineTo(...out(x1, y1));
    ctx.lineTo(...out(x2, y2));
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
}

export type RigProblem = { layer: string; level: "error" | "warning"; message: string };

const signedArea = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);

/**
 * What is wrong with a scene's rig: joints that don't meet their parent bone's end, IK that bends a limb against how it
 * was drawn, meshes with unweighted vertices, and meshes that fold over or stretch badly at any of `samples` times.
 */
export function rigProblems(spec: SceneSpec, make: CanvasFactory = defaultFactory, samples = 9): RigProblem[] {
  const out: RigProblem[] = [];
  for (const l of spec.layers) {
    if (l.type !== "bone") continue;
    const parent = l.parent === undefined ? undefined : find(spec, l.parent);
    // a joint must sit on its parent bone (at its end for a limb, anywhere along it for a branch like a tail)
    if (parent?.type === "bone" && parent.pivot && l.pivot) {
      const gap = segmentDistance(l.pivot, parent.pivot, boneTip(parent));
      if (gap > Math.max(2, params(parent).length * 0.1)) out.push({ layer: l.id, level: "warning", message: `Its joint is ${Math.round(gap)} units off "${parent.id}", so the limb looks disconnected when it bends` });
    }
    const s = l.transform?.scale;
    if (typeof s === "number" && s < 0) out.push({ layer: l.id, level: "error", message: "Its scale is negative, so the bone is flipped" });
  }
  for (const k of spec.ik ?? []) {
    const U = find(spec, k.upper), L = find(spec, k.lower);
    if (!U?.pivot || !L?.pivot) continue;
    const [ex, ey] = L.pivot, [wx, wy] = boneTip(L);
    // which way the limb is drawn bent: the side the end lies on, seen from the upper bone
    const cross = (ex - U.pivot[0]) * (wy - U.pivot[1]) - (ey - U.pivot[1]) * (wx - U.pivot[0]);
    // the solver puts the middle joint where cross > 0 for bend 1
    if (Math.abs(cross) > 1e-6 && Math.sign(cross) !== k.bend) out.push({ layer: k.lower, level: "warning", message: `IK "${k.id}" bends it the opposite way to how it is drawn; flip its bend` });
  }
  const times = Array.from({ length: samples }, (_, i) => (spec.meta.duration * i) / Math.max(1, samples - 1));
  for (const l of spec.layers) {
    if (!l.mesh) continue;
    if (l.mesh.weights?.some((w) => !w.some((v) => v > 0))) out.push({ layer: l.id, level: "error", message: "Some mesh vertices have no bone weight, so they don't follow the rig" });
    let fold: number | null = null, stretch: number | null = null;
    for (const t of times) {
      const pose = meshPose(spec, l, t, make);
      if (!pose) {
        out.push({ layer: l.id, level: "error", message: "Its mesh lists a bone that is missing or has no joint" });
        break;
      }
      for (const [a, b, c] of meshTriangles(pose.cols, pose.rows)) {
        if (fold === null && Math.sign(signedArea(pose.posed[a], pose.posed[b], pose.posed[c])) !== Math.sign(signedArea(pose.rest[a], pose.rest[b], pose.rest[c]))) fold = t;
        for (const [i, j] of [[a, b], [b, c], [c, a]]) {
          const r = Math.hypot(pose.rest[i][0] - pose.rest[j][0], pose.rest[i][1] - pose.rest[j][1]);
          if (stretch === null && r > 0 && Math.hypot(pose.posed[i][0] - pose.posed[j][0], pose.posed[i][1] - pose.posed[j][1]) > r * 1.6) stretch = t;
        }
      }
    }
    if (fold !== null) out.push({ layer: l.id, level: "warning", message: `Its mesh folds over itself at ${+fold.toFixed(2)}s; reduce the bend or add a bone` });
    if (stretch !== null) out.push({ layer: l.id, level: "warning", message: `Its mesh stretches over 60% at ${+stretch.toFixed(2)}s` });
  }
  return out;
}

// Templates: [name, parent (null = the character), joint, end], as fractions of the character's box.
type BoneDef = [string, string | null, Pt, Pt];
const side = (defs: BoneDef[]): BoneDef[] =>
  defs.flatMap(([n, p, j, e]) => [
    [`${n}_l`, p && (p.endsWith("*") ? `${p.slice(0, -1)}_l` : p), j, e],
    [`${n}_r`, p && (p.endsWith("*") ? `${p.slice(0, -1)}_r` : p), [1 - j[0], j[1]], [1 - e[0], e[1]]],
  ]);
// a front-facing figure; its left side (_l) is on the viewer's right
const HUMAN: BoneDef[] = [
  ["hips", null, [0.5, 0.55], [0.5, 0.42]],
  ["spine", "hips", [0.5, 0.42], [0.5, 0.28]],
  ["neck", "spine", [0.5, 0.28], [0.5, 0.2]],
  ["head", "neck", [0.5, 0.2], [0.5, 0.03]],
  ...side([
    // collarbones and hip bones carry the limbs out from the spine, so every joint sits on its parent bone
    ["shoulder", "spine", [0.5, 0.28], [0.62, 0.29]],
    ["hip", "hips", [0.5, 0.55], [0.56, 0.55]],
    ["upper_arm", "shoulder*", [0.62, 0.29], [0.69, 0.44]],
    ["lower_arm", "upper_arm*", [0.69, 0.44], [0.73, 0.58]],
    ["hand", "lower_arm*", [0.73, 0.58], [0.75, 0.64]],
    ["upper_leg", "hip*", [0.56, 0.55], [0.57, 0.75]],
    ["lower_leg", "upper_leg*", [0.57, 0.75], [0.58, 0.93]],
    ["foot", "lower_leg*", [0.58, 0.93], [0.64, 0.98]],
  ]),
];
const HAIR: BoneDef[] = [
  ["hair_1", "head", [0.5, 0.05], [0.42, 0.12]],
  ["hair_2", "hair_1", [0.42, 0.12], [0.4, 0.2]],
  ["hair_3", "hair_2", [0.4, 0.2], [0.41, 0.28]],
];
// a four-legged animal seen from the side, facing right
const ANIMAL: BoneDef[] = [
  ["hips", null, [0.3, 0.45], [0.55, 0.43]],
  ["chest", "hips", [0.55, 0.43], [0.72, 0.4]],
  ["neck", "chest", [0.72, 0.4], [0.8, 0.28]],
  ["head", "neck", [0.8, 0.28], [0.96, 0.32]],
  ["upper_front_leg", "chest", [0.7, 0.403], [0.7, 0.72]],
  ["lower_front_leg", "upper_front_leg", [0.7, 0.72], [0.71, 0.96]],
  ["upper_back_leg", "hips", [0.33, 0.448], [0.33, 0.72]],
  ["lower_back_leg", "upper_back_leg", [0.33, 0.72], [0.32, 0.96]],
];
const TAIL: BoneDef[] = [
  ["tail_1", "hips", [0.3, 0.45], [0.19, 0.36]],
  ["tail_2", "tail_1", [0.19, 0.36], [0.1, 0.26]],
  ["tail_3", "tail_2", [0.1, 0.26], [0.04, 0.13]],
];
const EARS: BoneDef[] = [
  ["ear_l", "head", [0.84, 0.29], [0.85, 0.06]],
  ["ear_r", "head", [0.88, 0.3], [0.91, 0.08]],
];

export type SkeletonKind = "human" | "animal";
export type SkeletonOptions = { hair?: boolean; tail?: boolean; ears?: boolean };

/**
 * Bone layers for a first rig, fitted to `box` [x0, y0, x1, y1] (the character, in its own coordinates). Ids are
 * `<prefix>_<bone>`; the root bone is parented to `parent`.
 */
export function skeleton(kind: SkeletonKind, prefix: string, parent: string, box: [number, number, number, number], opts: SkeletonOptions = {}): Layer[] {
  const defs = kind === "human" ? [...HUMAN, ...(opts.hair ? HAIR : [])] : [...ANIMAL, ...(opts.tail ? TAIL : []), ...(opts.ears ? EARS : [])];
  const at = ([fx, fy]: Pt): Pt => [box[0] + fx * (box[2] - box[0]), box[1] + fy * (box[3] - box[1])];
  const r = (v: number) => +v.toFixed(3);
  return defs.map(([name, p, j, e]) => {
    const [jx, jy] = at(j), [ex, ey] = at(e);
    return {
      // keys in schema order, so a saved and reloaded scene is byte-for-byte the same
      id: `${prefix}_${name}`,
      type: "bone",
      params: { length: Math.max(0.5, r(Math.hypot(ex - jx, ey - jy))), angle: r(Math.atan2(ey - jy, ex - jx)) },
      parent: p === null ? parent : `${prefix}_${p}`,
      pivot: [r(jx), r(jy)],
    } satisfies Layer;
  });
}

const other = (id: string) => (/_l$/.test(id) ? id.replace(/_l$/, "_r") : /_r$/.test(id) ? id.replace(/_r$/, "_l") : null);

/**
 * Copies a side's bone (`…_l` / `…_r`) onto the other side, mirrored about the vertical line x = axis: joint, direction
 * and limits. The counterpart is updated if it exists, else added right after. Null if the bone has no side.
 */
export function mirrorBone(spec: SceneSpec, id: string, axis: number): SceneSpec | null {
  const b = find(spec, id), twin = other(id);
  if (!b || b.type !== "bone" || !b.pivot || !twin) return null;
  const p = params(b);
  const parent = b.parent && other(b.parent) && find(spec, other(b.parent)!) ? other(b.parent)! : b.parent;
  const mirrored: Layer = {
    ...b,
    id: twin,
    ...(parent !== undefined && { parent }),
    pivot: [+(2 * axis - b.pivot[0]).toFixed(3), b.pivot[1]],
    params: { ...b.params, angle: +wrap(Math.PI - (p.angle ?? 0)).toFixed(3), ...(p.max !== undefined ? { min: -p.max } : {}), ...(p.min !== undefined ? { max: -p.min } : {}) },
  };
  if (p.min === undefined) delete (mirrored.params as BoneParams).max;
  if (p.max === undefined) delete (mirrored.params as BoneParams).min;
  const i = spec.layers.findIndex((l) => l.id === twin);
  const layers = i >= 0 ? spec.layers.map((l, k) => (k === i ? { ...mirrored, transform: l.transform } : l)) : spec.layers.flatMap((l) => (l.id === id ? [l, { ...mirrored, transform: undefined }] : [l]));
  return { ...spec, layers };
}
