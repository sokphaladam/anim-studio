import type { Ease, Track } from "@anim/spec";

export const EASE: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  inOut: (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2),
  in: (k) => k * k,
  out: (k) => 1 - (1 - k) * (1 - k),
  step: (k) => (k < 1 ? 0 : 1),
};

/** Track value at time t; holds the first/last key outside the keyed range. A looping track repeats its keys. */
export function evalTrack(track: Track, t: number): number {
  const keys = track.keys;
  const period = keys[keys.length - 1][0];
  if (track.loop && period > 0) t = ((t % period) + period) % period;
  if (t <= keys[0][0]) return keys[0][1];
  const ease = EASE[track.ease];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const k = ease((t - t0) / (t1 - t0 || 1));
      return v0 + (v1 - v0) * k;
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
