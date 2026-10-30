import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { createRenderer, validateScene, type RenderOptions } from "../src";
import type { SceneSpec } from "@anim/spec";

export function loadExample(name: string): SceneSpec {
  const r = validateScene(JSON.parse(readFileSync(join(__dirname, `../../spec/examples/${name}.json`), "utf8")));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.spec;
}

export const factory = (w: number, h: number) => createCanvas(w, h);

/** sha1 of the pixels at each time, rendered with a fresh renderer. */
export function hashes(spec: SceneSpec, times: number[], opts?: RenderOptions, size: [number, number] = [640, 360]) {
  const canvas = createCanvas(...size);
  const r = createRenderer(canvas, spec, { createCanvas: factory });
  return times.map((t) => {
    r.render(t, opts);
    return createHash("sha1").update(canvas.data()).digest("hex");
  });
}
