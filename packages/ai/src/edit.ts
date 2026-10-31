import { catalog, validateScene } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { sceneSpecJsonSchema } from "@anim/spec";
import jsonpatch, { type Operation } from "fast-json-patch";
import { z } from "zod";
import { normalize } from "./generate";
import { extractJson } from "./json";
import { prompt } from "./prompts";
import type { Provider } from "./types";

// CommonJS package: Node's ESM loader only exposes its default export
const { applyPatch, compare, deepClone, getValueByPointer } = jsonpatch;

const PatchSchema = z.object({
  patch: z.array(z.object({ op: z.enum(["add", "remove", "replace", "move", "copy", "test"]), path: z.string(), value: z.unknown().optional(), from: z.string().optional() })),
});
const patchJsonSchema = z.toJSONSchema(PatchSchema, { io: "input" });

const PATCH_OUTPUT = 'Output JSON only, no prose: {"patch": [ ...RFC 6902 JSON Patch operations... ]}';
const FULL_OUTPUT = "Output the complete updated scene spec as JSON only, no prose (not a patch). Keep every value you were not asked to change identical, and keep each drawing layer's \"frames\" summary as it is.";

export type EditResult = { ok: true; spec: SceneSpec; patch: Operation[]; fullSpec: boolean } | { ok: false; message: string; errors: string[] };

/** Stroke data is huge and useless to the model; it gets a one-line summary with where the drawing sits. */
function hideStrokes(spec: SceneSpec) {
  return {
    ...spec,
    layers: spec.layers.map((l) => {
      if (!l.frames) return l;
      const pts = l.frames.flatMap((f) => f.strokes.flatMap((s): number[][] => (s.tool === "fill" ? [s.at] : s.points)));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const where = pts.length ? `, drawn within x ${Math.round(Math.min(...xs))}..${Math.round(Math.max(...xs))}, y ${Math.round(Math.min(...ys))}..${Math.round(Math.max(...ys))}` : ", empty";
      return { ...l, frames: `${l.frames.length} hand-drawn frame(s)${where}` };
    }),
  };
}

const missing = (doc: unknown, path: string) => {
  try {
    return getValueByPointer(doc, path) === undefined;
  } catch {
    return false; // parent missing too: let applyPatch report it
  }
};

/** Validates an edited spec, keeping meta as the model left it but tidying tracks to the (possibly new) duration. */
function check(next: unknown, meta: SceneSpec["meta"]) {
  const m = next && typeof next === "object" && "meta" in next && typeof next.meta === "object" ? { ...meta, ...(next.meta as object) } : meta;
  return validateScene(normalize(next, m));
}

/**
 * Instruction → JSON Patch → apply → validate. A broken patch is retried once with the errors; after that the model
 * writes the whole updated spec instead. The returned patch is the real diff from `spec`.
 */
export async function editScene(spec: SceneSpec, instruction: string, provider: Provider, signal?: AbortSignal): Promise<EditResult> {
  const shown = hideStrokes(spec);
  const vars = {
    catalog: catalog(),
    duration: String(spec.meta.duration),
    layers: spec.layers.map((l, i) => `${i}: ${l.id} (${l.type})`).join("\n") || "(none)",
    spec: JSON.stringify(shown),
  };
  let errors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const user = attempt === 0 ? instruction : `${instruction}\n\nYour previous patch failed:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn a corrected patch.`;
    const text = await provider.generateJSON({ system: prompt("edit", { ...vars, output: PATCH_OUTPUT }), user, schema: patchJsonSchema, signal });
    try {
      const { patch } = PatchSchema.parse(extractJson(text));
      const bad = patch.find((op) => /^\/layers\/\d+\/frames/.test(op.path));
      if (bad) throw new Error(`${bad.path}: hand-drawn frames can't be edited; animate the layer with "transform" instead`);
      // models often "replace" a param that is only defaulted (absent from the spec); that is an "add"
      const ops = patch.map((op) => (op.op === "replace" && missing(spec, op.path) ? { ...op, op: "add" as const } : op)) as Operation[];
      const r = check(applyPatch(deepClone(spec), ops, true).newDocument, spec.meta);
      if (r.ok) return { ok: true, spec: r.spec, patch: compare(spec, r.spec), fullSpec: false };
      errors = r.errors;
    } catch (e) {
      errors = [(e as Error).message];
    }
  }

  const text = await provider.generateJSON({ system: prompt("edit", { ...vars, output: FULL_OUTPUT }), user: instruction, schema: sceneSpecJsonSchema, signal });
  let next: unknown;
  try {
    next = extractJson(text);
  } catch (e) {
    return { ok: false, message: "The model couldn't make that change", errors: [(e as Error).message] };
  }
  // put the real strokes back where the model saw the summary
  const frames = new Map(spec.layers.filter((l) => l.frames).map((l) => [l.id, l.frames]));
  if (next && typeof next === "object" && Array.isArray((next as { layers?: unknown }).layers))
    for (const l of (next as { layers: { id?: string; frames?: unknown }[] }).layers) if (l && typeof l.id === "string" && frames.has(l.id)) l.frames = frames.get(l.id);
  const r = check(next, spec.meta);
  if (!r.ok) return { ok: false, message: "The model couldn't make that change", errors: r.errors };
  return { ok: true, spec: r.spec, patch: compare(spec, r.spec), fullSpec: true };
}
