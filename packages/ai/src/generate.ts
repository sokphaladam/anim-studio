import { catalog, getObject, objectTypes, paintingBoxToScene, validateScene } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { ART_STYLES, collectRefs, sceneSpecJsonSchema, type StyleId } from "@anim/spec";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { extractJson } from "./json";
import { prompt } from "./prompts";
import { VIDEO_SIZE, type AnimateArgs, type PaintArgs } from "./painters/comfyui";
import { findMotions, type PaintingInfo } from "./regions";
import type { Provider } from "./types";

export const MAX_REPAIRS = 3;

export const StoryboardSchema = z.object({
  title: z.string().min(1),
  mood: z.string().default(""),
  palette: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).default({}),
  beats: z.array(z.object({ at: z.number().min(0), label: z.string().min(1), note: z.string().optional() })).min(1),
  /** The key frame described for an illustrator (painted mode). */
  scene: z.string().default(""),
  /** What moves during the clip (video mode), in short plain sentences. */
  motion: z.string().default(""),
  /** Who or what moves (painted mode): each gets its own drawing layer to animate frame by frame. */
  subjects: z.array(z.string()).default([]),
});
export type Storyboard = z.output<typeof StoryboardSchema>;
const storyboardJsonSchema = z.toJSONSchema(StoryboardSchema, { io: "input" });

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECT_SIZE: Record<Aspect, [number, number]> = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [1080, 1080] };

/** Tag order the anime checkpoint was trained on: subject first, then style, then quality/score tags. */
export const paintPrompt = (subject: string, style: string) => `${subject}, ${style}, masterpiece, best quality, high score, great score, absurdres`;

/** SDXL-friendly sizes (multiples of 64, ~1 megapixel) per aspect. */
export const PAINT_SIZE: Record<Aspect, [number, number]> = { "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [1024, 1024] };

export interface GenerateRequest {
  prompt: string;
  duration: number;
  aspect: Aspect;
  style?: StyleId;
  /** "painted": the image painter paints the scene and the engine animates effects over it. Default "vector". */
  mode?: "vector" | "painted" | "video";
}

/** Paints the key frame and stores it; resolves with the src a painting layer can use. */
/** A clip stored as numbered JPEG frames: `${frames}001.jpg` … */
export type Footage = { frames: string; count: number; fps: number };
/** Animates a picture into a short clip and stores its frames. */
export type AnimateFn = (args: Omit<AnimateArgs, "signal">, signal?: AbortSignal) => Promise<Footage>;
export type PaintFn = (args: Omit<PaintArgs, "signal">, signal?: AbortSignal) => Promise<{ src: string; png: Uint8Array }>;

export type GenerateEvent =
  | { type: "status"; phase: "storyboard" | "paint" | "video" | "spec" | "repair"; message: string }
  | { type: "painted"; src: string }
  | { type: "storyboard"; storyboard: Storyboard; meta: SceneSpec["meta"] }
  | { type: "token"; phase: "storyboard" | "spec" | "repair"; tokens: number }
  | { type: "repairing"; attempt: number; errors: string[] }
  | { type: "done"; spec: SceneSpec; repairs: number }
  | { type: "error"; message: string; fix?: string; errors?: string[] };

// the AI builds object scenes; hand-drawn layers are for people
const aiCatalog = () => catalog().split("\n").filter((l) => !l.startsWith("- drawing ")).join("\n");
const aiTypes = () => objectTypes().filter((t) => t !== "drawing" && t !== "painting");
// over a painting the model only adds effects; characters and props are already painted
const PAINTED_CATEGORIES = ["particles", "fx", "text"];
const paintedTypes = () => objectTypes().filter((t) => PAINTED_CATEGORIES.includes(getObject(t)?.category ?? ""));
const paintedCatalog = () => catalog().split("\n").filter((l) => paintedTypes().some((t) => l.startsWith(`- ${t} `))).join("\n");

type RawLayer = { id?: unknown; type?: unknown; params?: Record<string, unknown>; frames?: unknown };

// painted mode paints the background only; the moving subjects are drawn by hand on their own layers
const BACKGROUND_TAGS = "no humans, scenery";
const NO_SUBJECTS = "1girl, 1boy, person, people, human, face, animal, cat, dog, bird, character";

/** One empty drawing layer per moving subject, ids unique against the scene's other layers. */
export function subjectLayers(subjects: string[], taken: Set<string>): RawLayer[] {
  return subjects.map((name) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "drawing";
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    return { id, type: "drawing", params: {}, frames: [{ start: 0, strokes: [] }] };
  });
}

