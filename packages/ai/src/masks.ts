// Pixel work for layered generation: cut parts out of a source image with masks, and check them before they become layers.
// Plain RGBA arrays, so this runs anywhere and the host decides how PNGs are decoded/encoded.
import { AIError } from "./types";

/** RGBA pixels, row-major. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };
/** One byte per pixel, 0 = out, 255 = in. */
export type Mask = Uint8Array;
export type Box = [number, number, number, number];

const ON = 128;

/** A mask from a decoded mask image (white = in), resized by nearest neighbour if the model returned another size of the same shape. */
export function maskFrom(r: Raster, width = r.width, height = r.height): Mask {
  // a mask of another aspect ratio wouldn't line up with its image once resized
  if (!r.width || !r.height || Math.abs(r.width / r.height - width / height) > 0.02 * (width / height))
    throw new AIError(`The mask is ${r.width}×${r.height} but its image is ${width}×${height}, so it doesn't line up`, "Try again; the source painting is kept.");
  const m = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sx = Math.min(r.width - 1, Math.floor((x * r.width) / width)), sy = Math.min(r.height - 1, Math.floor((y * r.height) / height));
      m[y * width + x] = r.data[(sy * r.width + sx) * 4];
    }
  return m;
}

/** The mask as an opaque grey image (white = in), for storing beside the parts. */
export function maskImage(m: Mask, width: number, height: number): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < m.length; i++) data.set([m[i], m[i], m[i], 255], i * 4);
  return { width, height, data };
}

export const count = (m: Mask) => m.reduce((n, v) => n + (v >= ON ? 1 : 0), 0);
export const intersect = (a: Mask, b: Mask): Mask => a.map((v, i) => Math.min(v, b[i]));
export const subtract = (a: Mask, b: Mask): Mask => a.map((v, i) => (b[i] >= ON ? 0 : v));
export const union = (a: Mask, b: Mask): Mask => a.map((v, i) => Math.max(v, b[i]));

/** Square dilation by r pixels, as a 0/255 mask. Two separable linear-time passes, so a large radius stays cheap. */
export function grow(m: Mask, width: number, height: number, r: number): Mask {
  const pass = (src: Mask, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    const [n, len] = horizontal ? [height, width] : [width, height];
    const near = new Int32Array(len);
    for (let a = 0; a < n; a++) {
      const at = (b: number) => (horizontal ? a * width + b : b * width + a);
      // distance to the nearest set pixel on the left, then on the right
      for (let b = 0, last = -Infinity; b < len; b++) {
        if (src[at(b)] >= ON) last = b;
        near[b] = b - last > r ? r + 1 : b - last;
      }
      for (let b = len - 1, last = Infinity; b >= 0; b--) {
        if (src[at(b)] >= ON) last = b;
        out[at(b)] = Math.min(near[b], last - b) <= r ? 255 : 0;
      }
    }
    return out;
  };
  return pass(pass(m, true), false);
}

/** Bounding box [x0, y0, x1, y1) of the pixels in a mask; null if empty. */
export function maskBox(m: Mask, width: number): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++)
    if (m[i] >= ON) {
      const x = i % width, y = (i / width) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

export function centroid(m: Mask, width: number): [number, number] | null {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < m.length; i++)
    if (m[i] >= ON) {
      sx += i % width;
      sy += (i / width) | 0;
      n++;
    }
  return n ? [sx / n, sy / n] : null;
}

/** The source with its alpha replaced by the mask (kept no higher than the source's own alpha). */
export function cutout(src: Raster, m: Mask): Raster {
  const data = new Uint8ClampedArray(src.data);
  for (let i = 0; i < m.length; i++) data[i * 4 + 3] = Math.min(data[i * 4 + 3], m[i]);
  return { width: src.width, height: src.height, data };
}

export const alphaMask = (r: Raster): Mask => {
  const m = new Uint8Array(r.width * r.height);
  for (let i = 0; i < m.length; i++) m[i] = r.data[i * 4 + 3];
  return m;
};

/**
 * Removes edge halos: semi-transparent pixels take the color of the nearest solid pixels instead of the (white)
 * background they were cut from. Alpha is untouched.
 */
export function defringe(r: Raster, radius = 2): Raster {
  const { width: w, height: h } = r;
  const src = r.data, data = new Uint8ClampedArray(src);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = src[i + 3];
      if (a === 0 || a >= 250) continue;
      let R = 0, G = 0, B = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = (yy * w + xx) * 4;
          if (src[j + 3] >= 250) {
            R += src[j]; G += src[j + 1]; B += src[j + 2]; n++;
          }
        }
      if (n) data.set([R / n, G / n, B / n], i);
    }
  return { width: w, height: h, data };
}

