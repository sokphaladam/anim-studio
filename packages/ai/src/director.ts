// The Motion Director: turns a person's intent ("she sips her tea, then looks out the window") into a timeline of motion
// clips for the characters' rigs. The model only plans; every clip, target and time is checked against the rig and the
// motion principles, mistakes are sent back (up to three tries), and the result is one new scene for one undoable edit.
import { applyClip, applyExpression, CLIP_INFO, CLIP_NAMES, defaultFactory, EXPRESSIONS, motionProblems, validateScene, type CanvasFactory, type Expression } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { z } from "zod";
import { extractJson } from "./json";
import { prompt } from "./prompts";
import { AIError, type Provider } from "./types";

const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as [Expression, ...Expression[]];

export const DirectionSchema = z.object({
  summary: z.string().min(1),
  clips: z
    .array(
      z.object({
        clip: z.enum(CLIP_NAMES),
        character: z.string().min(1),
        start: z.number().min(0),
        end: z.number().positive().optional(),
        target: z.string().min(1).optional(),
        amount: z.number().positive().max(2).optional(),
        why: z.string().optional(),
      }),
    )
    .min(1)
    .max(12),
  expressions: z.array(z.object({ character: z.string().min(1), expression: z.enum(EXPRESSION_NAMES), at: z.number().min(0) })).max(8).default([]),
});
export type Direction = z.output<typeof DirectionSchema>;
const directionJsonSchema = z.toJSONSchema(DirectionSchema, { io: "input" });

const ONE_SHOT = new Set(["look_at", "reach", "sip"]);
const ARM = new Set(["reach", "sip", "write"]);
/** Roughly how long one-shot clips take, to check they fit (reach there and back, sip). */
const LENGTH: Record<string, number> = { look_at: 0.6, reach: 1.6, sip: 3.5 };

/** Characters: groups with a skeleton or a saved profile. */
export function charactersOf(spec: SceneSpec): string[] {
  const ids = new Set(Object.keys(spec.characters ?? {}));
  for (const l of spec.layers) {
    const m = /^(.+)_bone_/.exec(l.id);
    if (l.type === "bone" && m) ids.add(m[1]);
  }
  return [...ids].filter((id) => spec.layers.some((l) => l.id === id));
}

/** What the planner is told about the scene: each character's rig capabilities, and the things to look at. */
export function describeScene(spec: SceneSpec): string {
  const lines: string[] = [];
  const chars = charactersOf(spec);
  for (const c of chars) {
    const bones = spec.layers.filter((l) => l.type === "bone" && l.id.startsWith(`${c}_bone_`)).map((l) => l.id.slice(`${c}_bone_`.length));
    const arms = (spec.ik ?? []).filter((k) => k.lower.startsWith(`${c}_bone_`)).map((k) => k.lower.slice(`${c}_bone_`.length));
    const faces = (spec.switches ?? []).filter((w) => w.character === c && w.kind !== "view").map((w) => `${w.kind}: ${Object.keys(w.options).join("/")}`);
    const can = [
      bones.length ? `skeleton (${bones.length} bones${bones.some((b) => b.startsWith("tail")) ? ", tail" : ""}${bones.some((b) => b.startsWith("hair")) ? ", hair" : ""}${bones.some((b) => /leg/.test(b)) ? ", legs" : ""})` : "no skeleton",
      arms.length ? `IK on ${arms.join(", ")}` : "no arm IK (no reach, sip or write)",
      spec.layers.some((l) => l.id === `${c}_irises`) ? "eyes that move" : "",
      faces.length ? `face: ${faces.join("; ")}` : "no face overlays",
    ].filter(Boolean);
    lines.push(`- character "${c}": ${can.join("; ")}`);
  }
  const things = spec.layers.filter((l) => !chars.some((c) => l.id === c || l.id.startsWith(`${c}_`)) && l.type !== "bone" && !spec.ik?.some((k) => k.target === l.id));
  lines.push(`- things: ${things.map((l) => l.id).join(", ") || "none"}`);
  return lines.join("\n");
}

/** Applies a direction: expressions, then clips in time order. Returns the scene and every clip the rig refused. */
export function applyDirection(spec: SceneSpec, d: Direction, make: CanvasFactory = defaultFactory): { spec: SceneSpec; refused: string[] } {
  let out = spec;
  const refused: string[] = [];
  for (const e of d.expressions) out = applyExpression(out, e.character, e.expression, Math.min(e.at, spec.meta.duration)).spec;
  [...d.clips]
    .sort((a, b) => a.start - b.start)
    .forEach((c) => {
      const r = applyClip(out, c.clip, c, make);
      if (r.ok) out = r.spec;
      else refused.push(`${c.clip} for ${c.character} at ${c.start}s: ${r.problem}`);
    });
  return { spec: out, refused };
}

