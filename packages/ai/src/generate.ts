import type { Asset, CharacterProfile, SceneSpec } from "@anim/spec";
import type { AnimateArgs } from "./painters/comfyui";

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECT_SIZE: Record<Aspect, [number, number]> = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [1080, 1080] };
/** SDXL-friendly sizes (multiples of 64, ~1 megapixel) per aspect. */
export const PAINT_SIZE: Record<Aspect, [number, number]> = { "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [1024, 1024] };

/**
 * The visual directions a scene can be painted in. Each is the anime checkpoint's tags for the look (painter) plus a
 * plain sentence for the same look (video model), so the loop keeps the painting's style.
 */
export const STYLES = {
  lofi: {
    label: "Cozy lofi",
    hint: "Warm lamp light, clean outlines, flat colors: the classic lofi study room.",
    positive: "lofi anime illustration, cozy, thick clean outlines, flat colors, cel shading, warm lamp light, soft glow, rim light, warm limited color palette, calm atmosphere",
    negative: "",
    video: "Lofi anime animation style, clean outlines, warm soft light",
  },
  cinematic: {
    label: "Cinematic anime",
    hint: "Film-like light: glowing skies, light rays, rich detailed backgrounds.",
    positive: "anime film still, cinematic lighting, volumetric lighting, light rays, beautiful detailed sky, highly detailed background, vibrant colors, soft bloom, atmospheric perspective, dramatic composition",
    negative: ", flat colors, simple background, sketch",
    video: "Cinematic anime film style, soft volumetric light, glowing highlights, rich detail",
  },
  retro: {
    label: "Retro 90s anime",
    hint: "Hand-painted cels, muted colors and soft film grain, like a 90s anime.",
    positive: "1990s (style), retro artstyle, cel animation, hand-painted background, muted colors, soft pastel tones, film grain, soft focus, vintage anime",
    negative: ", glossy, digital painting, vibrant colors, bloom",
    video: "1990s hand-drawn cel animation style, muted colors, subtle film grain",
  },
} as const;
export type StyleId = keyof typeof STYLES;

/** Tags every look avoids; each style adds its own. */
const BASE_NEGATIVE = "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry, logo, 3d render, photo";
/** The default look (Cozy lofi), for callers that don't pick one. */
export const LOOK = { positive: STYLES.lofi.positive, negative: BASE_NEGATIVE };
export const negativeFor = (style: StyleId = "lofi") => `${BASE_NEGATIVE}${STYLES[style].negative}`;

/** Tag order the anime checkpoint was trained on: subject first, then the look, then quality/score tags. */
export const paintPrompt = (subject: string, style: StyleId = "lofi") => `${subject}, ${STYLES[style].positive}, masterpiece, best quality, high score, great score, absurdres`;

export interface GenerateRequest {
  prompt: string;
  duration: number;
  aspect: Aspect;
  /** The visual direction (default: Cozy lofi). */
  style?: StyleId;
  /** Saved character profiles to keep (and reuse when the idea brings them back), by character id. */
  characters?: Record<string, CharacterProfile>;
  /** The profiles' reference paintings, by asset id. */
  assets?: Record<string, Asset>;
}

/** A clip stored as numbered JPEG frames: `${frames}001.jpg` … */
export type Footage = { frames: string; count: number; fps: number; loops?: boolean };
/** Animates a picture into a short clip and stores its frames (older painted scenes: AI › Turn the painting into video). */
export type AnimateFn = (args: Omit<AnimateArgs, "signal">, signal?: AbortSignal) => Promise<Footage>;

/** Plain sentences work best for the video model: what moves, then the picture, then the look. */
export const videoPrompt = (motion: string, scene: string, style: StyleId = "lofi") =>
  `${motion.trim().replace(/[.\s]+$/, "") || "Gentle natural motion: breathing, small movements, light flickering softly"}. The picture: ${scene}. ${STYLES[style].video}, hand-drawn 2D animation, gentle, consistent characters, stable camera.`;

/** What the video model is told about stillness in every loop, so the painted layout survives the motion. */
// the person, steam, rain and lights must stay free to move ("nothing moves" froze whole clips), but slowly:
// "visibly" made the model move everything, the sky included
export const HOLD_STILL = "The camera stays completely still and the room and furniture keep their exact place, shape and size, nothing appears or disappears; only the person and the named things move, very slowly and subtly, small gentle movements, a calm continuous motion that could repeat forever";
const PEOPLE = { girl: /\b(girl|woman|lady)\b/i, boy: /\b(boy|man|guy)\b/i };
// the video model only moves what is painted, and conjures what isn't (steam rising off a record player): what the motion
// names is always tagged, even when the scene already says it ("a steaming mug" alone was left out of a busy painting)
const PAINT_MOTION: [RegExp, string][] = [[/steam/i, "mug, steam"], [/rain/i, "rain, raindrops on window"], [/snow/i, "snowing"], [/candle|fire/i, "warm flickering flame"]];

/**
 * Single-painting mode: one scene prompt ("… Motion: … Everything stays in place …") becomes what the painter paints
 * (the still scene, without the loop and camera words it can't draw) and what the video model moves.
 */
export function paintingPrompts(prompt: string, style: StyleId = "lofi") {
  const at = prompt.search(/\bMotion:/i);
  const sceneText = (at < 0 ? prompt : prompt.slice(0, at)).trim();
  const motion = at < 0 ? "" : prompt.slice(at + "Motion:".length).replace(/Everything stays in place[^.]*\.?/i, "").trim();
  const scene = sceneText.replace(/\b\d+[- ]second\b[^,.]*[,.]?|\bseamless loop\b,?|\bstatic camera\b,?/gi, "").replace(/\s+([,.])/g, "$1").replace(/\s{2,}/g, " ").trim();
  // the anime checkpoint needs a count tag, or it may paint a crowd; one person at most, as the song ideas write them
  // seen from the side, looking away, as lofi videos frame them (a front-facing stare looks frozen when animated)
  const person = PEOPLE.girl.test(scene) ? "1girl" : PEOPLE.boy.test(scene) ? "1boy" : "";
  const who = person ? `${person}, solo, from side, looking away, ` : "no humans, scenery, ";
  const moving = PAINT_MOTION.filter(([re]) => re.test(motion)).map(([, tag]) => `, ${tag}`).join("");
  // the time and weather (the ideas' first clause) decide the whole light; buried mid-prompt the checkpoint ignores
  // them and paints daylight, so they go first, weighted, with the tags it knows for a dark room
  // (the "lofi anime illustration" opener is dropped: the house look already says it)
  const body = scene.replace(/^[^,.]*\billustration\b,?\s*/i, "");
  const time = body.split(",")[0].trim();
  const weighted = time.length > 0 && time.length < 80 && !/[.]/.test(time);
  const dark = weighted && /night|dusk|evening|twilight|midnight|dark/i.test(time) ? ", night, dark, dim lighting, warm lamp light, glowing windows" : "";
  const still = weighted ? `(${time}:1.3)${dark}, ${body.slice(body.indexOf(",") + 1).trim()}` : body;
  return {
    /** The idea has a person in it, so the painting must too (else the video model invents one mid-clip). */
    person: !!person,
    paint: { positive: paintPrompt(`${who}${still}${moving}, detailed background, depth of field`, style), negative: `${negativeFor(style)}, multiple people, extra arms, floating objects, bad perspective, cropped${person ? ", looking at viewer, facing viewer" : ""}` },
    video: videoPrompt(`${motion.replace(/[.\s]+$/, "") || "Gentle natural motion: breathing, blinking, hair swaying slightly, lights flickering softly"}. ${HOLD_STILL}`, scene, style),
  };
}

/** Deterministic tidy-ups that don't need the model: sort keys, keep times inside the scene, force the scene's size. */
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