export function crop(r: Raster, [x0, y0, x1, y1]: Box): Raster {
  const width = x1 - x0, height = y1 - y0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) data.set(r.data.subarray(((y0 + y) * r.width + x0) * 4, ((y0 + y) * r.width + x1) * 4), y * width * 4);
  return { width, height, data };
}

/**
 * Problems that make an image unusable as a separate part: nothing in it, a whole opaque frame, or a plain
 * rectangle (a box crop, not a segmentation). Returned as readable sentences; empty means usable.
 */
export function partProblems(r: Raster, name: string): string[] {
  const m = alphaMask(r);
  const n = count(m);
  const total = r.width * r.height;
  if (n < total * 0.002) return [`${name}: the mask is empty`];
  if (n > total * 0.97) return [`${name}: the whole image is opaque, so it is not a separated part`];
  const b = maskBox(m, r.width)!;
  // a real subject leaves its box's corners empty; a framed picture fills it (rounded corners and all)
  if (n > (b[2] - b[0]) * (b[3] - b[1]) * 0.93) return [`${name}: the mask is a plain rectangle, not a cut-out of the part`];
  return [];
}

/** Whether the mask runs along an edge of its image (more than a tenth of that edge): the subject was cut off there. */
export function touchesEdge(m: Mask, width: number, height: number): boolean {
  let top = 0, bottom = 0, left = 0, right = 0;
  for (let x = 0; x < width; x++) {
    if (m[x] >= ON) top++;
    if (m[(height - 1) * width + x] >= ON) bottom++;
  }
  for (let y = 0; y < height; y++) {
    if (m[y * width] >= ON) left++;
    if (m[y * width + width - 1] >= ON) right++;
  }
  return Math.max(top, bottom) > width * 0.1 || Math.max(left, right) > height * 0.1;
}

/**
 * Share of a part's soft edge that is near-white: a halo left from the white background parts are painted on.
 * Dark edges are not counted: anime line art outlines everything in near-black.
 */
// pale and nearly grey: white or beige painting background, or a white "sticker" outline the painter drew
const pale = (d: Uint8ClampedArray, i: number) => {
  const lo = Math.min(d[i], d[i + 1], d[i + 2]), hi = Math.max(d[i], d[i + 1], d[i + 2]);
  return lo > 200 && hi - lo < 40;
};

/**
 * Peels pale pixels off a cut-out's outer edge, one ring at a time (up to `rings`): a painted white outline or leftover
 * background around hair. Pale details inside the part (highlights) never touch the edge, so they stay. Parts that are
 * mostly pale themselves (a white cup) are left alone, since their own edge would be eaten.
 */
export function peelPale(r: Raster, rings = 8): Raster {
  const { width: w, height: h } = r;
  const data = new Uint8ClampedArray(r.data);
  // judge the part by its inside (deeper than the peel reaches), not by the outline being peeled
  const outside = Uint8Array.from({ length: w * h }, (_, i) => (data[i * 4 + 3] === 0 ? 255 : 0));
  const near = grow(outside, w, h, rings);
  let solid = 0, light = 0;
  for (let i = 0; i < w * h; i++)
    if (!near[i]) {
      solid++;
      if (pale(data, i * 4)) light++;
    }
  if (!solid || light / solid > 0.15) return r;
  const open = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || data[(y * w + x) * 4 + 3] === 0;
  for (let k = 0; k < rings; k++) {
    const peel: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 3] && pale(data, i) && (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1))) peel.push(i);
      }
    if (!peel.length) break;
    for (const i of peel) data[i + 3] = 0;
  }
  return { width: w, height: h, data };
}

export function haloShare(r: Raster): number {
  let edge = 0, bad = 0;
  for (let i = 0; i < r.width * r.height; i++) {
    const a = r.data[i * 4 + 3];
    if (a === 0 || a >= 250) continue;
    edge++;
    const [R, G, B] = r.data.subarray(i * 4, i * 4 + 3);
    if (Math.min(R, G, B) > 235) bad++;
  }
  return edge ? bad / edge : 0;
}

/**
 * Where the head joins the body: the middle of the head pixels within `reach` of the body. Null when they don't
 * touch (the pivot then needs a person to place it).
 */
export function neckPoint(head: Mask, body: Mask, width: number, height: number, reach: number): [number, number] | null {
  return centroid(intersect(head, grow(body, width, height, reach)), width);
}

