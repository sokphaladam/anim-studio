import type { Resolved, SceneSpec } from "@anim/spec";
import { evalTrack } from "./tracks";

/** Replaces "$palette" strings with colors and "@track" strings with the track value at t. */
export function resolve<T>(value: T, spec: SceneSpec, t: number): Resolved<T> {
  return walk(value, spec, t) as Resolved<T>;
}

function walk(v: unknown, spec: SceneSpec, t: number): unknown {
  if (typeof v === "string") {
    if (v[0] === "@") {
      const tr = spec.tracks[v.slice(1)];
      if (!tr) throw new Error(`Unknown track "${v}"`);
      return evalTrack(tr, t);
    }
    if (v[0] === "$") {
      const c = spec.palette[v.slice(1)];
      if (c === undefined) throw new Error(`Unknown palette color "${v}"`);
      return c;
    }
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, spec, t));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, spec, t);
    return out;
  }
  return v;
}
