import { catalog, objectTypes, validateScene } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { sceneSpecJsonSchema } from "@anim/spec";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { extractJson } from "./json";
import { prompt } from "./prompts";
import type { Provider } from "./types";

export const MAX_REPAIRS = 3;

export const StoryboardSchema = z.object({
  title: z.string().min(1),
  mood: z.string().default(""),
  palette: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).default({}),
  beats: z.array(z.object({ at: z.number().min(0), label: z.string().min(1), note: z.string().optional() })).min(1),
});
export type Storyboard = z.output<typeof StoryboardSchema>;
const storyboardJsonSchema = z.toJSONSchema(StoryboardSchema, { io: "input" });

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECT_SIZE: Record<Aspect, [number, number]> = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [1080, 1080] };

export interface GenerateRequest {
  prompt: string;
  duration: number;
  aspect: Aspect;
}

export type GenerateEvent =
  | { type: "status"; phase: "storyboard" | "spec" | "repair"; message: string }
  | { type: "storyboard"; storyboard: Storyboard; meta: SceneSpec["meta"] }
  | { type: "token"; phase: "storyboard" | "spec" | "repair"; tokens: number }
  | { type: "repairing"; attempt: number; errors: string[] }
  | { type: "done"; spec: SceneSpec; repairs: number }
  | { type: "error"; message: string; fix?: string; errors?: string[] };

// the AI builds object scenes; hand-drawn layers are for people
const aiCatalog = () => catalog().split("\n").filter((l) => !l.startsWith("- drawing ")).join("\n");
const aiTypes = () => objectTypes().filter((t) => t !== "drawing");

let exampleCache: string | null = null;
function example() {
  exampleCache ??= JSON.stringify(JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@anim/spec/examples/autumn-window.json")), "utf8")));
  return exampleCache;
}

/** Deterministic tidy-ups that don't need the model: sort keys, keep times inside the scene, force the requested size. */
export function normalize(raw: unknown, meta: SceneSpec["meta"]): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const s = raw as Record<string, unknown>;
  const d = meta.duration;
  s.version = 1;
  s.meta = { ...meta, ...(typeof s.meta === "object" && s.meta ? { title: (s.meta as { title?: unknown }).title ?? meta.title } : {}), duration: d, width: meta.width, height: meta.height, fps: meta.fps };
  if (s.tracks && typeof s.tracks === "object")
    for (const tr of Object.values(s.tracks as Record<string, { keys?: unknown }>))
      if (tr && Array.isArray(tr.keys))
        tr.keys = (tr.keys as unknown[])
          .filter((k): k is [number, number] => Array.isArray(k) && typeof k[0] === "number" && typeof k[1] === "number")
          .map(([t, v]) => [Math.min(Math.max(t, 0), d), v] as [number, number])
          .sort((a, b) => a[0] - b[0]);
  if (Array.isArray(s.beats)) s.beats = (s.beats as { at?: unknown }[]).filter((b) => typeof b?.at === "number" && b.at <= d);
  return s;
}

function parseOrError(text: string): { value: unknown } | { error: string } {
  try {
    return { value: extractJson(text) };
  } catch (e) {
    return { error: `Output was not valid JSON: ${(e as Error).message}` };
  }
}

/** Storyboard → scene spec → validate → repair (up to MAX_REPAIRS). Emits progress; resolves with the valid spec or null. */
export async function generateScene(req: GenerateRequest, provider: Provider, emit: (e: GenerateEvent) => void, signal?: AbortSignal): Promise<SceneSpec | null> {
  const [width, height] = ASPECT_SIZE[req.aspect];
  const duration = Math.min(30, Math.max(5, req.duration));
  const counter = (phase: "storyboard" | "spec" | "repair") => {
    let tokens = 0, last = 0;
    return () => {
      tokens++;
      // throttle progress events to every 20 chunks
      if (tokens - last >= 20) {
        last = tokens;
        emit({ type: "token", phase, tokens });
      }
    };
  };

  emit({ type: "status", phase: "storyboard", message: "Planning the storyboard" });
  const user = `Idea: ${req.prompt}\nDuration: ${duration} seconds\nAspect: ${req.aspect} (${width}x${height})`;
  let storyboard: Storyboard | null = null;
  for (let i = 0; i < 2 && !storyboard; i++) {
    const text = await provider.generateJSON({ system: prompt("storyboard", { duration: String(duration), types: aiTypes().join(", ") }), user, schema: storyboardJsonSchema, onToken: counter("storyboard"), signal });
    const p = parseOrError(text);
    const r = "value" in p ? StoryboardSchema.safeParse(p.value) : null;
    if (r?.success) storyboard = { ...r.data, beats: r.data.beats.filter((b) => b.at <= duration).sort((a, b) => a.at - b.at) };
  }
  if (!storyboard) {
    emit({ type: "error", message: "The model didn't return a usable storyboard", fix: "Try again, or rephrase the idea more simply." });
    return null;
  }
  const meta: SceneSpec["meta"] = { title: storyboard.title, duration, fps: 30, width, height };
  emit({ type: "storyboard", storyboard, meta });

  emit({ type: "status", phase: "spec", message: "Writing the scene" });
  const specUser = `${user}\nUse meta exactly: ${JSON.stringify(meta)}\nStoryboard:\n${JSON.stringify(storyboard)}`;
  let text = await provider.generateJSON({ system: prompt("spec", { catalog: aiCatalog(), example: example() }), user: specUser, schema: sceneSpecJsonSchema, onToken: counter("spec"), signal });

  for (let attempt = 0; ; attempt++) {
    const p = parseOrError(text);
    const r = "value" in p ? validateScene(normalize(p.value, meta)) : { ok: false as const, errors: [p.error] };
    if (r.ok) {
      emit({ type: "done", spec: r.spec, repairs: attempt });
      return r.spec;
    }
    if (attempt >= MAX_REPAIRS) {
      emit({ type: "error", message: `The scene still had ${r.errors.length} problem(s) after ${MAX_REPAIRS} repair attempts`, fix: "Try again or simplify the idea.", errors: r.errors });
      return null;
    }
    emit({ type: "repairing", attempt: attempt + 1, errors: r.errors });
    const broken = "value" in p ? JSON.stringify(normalize(p.value, meta)) : text;
    text = await provider.generateJSON({
      system: prompt("repair", { catalog: aiCatalog(), errors: r.errors.slice(0, 20).map((e) => `- ${e}`).join("\n"), spec: broken }),
      user: "Return the fixed scene spec JSON.",
      schema: sceneSpecJsonSchema,
      onToken: counter("repair"),
      signal,
    });
  }
}