/** Mistakes in a direction: unknown names, bad timing, clips the rig can't do, and broken motion principles. */
export function directionProblems(spec: SceneSpec, d: Direction, make: CanvasFactory = defaultFactory): string[] {
  const out: string[] = [];
  const D = spec.meta.duration, chars = charactersOf(spec), ids = new Set(spec.layers.map((l) => l.id));
  d.clips.forEach((c, i) => {
    const at = `clips[${i}] (${c.clip})`;
    if (!chars.includes(c.character)) out.push(`${at}.character: "${c.character}" is not a rigged character (${chars.join(", ") || "none"})`);
    if (c.target !== undefined && !ids.has(c.target)) out.push(`${at}.target: "${c.target}" is not in the scene`);
    if (c.start >= D) out.push(`${at}.start: ${c.start}s is not before the ${D}s end`);
    if (c.end !== undefined && c.end <= c.start) out.push(`${at}: end ${c.end}s must be after start ${c.start}s`);
    if (ONE_SHOT.has(c.clip) && c.start + LENGTH[c.clip] > D) out.push(`${at}: it takes about ${LENGTH[c.clip]}s, so it must start by ${+(D - LENGTH[c.clip]).toFixed(1)}s`);
    // the eyes lead
    if ((c.clip === "reach" || c.clip === "sip") && !d.clips.some((x) => x.clip === "look_at" && x.character === c.character && x.target === c.target && x.start <= c.start))
      out.push(`${at}: ${c.character} should look at ${c.target} (a look_at starting at or before ${c.start}s) before reaching for it`);
    // one thing at a time per arm
    if (ARM.has(c.clip))
      d.clips.forEach((x, j) => {
        if (j <= i || !ARM.has(x.clip) || x.character !== c.character) return;
        const end = (y: typeof c) => y.end ?? y.start + (LENGTH[y.clip] ?? D);
        if (x.start < end(c) && c.start < end(x)) out.push(`clips[${j}] (${x.clip}) overlaps clips[${i}] (${c.clip}): one arm task at a time`);
      });
  });
  d.expressions.forEach((e, i) => {
    if (!chars.includes(e.character)) out.push(`expressions[${i}].character: "${e.character}" is not a rigged character`);
    if (e.at > D) out.push(`expressions[${i}].at: ${e.at}s is past the ${D}s end`);
  });
  if (out.length) return out;
  const r = applyDirection(spec, d, make);
  out.push(...r.refused);
  if (!out.length) out.push(...motionProblems(r.spec, make).map((p) => `${p.action}: ${p.message}`));
  return out;
}

/**
 * Plans motion for `intent` and applies it. The scene passed in is never changed; the result is a new scene the caller
 * can apply as one undoable step, with the direction to show for review.
 */
export async function directMotion(spec: SceneSpec, intent: string, provider: Provider, opts: { signal?: AbortSignal; make?: CanvasFactory } = {}): Promise<{ direction: Direction; spec: SceneSpec }> {
  const make = opts.make ?? defaultFactory;
  if (!charactersOf(spec).length) throw new AIError("There is no rigged character to direct", "Add a skeleton to a character in the Rig docker first.");
  const system = prompt("direct", {
    duration: String(spec.meta.duration),
    scene: describeScene(spec),
    clips: Object.entries(CLIP_INFO).map(([n, s]) => `- ${n}: ${s}`).join("\n"),
    expressions: EXPRESSION_NAMES.join(", "),
  });
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await provider.generateJSON({ system, user: `Intent: ${intent}${feedback}`, schema: directionJsonSchema, signal: opts.signal });
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (e) {
      feedback = `\nYour last answer was not valid JSON (${(e as Error).message}). Answer with the JSON object only.`;
      continue;
    }
    const r = DirectionSchema.safeParse(raw);
    const problems = r.success ? directionProblems(spec, r.data, make) : r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`);
    if (r.success && !problems.length) {
      const v = validateScene(applyDirection(spec, r.data, make).spec);
      if (v.ok) return { direction: r.data, spec: v.spec };
      feedback = `\nThat plan made an invalid scene: ${v.errors.slice(0, 6).join("; ")}`;
      continue;
    }
    feedback = `\nYour last plan had these problems; fix them:\n${problems.slice(0, 12).map((p) => `- ${p}`).join("\n")}`;
  }
  throw new AIError("The model didn't return a usable motion plan", "Try again, or say more simply what should happen.");
}