/** Copies `from`'s pixels into `to` where the mask is set (blending by mask value). */
export function paste(to: Raster, from: Raster, m: Mask): Raster {
  const data = new Uint8ClampedArray(to.data);
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const k = m[i] / 255;
    for (let c = 0; c < 4; c++) data[i * 4 + c] = to.data[i * 4 + c] * (1 - k) + from.data[i * 4 + c] * k;
  }
  return { width: to.width, height: to.height, data };
}

/**
 * Fills `region` by spreading the colors of the `known` pixels around it inward, ring by ring. It adds no new detail,
 * so unlike a diffusion repaint it can never invent a face. Region pixels no known pixel reaches stay transparent.
 */
export function smear(r: Raster, region: Mask, known: Mask): { r: Raster; filled: Mask } {
  const { width: w, height: h } = r;
  const data = new Uint8ClampedArray(r.data);
  const have = Uint8Array.from(known, (v, i) => (v >= ON && region[i] < ON ? 1 : 0));
  const filled = new Uint8Array(w * h);
  let todo: number[] = [];
  for (let i = 0; i < region.length; i++) if (region[i] >= ON) todo.push(i);
  while (todo.length) {
    const next: number[] = [], done: number[] = [];
    for (const i of todo) {
      const x = i % w, y = (i / w) | 0;
      let R = 0, G = 0, B = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, j = yy * w + xx;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && have[j]) {
            R += data[j * 4];
            G += data[j * 4 + 1];
            B += data[j * 4 + 2];
            n++;
          }
        }
      if (!n) next.push(i);
      else {
        data.set([R / n, G / n, B / n, 255], i * 4);
        done.push(i);
      }
    }
    if (!done.length) break;
    // a ring only becomes a source for the next ring, so the fill doesn't depend on scan order
    for (const i of done) have[i] = filled[i] = 255;
    todo = next;
  }
  for (const i of todo) data[i * 4 + 3] = 0;
  return { r: { width: w, height: h, data }, filled };
}

/** Square erosion by r pixels: the mask's outside grown, inverted. */
export function shrink(m: Mask, width: number, height: number, r: number): Mask {
  const out = grow(m.map((v) => (v >= ON ? 0 : 255)), width, height, r);
  return out.map((v) => (v ? 0 : 255));
}

/** Connected (4-neighbour) runs of pixels where `on(i)`, each as a list of indices. */
function components(n: number, width: number, on: (i: number) => boolean): number[][] {
  const seen = new Uint8Array(n);
  const out: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || !on(s)) continue;
    const comp = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width])
        if (j >= 0 && j < n && !seen[j] && on(j)) {
          seen[j] = 1;
          comp.push(j);
        }
    }
    out.push(comp);
  }
  return out;
}

/** Fills holes inside the mask (gaps that don't reach the image edge) of up to `maxArea` pixels; bigger ones (the gap in a mug handle) stay. */
export function fillHoles(m: Mask, width: number, height: number, maxArea: number): Mask {
  const out = Uint8Array.from(m, (v) => (v >= ON ? 255 : 0));
  const onEdge = (i: number) => {
    const x = i % width, y = (i / width) | 0;
    return x === 0 || y === 0 || x === width - 1 || y === height - 1;
  };
  for (const c of components(m.length, width, (i) => m[i] < ON)) if (c.length <= maxArea && !c.some(onEdge)) for (const i of c) out[i] = 255;
  return out;
}

/** Drops islands of up to `maxArea` pixels (stray specks the segmenter caught). The biggest island always stays. */
export function despeckle(m: Mask, width: number, maxArea: number): Mask {
  const out = Uint8Array.from(m, (v) => (v >= ON ? 255 : 0));
  const comps = components(m.length, width, (i) => m[i] >= ON);
  const biggest = comps.reduce((b, c) => (c.length > b.length ? c : b), [] as number[]);
  for (const c of comps) if (c !== biggest && c.length <= maxArea) for (const i of c) out[i] = 0;
  return out;
}

/** Softens a cut-out's edge inward over `radius` pixels. Only lowers alpha, so no background color is pulled in. */
export function feather(r: Raster, radius: number): Raster {
  if (radius <= 0) return r;
  const { width: w, height: h } = r;
  const a = alphaMask(r);
  // separable box blur of alpha; outside the image counts as transparent
  const blur = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -radius; d <= radius; d++) {
          const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h) s += src[yy * w + xx];
        }
        out[y * w + x] = s / (2 * radius + 1);
      }
    return out;
  };
  const soft = blur(blur(Float32Array.from(a), true), false);
  const data = new Uint8ClampedArray(r.data);
  for (let i = 0; i < a.length; i++) data[i * 4 + 3] = Math.min(a[i], Math.round(soft[i]));
  return { width: w, height: h, data };
}

