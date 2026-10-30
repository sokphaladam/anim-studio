import { validateScene } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import autumn from "@anim/spec/examples/autumn-window.json";
import ball from "@anim/spec/examples/bouncing-ball.json";

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECTS: Record<Aspect, { label: string; hint: string; width: number; height: number }> = {
  "16:9": { label: "YouTube", hint: "16:9 · 1920×1080", width: 1280, height: 720 },
  "9:16": { label: "Shorts", hint: "9:16 · 1080×1920", width: 720, height: 1280 },
  "1:1": { label: "Square", hint: "1:1 · 1080×1080", width: 1080, height: 1080 },
};

function mustValidate(input: unknown): SceneSpec {
  const r = validateScene(input);
  if (!r.ok) throw new Error(`Invalid scene:\n${r.errors.join("\n")}`);
  return r.spec;
}

export const EXAMPLES: { id: string; title: string; load: () => SceneSpec }[] = [
  { id: "autumn-window", title: "Autumn window", load: () => mustValidate(autumn) },
  { id: "bouncing-ball", title: "Bouncing ball (hand-drawn)", load: () => mustValidate(ball) },
];

/** A white page with one empty drawing layer, ready to draw on. */
export function blankScene(aspect: Aspect): SceneSpec {
  const a = ASPECTS[aspect];
  return mustValidate({
    version: 1,
    meta: { title: "Untitled scene", duration: 12, fps: 24, width: a.width, height: a.height },
    layers: [
      { id: "paper", type: "paper", params: {} },
      { id: "drawing-1", type: "drawing", params: {}, frames: [] },
    ],
  });
}

export const validSpecOrNull = (input: unknown) => {
  const r = validateScene(input);
  return r.ok ? r.spec : null;
};

/** Stable key for any row: layer id, or "overlay:<index>" for overlays (which have no required id). */
export const overlayKey = (i: number) => `overlay:${i}`;