/**
 * Painted mode: the painting (with its moving parts) is always the first layer and only effects go on top.
 * Indoors, rain falls only in the windows: each rain layer becomes one per window, or goes if there are none.
 */
export function keepPainted(raw: unknown, src: string, info: PaintingInfo | null, paintSize: [number, number], subjects: string[] = []): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const s = raw as { layers?: unknown; meta?: { width?: number; height?: number } };
  let layers = Array.isArray(s.layers) ? (s.layers as RawLayer[]).filter((l) => paintedTypes().includes(String(l?.type))) : [];
  if (info?.indoor) {
    const scene = { width: s.meta?.width ?? 1280, height: s.meta?.height ?? 720 };
    const img = { width: paintSize[0], height: paintSize[1] };
    layers = layers.flatMap((l) =>
      l.type !== "rain"
        ? [l]
        : info.windows.map((w, i) => {
            const [x0, y0, x1, y1] = paintingBoxToScene(w, img, scene);
            return { ...l, id: `${String(l.id ?? "rain")}-window-${i + 1}`, params: { ...l.params, x0, y0, x1, y1 } };
          }),
    );
  }
  const drawn = subjectLayers(subjects, new Set(["painting", ...layers.map((l) => String(l.id))]));
  s.layers = [{ id: "painting", type: "painting", params: { src, ...(info?.motions.length ? { motions: info.motions } : {}) } }, ...drawn, ...layers];
  return s;
}

// object scenes the model may copy (not the hand-drawn one); the first is the fallback
const EXAMPLES = ["autumn-window", "night-study"];
const exampleCache = new Map<string, { json: string; words: Set<string> }>();
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{3,}/g) ?? []);