export type Cleanup = { grow?: number; holes?: number; specks?: number; feather?: number };

/** Mask cleanup before cutting out: specks dropped, holes filled, then grown or shrunk. Feathering happens on the cut-out. */
export function cleanMask(m: Mask, width: number, height: number, c: Cleanup): Mask {
  let out = m;
  if (c.specks) out = despeckle(out, width, c.specks);
  if (c.holes) out = fillHoles(out, width, height, c.holes);
  if (c.grow && c.grow > 0) out = grow(out, width, height, c.grow);
  if (c.grow && c.grow < 0) out = shrink(out, width, height, -c.grow);
  return out;
}

/** Cleanup for generated parts: drops stray specks under ~0.05% of the painting and fills pinholes under ~0.03%. */
export const defaultCleanup = (width: number, height: number) => ({ grow: 0, holes: Math.round(width * height * 0.0003), specks: Math.round(width * height * 0.0005), feather: 0 });

export type Check = { name: "cutout" | "edges" | "framing" | "coverage" | "joint" | "reconstruction" | "identity"; status: "pass" | "review" | "fail"; note?: string };

/** The checklist every cut-out gets: a valid cut-out, clean edges, the whole subject in its painting, a sensible size. */
export function partChecks(img: Raster, m: Mask, width: number, height: number, name: string): Check[] {
  const problems = partProblems(img, name).map((p) => p.replace(/^[^:]+: /, ""));
  const halo = haloShare(img);
  const share = count(m) / (width * height);
  return [
    problems.length ? { name: "cutout", status: "fail", note: problems[0] } : { name: "cutout", status: "pass" },
    { name: "edges", status: halo > 0.25 ? "review" : "pass", note: `${Math.round(halo * 100)}% of its edge is a white halo` },
    touchesEdge(m, width, height) ? { name: "framing", status: "review", note: "It runs off the edge of its painting, so one side is cut straight; erase that side or regenerate" } : { name: "framing", status: "pass" },
    { name: "coverage", status: share < 0.003 ? "review" : "pass", note: `The mask covers ${+(share * 100).toFixed(1)}% of its painting` },
  ];
}

/** The notes of every check a person should look at; undefined when all passed. */
export const reviewOf = (checks: Check[]) => checks.filter((c) => c.status !== "pass").map((c) => c.note ?? c.name).join("; ") || undefined;

/** Cuts a part out of `src` with its cleaned mask, crops it to the part, removes halos and checks it. `crop` is where it sits in `src`. */
export function recut(src: Raster, m: Mask, c: Cleanup, name: string): { image: Raster; crop: Box; checks: Check[] } {
  const { width: w, height: h } = src;
  const mm = cleanMask(m, w, h, c);
  const box = maskBox(mm, w);
  if (!box) throw new AIError(`The ${name} mask is empty after cleanup`, "Shrink it less, or drop fewer specks.");
  const image = feather(defringe(peelPale(crop(cutout(src, mm), box))), c.feather ?? 0);
  return { image, crop: box, checks: partChecks(image, mm, w, h, name) };
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0");
const rgbOf = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The main colors of a cut-out's opaque pixels, most common first (up to n, each covering at least 2%). */
export function palette(r: Raster, n = 5): string[] {
  const bins = new Map<number, number[]>();
  let total = 0;
  for (let i = 0; i < r.width * r.height; i++) {
    const d = r.data.subarray(i * 4, i * 4 + 4);
    if (d[3] < ON) continue;
    total++;
    const key = ((d[0] >> 5) << 6) | ((d[1] >> 5) << 3) | (d[2] >> 5);
    const b = bins.get(key) ?? [0, 0, 0, 0];
    b[0]++;
    b[1] += d[0];
    b[2] += d[1];
    b[3] += d[2];
    bins.set(key, b);
  }
  const picked: number[][] = [];
  for (const [c, R, G, B] of [...bins.values()].sort((a, b) => b[0] - a[0] || a[1] - b[1])) {
    if (picked.length >= n || c < total * 0.02) break;
    const rgb = [R / c, G / c, B / c];
    if (!picked.some((p) => dist(p, rgb) < 40)) picked.push(rgb);
  }
  return picked.map((p) => `#${p.map(hex2).join("")}`);
}

/** How far a painting's colors are from a saved palette: mean distance of the saved top 3 to their nearest new color (0–441). */
export function paletteDrift(saved: string[], now: string[]): number {
  const top = saved.slice(0, 3).map(rgbOf), have = now.map(rgbOf);
  if (!top.length || !have.length) return 0;
  return top.reduce((s, c) => s + Math.min(...have.map((h) => dist(c, h))), 0) / top.length;
}
