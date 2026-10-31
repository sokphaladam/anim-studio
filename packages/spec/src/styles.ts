import { z } from "zod";

export const STYLE_IDS = ["flat-motion", "anime", "hand-painted", "luminous-skies", "lofi-cozy", "cel-90s", "city-pop", "storybook-watercolor"] as const;
export const StyleIdSchema = z.enum(STYLE_IDS);
export type StyleId = z.infer<typeof StyleIdSchema>;

export interface ArtStyle {
  id: StyleId;
  label: string;
  /** One sentence for the picker. */
  blurb: string;
  /** Colors the AI builds the scene from, so every scene in a style looks like the same film. */
  palette: Record<string, string>;
  /** Final color grade the engine applies to vector scenes (painted scenes get it baked in by the painter). */
  grade: { saturate: number; contrast: number; brightness: number; tint: string; tintAmount: number; bloom: number; grain: number };
  /** Tags for the image model, placed after the subject (the checkpoint reads tags in order). Describe the look; never name artists or studios. */
  paint: { positive: string; negative: string; model?: string };
}

// the checkpoint's recommended negative prompt, plus a few things that never belong in these scenes
const NEG = "lowres, bad anatomy, bad hands, text, error, missing finger, extra digits, fewer digits, cropped, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry, logo, 3d render, photo";

