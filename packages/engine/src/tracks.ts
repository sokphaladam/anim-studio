import type { Ease, KeyEase, Track } from "@anim/spec";

// "back" easing strength: how far anticipate dips and overshoot passes (about 10%)
const BACK = 1.70158;

export const EASE: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  in: (k) => k * k,
  out: (k) => 1 - (1 - k) * (1 - k),
  step: (k) => (k < 1 ? 0 : 1),
  anticipate: (k) => (BACK + 1) * k * k * k - BACK * k * k,
  overshoot: (k) => 1 + (BACK + 1) * (k - 1) ** 3 + BACK * (k - 1) ** 2,
  // a damped wobble that is exactly 0 at the start and exactly 1 at the end
  settle: (k) => 1 - (1 - k) * Math.exp(-4 * k) * Math.cos(3 * Math.PI * k),
};

/**
 * A cubic Bézier ease like CSS cubic-bezier(x1, y1, x2, y2): the curve's x is solved for k (Newton steps, then bisection
 * when Newton stalls), and its y returned. Deterministic: the same k always gives the same value.
 */
export function bezier([x1, y1, x2, y2]: readonly [number, number, number, number]): (k: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s * s + s * s * s;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * (1 - s) * s + 3 * (1 - b) * s * s;
  return (k) => {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    let s = k;
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      const next = s - (at(x1, x2, s) - k) / d;
      if (next < 0 || next > 1) break;
      s = next;
    }
    if (Math.abs(at(x1, x2, s) - k) > 1e-5) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) {
        s = (lo + hi) / 2;
        if (at(x1, x2, s) < k) lo = s;
        else hi = s;
      }
    }
    return at(y1, y2, s);
  };
}

/** The easing function of a key's ease (a name or a Bézier). */
export const easeOf = (e: KeyEase): ((k: number) => number) => (typeof e === "string" ? EASE[e] : bezier(e));

/**
 * Track value at time t; holds the first/last key outside the keyed range. A looping track repeats its keys. Each
 * segment uses its starting key's own ease when it has one, else the track's.
 */
export function evalTrack(track: Track, t: number): number {
  const keys = track.keys;
  const period = keys[keys.length - 1][0];
  if (track.loop && period > 0) t = ((t % period) + period) % period;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const k0 = keys[i - 1];
    const [t0, v0] = k0;
    if (t <= t1) {
      const ease = k0.length > 2 ? easeOf(k0[2]!) : EASE[track.ease];
      return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0 || 1));
    }
  }
  return keys[keys.length - 1][1];
}

/** Integral of the track from 0 to t (fixed 0.04s steps, so the same t always gives the same result). */
export function integrate(track: Track, t: number): number {
  let s = 0;
  const dt = 0.04;
  for (let x = 0; x < t; x += dt) s += evalTrack(track, x) * Math.min(dt, t - x);
  return s;
}
