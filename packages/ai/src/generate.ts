import type { Asset, CharacterProfile, SceneSpec } from "@anim/spec";
import type { AnimateArgs } from "./painters/comfyui";

export type Aspect = "16:9" | "9:16" | "1:1";
export const ASPECT_SIZE: Record<Aspect, [number, number]> = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [1080, 1080] };
/** SDXL-friendly sizes (multiples of 64, ~1 megapixel) per aspect. */
export const PAINT_SIZE: Record<Aspect, [number, number]> = { "16:9": [1344, 768], "9:16": [768, 1344], "1:1": [1024, 1024] };

/** The one look every scene is painted in: a soft lofi anime illustration. */
export const LOOK = {
  positive: "lofi anime illustration, cozy, soft lighting, clean lineart, flat colors, simple shading, calm atmosphere",
  negative: "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry, logo, 3d render, photo",
};

/** Tag order the anime checkpoint was trained on: subject first, then the look, then quality/score tags. */
export const paintPrompt = (subject: string) => `${subject}, ${LOOK.positive}, masterpiece, best quality, high score, great score, absurdres`;

export interface GenerateRequest {
  prompt: string;
  duration: number;
  aspect: Aspect;
  /** Saved character profiles to keep (and reuse when the idea brings them back), by character id. */
  characters?: Record<string, CharacterProfile>;
  /** The profiles' reference paintings, by asset id. */
  assets?: Record<string, Asset>;
}

/** A clip stored as numbered JPEG frames: `${frames}001.jpg` … */
export type Footage = { frames: string; count: number; fps: number };
/** Animates a picture into a short clip and stores its frames (older painted scenes: AI › Turn the painting into video). */
export type AnimateFn = (args: Omit<AnimateArgs, "signal">, signal?: AbortSignal) => Promise<Footage>;

/** Plain sentences work best for the video model: what moves, then the picture, then the look. */
export const videoPrompt = (motion: string, scene: string) =>
  `${motion.trim().replace(/[.\s]+$/, "") || "Gentle natural motion: breathing, small movements, light flickering softly"}. The picture: ${scene}. Lofi anime animation style, smooth, consistent characters, stable camera.`;

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