export const ART_STYLES: Record<StyleId, ArtStyle> = {
  "flat-motion": {
    id: "flat-motion",
    label: "Flat 2D motion graphics",
    blurb: "Flat vector shapes, bold limited colors, no outlines or texture: explainer-video motion graphics.",
    palette: { bg: "#1f2a44", sky: "#3a6ea5", light: "#ffd166", accent: "#ef476f", mint: "#06d6a0", shadow: "#16213a", white: "#f8f4ec" },
    grade: { saturate: 1.05, contrast: 1, brightness: 1, tint: "#ffffff", tintAmount: 0, bloom: 0, grain: 0 },
    paint: {
      positive: "flat 2D vector illustration, motion graphics style, flat design, simple geometric shapes, solid flat colors, limited color palette, clean minimal, no outlines, no texture",
      negative: `${NEG}, gradient, texture, painterly, realistic, detailed shading, sketch, noise`,
      // SDXL base draws flat design far better than the anime checkpoint; a diffusers folder on ComfyUI's "diffusers" path
      model: "stable-diffusion-xl-base-1.0",
    },
  },
  anime: {
    id: "anime",
    label: "Anime",
    blurb: "Clean modern anime illustration: crisp shapes, soft gradients, warm and cool light.",
    palette: { sky: "#3d4f8c", skyLow: "#f0a77c", shadow: "#232038", light: "#ffd9a0", accent: "#e46f6f", skin: "#f3c9aa", foliage: "#4f8a6b" },
    grade: { saturate: 1.08, contrast: 1.05, brightness: 1, tint: "#ffb07a", tintAmount: 0.04, bloom: 0.25, grain: 0.02 },
    paint: { positive: "anime illustration, modern anime style, clean lineart, soft cel shading, detailed background, beautiful lighting", negative: NEG },
  },
  "hand-painted": {
    id: "hand-painted",
    label: "Hand-painted",
    blurb: "Warm hand-painted animation backgrounds: gouache textures, lush greens, puffy clouds, gentle everyday life.",
    palette: { sky: "#7fb3d5", cloud: "#f6f1e3", foliage: "#5c8a4a", earth: "#b07a4f", roof: "#b5523b", shadow: "#3b4a3f", light: "#fbe8b8" },
    grade: { saturate: 1.02, contrast: 0.98, brightness: 1.03, tint: "#f4d9a0", tintAmount: 0.06, bloom: 0.15, grain: 0.04 },
    paint: { positive: "hand-painted anime background, gouache painting, watercolor texture, lush green countryside, puffy cumulus clouds, warm nostalgic, soft natural light, painterly", negative: NEG },
  },
  "luminous-skies": {
    id: "luminous-skies",
    label: "Luminous skies",
    blurb: "Hyper-detailed twilight skies, glowing city lights, lens flare and emotional distance.",
    palette: { skyTop: "#1b2a5e", skyMid: "#7a5aa8", skyLow: "#ff9a6b", glow: "#ffe1a8", city: "#1a1e3c", windowLight: "#ffd27a", accent: "#7fd4ff" },
    grade: { saturate: 1.18, contrast: 1.1, brightness: 1.02, tint: "#9fb8ff", tintAmount: 0.05, bloom: 0.45, grain: 0.015 },
    paint: { positive: "anime background art, hyper detailed twilight sky, dramatic clouds, glowing city lights, lens flare, light rays, sparkling, cinematic composition, emotional atmosphere, vivid gradient sky", negative: NEG },
  },
  "lofi-cozy": {
    id: "lofi-cozy",
    label: "Lofi cozy room",
    blurb: "Late-night lofi: dim purple rooms, warm lamp glow, fairy lights, rain on the window.",
    palette: { wall: "#3b2a4a", shadow: "#1c1528", lamp: "#ffc38a", screen: "#8ec5ff", accent: "#e88aa8", wood: "#5a3c3a", plant: "#5f8a5e" },
    grade: { saturate: 0.95, contrast: 1.02, brightness: 0.97, tint: "#b48cff", tintAmount: 0.07, bloom: 0.4, grain: 0.05 },
    paint: { positive: "lofi anime illustration, cozy room at night, dim purple lighting, warm lamp glow, fairy lights, plants, soft shadows, relaxing atmosphere, detailed interior", negative: NEG },
  },
  "cel-90s": {
    id: "cel-90s",
    label: "90s cel anime",
    blurb: "Retro 1990s TV anime: flat cel colors, film grain, muted tones, slightly washed highlights.",
    palette: { sky: "#6f8fb3", skyLow: "#e8b48a", shadow: "#2f2b3d", skin: "#f0c4a0", accent: "#c8484a", cloth: "#3d5a80", light: "#f3e2b8" },
    grade: { saturate: 0.85, contrast: 0.95, brightness: 1.02, tint: "#e8c8a0", tintAmount: 0.1, bloom: 0.1, grain: 0.09 },
    paint: { positive: "1990s anime screencap, retro anime, cel animation, flat colors, film grain, muted colors, vhs, vintage", negative: `${NEG}, modern` },
  },
  "city-pop": {
    id: "city-pop",
    label: "City pop",
    blurb: "1980s city-pop poster: pastel gradients, palm trees, chrome, bold flat shapes.",
    palette: { skyTop: "#6fd1e6", skyLow: "#ff9fc4", sun: "#ffd166", sea: "#3fa3c9", palm: "#2d6a6a", accent: "#ff5c8a", white: "#fff6ea" },
    grade: { saturate: 1.2, contrast: 1.08, brightness: 1.04, tint: "#ff9fc4", tintAmount: 0.06, bloom: 0.3, grain: 0.03 },
    paint: { positive: "1980s city pop album cover, retro illustration, pastel gradient sky, palm trees, flat bold colors, airbrush, summer, poster art", negative: NEG },
  },
  "storybook-watercolor": {
    id: "storybook-watercolor",
    label: "Storybook watercolor",
    blurb: "Children's-book watercolor: soft washes, paper texture, gentle pencil edges.",
    palette: { paper: "#f7f0e1", sky: "#a9c8e0", foliage: "#9bbf8a", earth: "#d8b48a", accent: "#e08a7a", ink: "#5a4a5a", light: "#fff3d6" },
    grade: { saturate: 0.82, contrast: 0.92, brightness: 1.06, tint: "#f5e6c8", tintAmount: 0.1, bloom: 0.1, grain: 0.06 },
    paint: { positive: "storybook illustration, watercolor painting, soft washes, paper texture, pencil outlines, gentle pastel colors, children's book art", negative: NEG },
  },
};