/** The example scene sharing the most words with the idea (layer types, titles, beat notes), so a rainy night idea copies the night scene. */
export function exampleFor(idea: string): string {
  const want = words(idea);
  let best = { score: -1, json: "" };
  for (const name of EXAMPLES) {
    let ex = exampleCache.get(name);
    if (!ex) {
      const file = process.env.ANIM_EXAMPLES_DIR ? `${process.env.ANIM_EXAMPLES_DIR}/${name}.json` : fileURLToPath(import.meta.resolve(`@anim/spec/examples/${name}.json`));
      const spec = JSON.parse(readFileSync(file, "utf8"));
      const about = [spec.meta.title, spec.meta.subtitle, ...spec.layers.map((l: { type: string }) => l.type), ...spec.beats.map((b: { label: string; note?: string }) => `${b.label} ${b.note ?? ""}`)].join(" ");
      ex = { json: JSON.stringify(spec), words: words(about.replace(/-/g, " ")) };
      exampleCache.set(name, ex);
    }
    const score = [...want].filter((w) => ex.words.has(w)).length;
    if (score > best.score) best = { score, json: ex.json };
  }
  return best.json;
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

/** A valid scene can still be empty (just a background). That's a failure worth repairing, not a result. */
export function contentProblems(spec: SceneSpec): string[] {
  const subjects = spec.layers.filter((l) => ["characters", "props", "particles"].includes(getObject(l.type)?.category ?? ""));
  return subjects.length
    ? []
    : ["layers: The scene has only a background and shows nothing from the storyboard. Add the main subject and props as layers, using the closest listed types (a dog or other animal → cat or fox; a person → studier)."];
}

/**
 * Mechanical fixes for slips models make in otherwise valid scenes, cheaper and surer than a repair round:
 * a track nothing uses is wired to the one param it is named after (rainIntensity → rain.intensity, dogAwake → fox.awake),
 * and a fade stuck at a fixed reveal gets a fade-in/out track. Returns the scene unchanged if a fix doesn't validate.
 */
export function tidy(spec: SceneSpec): SceneSpec {
  const s = structuredClone(spec);
  const items = [...s.layers, ...s.overlays];
  const used = new Set(collectRefs(items).map((r) => r.ref));
  for (const name of Object.keys(s.tracks)) {
    if (used.has(`@${name}`)) continue;
    const hits = items.flatMap((l) =>
      Object.entries(getObject(l.type)?.params.shape ?? {})
        .filter(([k, schema]) => k.length >= 3 && name.toLowerCase().endsWith(k.toLowerCase()) && typeof (l.params[k] ?? 0) === "number" && (schema as z.ZodType).safeParse(`@${name}`).success)
        .map(([k]) => ({ l, k })),
    );
    if (hits.length === 1) {
      hits[0].l.params[hits[0].k] = `@${name}`;
      used.add(`@${name}`);
    }
  }
  const d = s.meta.duration, a = Math.min(1, d / 6);
  for (const o of s.overlays)
    if (o.type === "fade" && typeof o.params.reveal === "number" && o.params.reveal < 1) {
      const name = "fade" in s.tracks && used.has("@fade") ? "autoFade" : "fade";
      s.tracks[name] = { keys: [[0, 0], [a, 1], [d - a, 1], [d, 0]], ease: "inOut" };
      o.params.reveal = `@${name}`;
    }
  const r = validateScene(s);
  return r.ok ? r.spec : spec;
}

function parseOrError(text: string): { value: unknown } | { error: string } {
  try {
    return { value: extractJson(text) };
  } catch (e) {
    return { error: `Output was not valid JSON: ${(e as Error).message}` };
  }
}

/** Storyboard → scene spec → validate → repair (up to MAX_REPAIRS). Emits progress; resolves with the valid spec or null. */
export async function generateScene(req: GenerateRequest, provider: Provider, emit: (e: GenerateEvent) => void, signal?: AbortSignal, paint?: PaintFn, animate?: AnimateFn): Promise<SceneSpec | null> {
  const [width, height] = ASPECT_SIZE[req.aspect];
  const duration = Math.min(30, Math.max(5, req.duration));
  const style = ART_STYLES[req.style ?? "flat-motion"];
  const video = req.mode === "video";
  // video mode paints the first frame the same way, then a video model animates it
  const painted = req.mode === "painted" || video;
  if (video && !animate) {
    emit({ type: "error", message: "The video model isn't set up", fix: "Run pnpm setup:painter --video, or choose Painted." });
    return null;
  }
  if (painted && !paint) {
    emit({ type: "error", message: "The image painter isn't set up", fix: "Run pnpm setup:painter, or choose Vector." });
    return null;
  }
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
  const user = `Idea: ${req.prompt}\nDuration: ${duration} seconds\nAspect: ${req.aspect} (${width}x${height})\nArt style: ${style.label}: ${style.blurb}`;
  let storyboard: Storyboard | null = null;
  for (let i = 0; i < 2 && !storyboard; i++) {
    const text = await provider.generateJSON({ system: prompt("storyboard", { duration: String(duration), limits: video
          ? "An illustrator paints the picture, so any subject works; a video model then animates it."
          : painted
          ? `An illustrator paints the background only: "scene" describes the empty setting with no people or animals in it. Everyone and everything that moves goes in "subjects"; each is drawn frame by frame on its own layer over the background. The background moves only through effects over it: ${paintedTypes().join(", ")}.`
          : `Plan only things these objects can show: ${aiTypes().join(", ")}. If the idea names something else, plan it with the closest of these (a dog or other animal → cat or fox; any person → studier).`, palette: JSON.stringify(style.palette) }), user, schema: storyboardJsonSchema, onToken: counter("storyboard"), signal });
    const p = parseOrError(text);
    const r = "value" in p ? StoryboardSchema.safeParse(p.value) : null;
    // the style's palette wins, so every scene in a style shares its colors
    if (r?.success) storyboard = { ...r.data, palette: { ...style.palette }, beats: r.data.beats.filter((b) => b.at <= duration).sort((a, b) => a.at - b.at) };
  }
  if (!storyboard) {
    emit({ type: "error", message: "The model didn't return a usable storyboard", fix: "Try again, or rephrase the idea more simply." });
    return null;
  }
  const meta: SceneSpec["meta"] = { title: storyboard.title, style: style.id, duration, fps: 30, width, height };
  emit({ type: "storyboard", storyboard, meta });

  let src = "";
  let info: PaintingInfo | null = null;
  if (painted && paint) {
    emit({ type: "status", phase: "paint", message: `Painting the scene (${style.label})` });
    await provider.unload?.(); // a 12 GB GPU can't hold the language model and the painter at once
    const [pw, ph] = PAINT_SIZE[req.aspect];
    const subject = storyboard.scene || req.prompt;
    const art = await paint({
      positive: paintPrompt(video ? subject : `${BACKGROUND_TAGS}, ${subject}`, style.paint.positive),
      negative: video ? style.paint.negative : `${style.paint.negative}, ${NO_SUBJECTS}`,
      model: style.paint.model,
      width: pw,
      height: ph, seed: Math.floor(Math.random() * 2 ** 31) }, signal);
    src = art.src;
    emit({ type: "painted", src });
    if (video && animate) {
      const [vw, vh] = VIDEO_SIZE[req.aspect];
      const t0 = Date.now();
      const say = () => emit({ type: "status", phase: "video", message: `Animating the painting frame by frame (${Math.round((Date.now() - t0) / 1000)} s; usually 5–10 min)` });
      say();
      const tick = setInterval(say, 15_000);
      try {
        const clip = await animate(
          { image: art.png, positive: videoPrompt(storyboard.motion, storyboard.scene || req.prompt, style.label), negative: VIDEO_NEGATIVE, width: vw, height: vh, frames: 121, fps: 24, seed: Math.floor(Math.random() * 2 ** 31) },
          signal,
        );
        const spec = footageScene(meta, style.palette, storyboard.beats, clip);
        emit({ type: "done", spec, repairs: 0 });
        return spec;
      } finally {
        clearInterval(tick);
      }
    }
    if (provider.vision) {
      emit({ type: "status", phase: "paint", message: "Finding what can move in the painting" });
      // a scene without moving parts beats no scene
      info = await findMotions(art.png, provider, duration, signal).catch(() => null);
    }
  }

  emit({ type: "status", phase: "spec", message: painted ? "Animating the painting" : "Writing the scene" });
  const tidyRaw = (raw: unknown) => {
    const n = normalize(raw, meta);
    // the style's colors win over the model's, so its scenes keep one look
    if (n && typeof n === "object") (n as { palette?: unknown }).palette = { ...((n as { palette?: object }).palette ?? {}), ...style.palette };
    return painted ? keepPainted(n, src, info, PAINT_SIZE[req.aspect], storyboard.subjects) : n;
  };
  const cat = painted ? paintedCatalog() : aiCatalog();
  const paintedNote = painted
    ? `\nThe background is already painted; its moving subjects get their own drawing layers automatically, so don't add characters or props. layers[0] must be {"id":"painting","type":"painting","params":{"src":"${src}"}}; after it add only moving effects that fit the storyboard (light flicker, glow, particles), plus a fade. You cannot see the painting: add rain only if the scene is outdoors (rain over the whole frame would fall inside a room); indoors the painting already shows the weather.`
    : "";
  const specUser = `${user}\nUse meta exactly: ${JSON.stringify(meta)}\nStoryboard:\n${JSON.stringify(storyboard)}${paintedNote}`;
  const example = painted ? JSON.stringify(PAINTED_EXAMPLE) : exampleFor(`${req.prompt} ${storyboard.title} ${storyboard.mood}`);
  let text = await provider.generateJSON({ system: prompt("spec", { catalog: cat, example }), user: specUser, schema: sceneSpecJsonSchema, onToken: counter("spec"), signal });

  for (let attempt = 0; ; attempt++) {
    const p = parseOrError(text);
    const v = "value" in p ? validateScene(tidyRaw(p.value)) : { ok: false as const, errors: [p.error] };
    // an empty scene gets one repair; after that a thin but valid scene beats an error
    const thin = v.ok && attempt === 0 && !painted ? contentProblems(v.spec) : [];
    const r = thin.length ? { ok: false as const, errors: thin } : v.ok ? { ok: true as const, spec: tidy(v.spec) } : v;
    if (r.ok) {
      emit({ type: "done", spec: r.spec, repairs: attempt });
      return r.spec;
    }
    if (attempt >= MAX_REPAIRS) {
      emit({ type: "error", message: `The scene still had ${r.errors.length} problem(s) after ${MAX_REPAIRS} repair attempts`, fix: "Try again or simplify the idea.", errors: r.errors });
      return null;
    }
    emit({ type: "repairing", attempt: attempt + 1, errors: r.errors });
    const broken = "value" in p ? JSON.stringify(tidyRaw(p.value)) : text;
    text = await provider.generateJSON({
      system: prompt("repair", { catalog: cat, errors: r.errors.slice(0, 20).map((e) => `- ${e}`).join("\n"), spec: broken }),
      user: "Return the fixed scene spec JSON.",
      schema: sceneSpecJsonSchema,
      onToken: counter("repair"),
      signal,
    });
  }
}

const VIDEO_NEGATIVE = "static image, still frame, frozen, blurry, distorted face, deformed hands, extra fingers, morphing, melting, flickering, jitter, camera shake, low quality, watermark, text, subtitles";

/** Plain sentences work best for the video model: what moves, then the picture, then the look. */
export const videoPrompt = (motion: string, scene: string, style: string) =>
  `${motion.trim().replace(/[.\s]+$/, "") || "Gentle natural motion: breathing, small movements, light flickering softly"}. The picture: ${scene}. ${style} animation style, smooth, consistent characters, stable camera.`;

/** A video scene: the clip, a soft vignette and a fade in/out; beats from the storyboard. */
export function footageScene(meta: SceneSpec["meta"], palette: Record<string, string>, beats: SceneSpec["beats"], clip: Footage): SceneSpec {
  const d = meta.duration, a = Math.min(1, d / 6);
  const r = validateScene({
    version: 1,
    meta,
    palette,
    tracks: { fade: { keys: [[0, 0], [a, 1], [d - a, 1], [d, 0]] } },
    layers: [{ id: "video", type: "footage", params: clip }],
    overlays: [{ type: "vignette", params: { strength: 0.35 } }, { type: "fade", params: { reveal: "@fade" } }],
    beats,
  });
  if (!r.ok) throw new Error(`Video scene failed validation: ${r.errors.join("; ")}`);
  return r.spec;
}

/** What a painted scene looks like: the painting, then effects animated with tracks. */
const PAINTED_EXAMPLE = {
  version: 1,
  meta: { title: "rainy window", style: "lofi-cozy", duration: 12, fps: 30, width: 1280, height: 720 },
  palette: { rain: "#b8c8ff" },
  tracks: { fade: { keys: [[0, 0], [1, 1], [11, 1], [12, 0]] }, rain: { keys: [[0, 0.6], [6, 1.4], [12, 0.6]] } },
  layers: [
    { id: "painting", type: "painting", params: { src: "/api/images/example.png", swaySeconds: 12 } },
    { id: "rain", type: "rain", params: { intensity: "@rain", color: "$rain" } },
  ],
  overlays: [{ type: "vignette", params: { strength: 0.45 } }, { type: "fade", params: { reveal: "@fade" } }],
  beats: [{ at: 0, label: "Rain at night" }, { at: 6, label: "Heavier rain" }],
};
