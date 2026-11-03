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
