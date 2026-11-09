// Quality gates (docs/ANIM-STUDIO-HYBRID-ANIMATION-ARCHITECTURE.md §8 stage 5): deterministic checks only. They don't
// promise a defect-free result; they make uncertain output visible as "review" instead of silently accepting it.
import { validateScene } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";

export type QualityItem = { target: string; name: string; status: "pass" | "review" | "fail"; note?: string };

/** Problems of an editable scene: invalid references or rig (fail), parts flagged when made, implausible pivots and mesh weights (review). */
export function sceneChecks(spec: SceneSpec): QualityItem[] {
  const v = validateScene(spec);
  if (!v.ok) return v.errors.map((note) => ({ target: "scene", name: "valid", status: "fail", note }));
  const out: QualityItem[] = [];
  for (const [id, a] of Object.entries(spec.assets ?? {})) if (a.review) out.push({ target: id, name: "asset", status: "review", note: a.review });
  for (const l of spec.layers) {
    const { x, y, w, h } = l.params as Record<string, unknown>;
    // a joint is near the part it turns; one far outside it swings the part around empty space
    if (l.pivot && [x, y, w, h].every((n) => typeof n === "number")) {
      const [px, py] = l.pivot, [lx, ly, lw, lh] = [x, y, w, h] as number[];
      if (px < lx - lw * 0.25 || px > lx + lw * 1.25 || py < ly - lh * 0.25 || py > ly + lh * 1.25) out.push({ target: l.id, name: "pivot", status: "review", note: `Pivot (${px}, ${py}) is far outside the part` });
    }
    const bad = l.mesh?.weights?.findIndex((ws) => Math.abs(ws.reduce((s, n) => s + n, 0) - 1) > 0.05) ?? -1;
    if (bad >= 0) out.push({ target: l.id, name: "mesh", status: "review", note: `Mesh vertex ${bad}'s bone weights don't add up to 1` });
  }
  return out;
}

/** What the server measures of a clip: frame count and size, and at sample points a frame's brightness and its change to the next frame. */
export type ClipStats = {
  count: number;
  fps: number;
  width: number;
  height: number;
  /** Mean brightness and its spread (0–1), and the mean absolute change to the following frame (0–1). */
  samples: { at: number; mean: number; spread: number; jump: number }[];
};

/** Thresholds, 0–1 of full brightness: adjacent frames changing more than this is a cut or flicker, not motion. */
const JUMP = 0.12;
const FLAT = 0.02;

/** Checks of a generated clip against the shot it should be. Empty = nothing wrong found. */
export function clipChecks(c: ClipStats, want: { seconds: number; aspect: number }): QualityItem[] {
  const out: QualityItem[] = [];
  const seconds = c.count / c.fps;
  if (!c.count) return [{ target: "clip", name: "decode", status: "fail", note: "The clip has no frames" }];
  if (Math.abs(seconds - want.seconds) > Math.max(0.5, want.seconds * 0.15)) out.push({ target: "clip", name: "duration", status: "fail", note: `The clip is ${seconds.toFixed(1)} s, the shot ${want.seconds.toFixed(1)} s` });
  if (Math.abs(Math.log(c.width / c.height / want.aspect)) > 0.1) out.push({ target: "clip", name: "size", status: "fail", note: `The clip is ${c.width}×${c.height}, not the scene's shape` });
  const flat = c.samples.filter((s) => s.spread < FLAT);
  if (flat.length) out.push({ target: "clip", name: "blank", status: "fail", note: `Blank frames at ${flat.map((s) => `${s.at.toFixed(1)} s`).join(", ")}` });
  const jumps = c.samples.filter((s) => s.jump > JUMP);
  if (jumps.length) out.push({ target: "clip", name: "flicker", status: "review", note: `Sudden change between frames at ${jumps.map((s) => `${s.at.toFixed(1)} s`).join(", ")}` });
  return out;
}

/** The worst status of a list: fail > review > pass. */
export const worst = (items: Pick<QualityItem, "status">[]): QualityItem["status"] => (items.some((i) => i.status === "fail") ? "fail" : items.some((i) => i.status === "review") ? "review" : "pass");
