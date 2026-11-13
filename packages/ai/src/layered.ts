// Layered animation: the language model plans layers and motions, the image painter paints each layer, and the parts
// are cut out with real masks. The result is an ordinary editable scene of image layers rigged with parents and pivots,
// plus ambient effects, with every motion compiled to (mostly looping) keyframes before playback.
import { applyExpression, BASE_OPTION, compileActions, EXPRESSIONS, fitPeriod, poseProblems, validateScene, type Expression, type FaceSlot } from "@anim/engine";
import type { Action, Asset, CharacterProfile, Layer, SceneSpec, Switch } from "@anim/spec";
import { z } from "zod";
import { ASPECT_SIZE, negativeFor, PAINT_SIZE, paintPrompt as paintTags, type GenerateRequest } from "./generate";
import { extractJson } from "./json";
import { count, crop, cutout, defaultCleanup, grow, intersect, islandBoxes, withoutInk, maskBox, maskFrom, maskImage, neckPoint, palette, paletteDrift, paste, recut, reviewOf, separateIrises, smear, subtract, union, type Check, type Mask, type Raster } from "./masks";
import type { Painter } from "./painters/comfyui";
import { prompt } from "./prompts";
import { AIError, type Provider } from "./types";

const Slug = z.string().regex(/^[a-z][a-z0-9_]*$/, "Use a lowercase word like \"girl\"");
const Frac = z.number().min(0).max(1);
const PlaceBox = z.tuple([Frac, Frac, Frac, Frac]);
export const IDLE = ["breathe", "bob", "blink"] as const;
export const AMBIENT = ["stars", "falling-leaves", "birds", "steam", "rain"] as const;
const FACES = ["happy", "sad", "surprised", "eyes-closed"] as const;

export const LayeredPlanSchema = z.object({
  title: z.string().min(1),
  mood: z.string().default(""),
  beats: z.array(z.object({ at: z.number().min(0), label: z.string().min(1), note: z.string().optional() })).min(1),
  setting: Slug.default("scene"),
  environment: z.string().min(3),
  lighting: z.string().default(""),
  characters: z
    .array(
      z.object({
        id: Slug,
        look: z.string().min(2),
        pose: z.string().min(2),
        box: PlaceBox,
        idle: z.array(z.enum(IDLE)).default([]),
        parts: z.array(z.object({ id: Slug, find: z.string().min(2), motion: z.enum(["swing", "sway"]), target: Slug.optional() })).max(2).default([]),
        /** Facial expressions the scene needs besides the painted one; each is painted as eye / mouth / brow overlays. */
        expressions: z.array(z.enum(FACES)).max(4).default([]),
      }),
    )
    .min(1)
    .max(3),
  props: z.array(z.object({ id: Slug, look: z.string().min(2), box: PlaceBox, front: z.boolean().default(false), motion: z.enum(["none", "sway", "drift"]).default("none") })).max(4).default([]),
  ambient: z.array(z.object({ type: z.enum(AMBIENT), box: PlaceBox.optional(), at: Slug.optional() })).max(4).default([]),
  actions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("look_at"), who: Slug, target: Slug, start: z.number().min(0), end: z.number().positive(), wakes: z.boolean().default(false) }),
        z.object({ type: z.literal("walk"), who: Slug, path: z.array(z.tuple([Frac, Frac])).min(2).max(6), start: z.number().min(0), end: z.number().positive(), rest: z.number().min(0).default(0), rest_pose: z.string().min(2).optional() }),
        z.object({ type: z.literal("expression"), who: Slug, expression: z.enum([...FACES, "neutral"]), start: z.number().min(0) }),
      ]),
    )
    .max(6)
    .default([]),
  /** Moments worth a cinematic AI video clip (made only when asked for). Everything else stays rigged 2D animation. */
  shots: z.array(z.object({ id: Slug, start: z.number().min(0), end: z.number().positive(), motion: z.string().min(3) })).max(2).default([]),
});
export type LayeredPlan = z.output<typeof LayeredPlanSchema>;
const planJsonSchema = z.toJSONSchema(LayeredPlanSchema, { io: "input" });

const SIP = /\b(sip|sips|sipping|drink|drinks|drinking)\b/i;
/**
 * Repairs the staging mistakes that make a scene look pasted together, instead of sending the plan back (models repeat
 * them): a cloud painted as a prop is painted into the sky instead (cut out on grey it came back as a flat disc, and a
 * drawn cloud overlay can't tell sky from ceiling); a sip gets the arm that lifts the cup; a prop a character holds
 * without a moving arm is dropped (it is painted in their hands), with any steam rising from it.
 */
export function tidyPlan(p: LayeredPlan): LayeredPlan {
  const beats = p.beats.map((b) => `${b.label} ${b.note ?? ""}`).join(" ");
  const clouds = p.props.filter((x) => /cloud/i.test(`${x.id} ${x.look}`));
  const characters = p.characters.map((c) => {
    const swings = c.parts.some((part) => part.motion === "swing");
    // the sip in the beats belongs to the one character holding something to drink (or the only one)
    const sips = SIP.test(c.pose) || (SIP.test(beats) && (p.characters.length === 1 || /hold/i.test(c.pose)));
    if (!sips || swings || c.parts.length >= 2) return c;
    const cup = p.props.find((x) => /mug|cup|tea|coffee|glass/i.test(`${x.id} ${x.look}`))?.id ?? "mug";
    return { ...c, parts: [...c.parts, { id: "arm", find: `arm holding the ${cup}`, motion: "swing" as const }] };
  });
  const words = (s: string) => s.replace(/_/g, " ").toLowerCase();
  const held = new Set(p.props.filter((x) => characters.some((c) => !c.parts.some((part) => part.motion === "swing") && new RegExp(`\\b${words(x.id)}\\b`).test(words(c.pose)))).map((x) => x.id));
  const gone = new Set([...clouds.map((x) => x.id), ...held]);
  if (!gone.size && characters.every((c, i) => c === p.characters[i])) return p;
  return {
    ...p,
    environment: clouds.length && !/cloud/i.test(p.environment) ? `${p.environment}, ${clouds[0].look}` : p.environment,
    characters,
    props: p.props.filter((x) => !gone.has(x.id)),
    ambient: p.ambient.filter((a) => !(a.at && gone.has(a.at))),
    actions: p.actions.filter((a) => a.type !== "look_at" || !gone.has(a.target)),
  };
}

/** Plan mistakes the schema can't see: unknown or duplicate ids, actions outside the scene, empty boxes. */
export function planProblems(p: LayeredPlan, duration: number): string[] {
  const out: string[] = [];
  const chars = p.characters.map((c) => c.id), props = p.props.map((x) => x.id), ids = [...chars, ...props];
  ids.forEach((id, i) => ids.indexOf(id) !== i && out.push(`"${id}" is used twice; give every character and prop its own id`));
  for (const x of [...p.characters, ...p.props]) if (x.box[2] - x.box[0] < 0.02 || x.box[3] - x.box[1] < 0.02) out.push(`${x.id}.box: x1 must be > x0 and y1 > y0`);
  for (const c of p.characters)
    for (const part of c.parts) if (part.target !== undefined && !ids.includes(part.target)) out.push(`${c.id}.parts.${part.id}.target: "${part.target}" must be a prop or character (${ids.join(", ")})`);
  p.ambient.forEach((a, i) => {
    if (a.type === "steam" && !(a.at && props.includes(a.at))) out.push(`ambient[${i}]: steam needs "at": the prop it rises from (${props.join(", ") || "no props"})`);
  });
  p.actions.forEach((a, i) => {
    if (!chars.includes(a.who)) out.push(`actions[${i}].who: "${a.who}" is not a character (characters: ${chars.join(", ")})`);
    if (a.type === "look_at" && (!ids.includes(a.target) || a.target === a.who)) out.push(`actions[${i}].target: "${a.target}" must be a prop or another character (${ids.join(", ")})`);
    if (a.type === "expression") {
      const c = p.characters.find((x) => x.id === a.who);
      if (c && a.expression !== "neutral" && !c.expressions.includes(a.expression)) out.push(`actions[${i}]: add "${a.expression}" to ${a.who}.expressions so it is painted`);
      if (a.start > duration) out.push(`actions[${i}].start: ${a.start}s is past the ${duration}s duration`);
    } else if (a.end <= a.start || a.end > duration) out.push(`actions[${i}]: start ${a.start}s and end ${a.end}s must satisfy 0 <= start < end <= ${duration}`);
  });
  const shotIds = p.shots.map((s) => s.id);
  p.shots.forEach((s, i) => {
    if (shotIds.indexOf(s.id) !== i) out.push(`shots[${i}].id: "${s.id}" is used twice`);
    const len = s.end - s.start;
    if (s.end > duration || len < SHOT_SECONDS[0] || len > SHOT_SECONDS[1]) out.push(`shots[${i}]: start ${s.start}s and end ${s.end}s must be ${SHOT_SECONDS[0]}-${SHOT_SECONDS[1]} seconds apart and end by ${duration}s`);
  });
  return out;
}

/** Length range of a cinematic shot: what the cloud video models accept and a single clip holds together. */
export const SHOT_SECONDS = [4, 10] as const;
export type Shot = LayeredPlan["shots"][number];
/** The plan's cinematic shots; without any, one shot from the start (as long as a clip may be) moving as the beats say. */
export function cinematicShots(p: LayeredPlan, duration: number): Shot[] {
  if (p.shots.length) return p.shots;
  const motion = p.beats.map((b) => b.note ?? b.label).join(". ") || p.mood || "gentle natural motion";
  return [{ id: "scene", start: 0, end: Math.min(duration, SHOT_SECONDS[1]), motion }];
}

/** Longest video-loop clip: longer clips cost more and drift further from the first frame. */
// short: a 4 s clip is a third faster to make and, slowed and ping-ponged, still fills a 12 s scene
const LOOP_MAX = 4;
/** A video loop's length: the largest that divides the scene into whole loops, at most LOOP_MAX (two 6 s loops in 12 s). */
export const loopSeconds = (duration: number) => Math.max(SHOT_SECONDS[0], +(duration / Math.ceil(duration / LOOP_MAX)).toFixed(3));
const IDLE_WORDS = { breathe: "breathes slowly", bob: "nods gently to the music", blink: "blinks now and then" } as const;
/**
 * The one shot that animates the whole scene with natural motion, as a seamless loop: a clip length that divides the
 * scene (two 6 s loops in 12 s), so its own loop point falls on the scene's; a still camera, so the loop has no jump;
 * and what moves, from the plan (the video model moves what a cut-out can't: legs, bodies, hair).
 */
export function loopShot(p: LayeredPlan, duration: number): Shot {
  const end = loopSeconds(duration);
  const who = p.characters.map((c) => [`the ${label(c.id)} ${c.idle.map((i) => IDLE_WORDS[i]).join(", ") || "stays calm and still"}`, ...c.parts.map((x) => `${x.motion === "swing" ? "lifts" : "gently moves"} the ${x.find}`)].join(" and "));
  const acts = p.actions.flatMap((a) => (a.type === "walk" ? [`the ${label(a.who)} walks slowly with natural steps${a.rest > 0 ? `, rests ${a.rest} seconds,` : ""} and comes back`] : a.type === "look_at" ? [`the ${label(a.who)} looks toward the ${label(a.target)}`] : []));
  const fx = p.ambient.map((a) => ({ stars: "stars twinkle", "falling-leaves": "leaves fall gently", birds: "birds cross the sky", steam: "steam curls up", rain: "rain falls" })[a.type]);
  const motion = [...who, ...acts, ...fx, "the camera stays completely still, every object keeps its exact place, shape and size, nothing appears or disappears, calm continuous motion that could repeat forever"].join(". ");
  return { id: "loop", start: 0, end, motion };
}

/** What the host provides: the painter (with the segmentation tools), the image store, and a PNG codec. */
export interface LayeredTools {
  painter: Painter;
  /** Stores PNG bytes; resolves with the src scenes use for them. */
  store(png: Uint8Array): string;
  decode(png: Uint8Array): Promise<Raster>;
  encode(r: Raster): Uint8Array;
}

export type LayeredStage = "plan" | "background" | "character" | "props" | "segment" | "reconstruct" | "rig" | "animate" | "validate";
export type LayeredEvent =
  | { type: "status"; phase: LayeredStage; message: string }
  | { type: "token"; phase: "plan"; tokens: number }
  | { type: "plan"; plan: LayeredPlan; meta: SceneSpec["meta"] }
  | { type: "asset"; id: string; label: string; status: "running" | "done" | "review" | "skipped" | "failed"; src?: string; message?: string }
  | { type: "done"; spec: SceneSpec; repairs: number }
  /** What an agent saw, decided or is fixing, in a sentence for the chat. */
  | { type: "thought"; text: string; details?: string[] };

const WHITE_BG = "simple background, white background";
// light things (clouds, steam, the moon) vanish on white, so they are painted on grey to be cut out
const GREY_BG = "simple background, grey background";
const LIGHT_THING = /cloud|moon|snow|smoke|steam|mist|ghost|white/i;
const NO_PEOPLE = "1girl, 1boy, person, people, human, face, animal, character";
// the anime checkpoint draws a picture-in-a-picture or a landscape when it isn't told not to
// the white outline: anime paintings on white often get a sticker border, which a cut-out then keeps as a halo
const NO_FRAME = "frame, border, picture frame, framed, card, scenery, landscape, horizon, white outline, sticker, die-cut";
// a character is painted alone: the setting it sits in is the background's job
const NO_SET = "window, window frame, arch, door, wall, building, room, furniture, bench, chair";
// a seated character is painted without its seat (NO_SET), so it must be put on a seat the background painted
const SEATED = /\b(sit|sits|sitting|seated)\b/i;
const SEAT_WORDS = ["chair", "bench", "sofa", "stool"];
const HUMAN = /\b(1?girl|1?boy|man|woman|person|kid|child|lady|guy|human|witch|student)s?\b/i;
/** SDXL sizes (~1 megapixel, multiples of 64); a character is painted at the one closest to its box's shape. */
const SDXL_SIZES: [number, number][] = [[1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216], [1344, 768], [768, 1344]];
const sizeFor = (aspect: number) => SDXL_SIZES.reduce((b, s) => (Math.abs(Math.log(s[0] / s[1] / aspect)) < Math.abs(Math.log(b[0] / b[1] / aspect)) ? s : b));
/** Longest turn a look_at takes; models sometimes stretch it to the end of the scene, leaving no held pose. */
const MAX_TURN_SECONDS = 2;
/** Default ambient loop lengths (seconds), fitted to the scene so the video loops seamlessly. */
const AMBIENT_PERIOD = { stars: 6, "falling-leaves": 6, birds: 12, steam: 3, rain: 1 } as const;
export const label = (id: string) => id.replace(/_/g, " ");
/** How each face slot is found on the head, and the words that paint each of its options (and what to avoid). */
const SLOT_FIND: Record<FaceSlot, string> = { eyes: "eyes", mouth: "mouth", brows: "eyebrows" };
const SLOT_WORDS: Record<string, [string, string]> = {
  "eyes:closed": ["closed eyes", "open eyes"],
  "eyes:wide": ["wide open eyes, surprised", "closed eyes, narrow eyes"],
  "mouth:smile": ["smile, happy", "frown, open mouth"],
  "mouth:frown": ["frown, sad", "smile"],
  "mouth:open": ["open mouth, surprised", "closed mouth, smile"],
  "brows:sad": ["worried eyebrows, sad", "angry, raised eyebrows"],
  "brows:raised": ["raised eyebrows, surprised", "frown, furrowed brow"],
};
/**
 * Keeps, of what background removal found, only the subject the segmenter recognises (plus a margin for hair and soft
 * edges): painters often draw a window, a seat or a floor with a character, and that scenery must not become part of it.
 * Returns the trimmed mask and how much scenery was dropped (0–1); the untrimmed mask if the segmenter's is too small to
 * trust (it would cut the subject apart).
 */
function subjectOnly(all: Mask, found: Mask, w: number, h: number): { mask: Mask; dropped: number } {
  const kept = intersect(all, grow(found, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.015))));
  const n = count(all), k = count(kept);
  if (!n || k < count(found) * 0.5) return { mask: all, dropped: 0 };
  return { mask: kept, dropped: 1 - k / n };
}
/** A check for scenery dropped from a cut-out: fine when little; a person should look when a lot went (or kept too much). */
const sceneryCheck = (dropped: number): Check | null =>
  dropped < 0.03 ? null : dropped > 0.3 ? { name: "framing", status: "review", note: `The painter drew scenery with it (${Math.round(dropped * 100)}% of the cut-out); that was removed, check nothing of it was lost` } : { name: "framing", status: "pass", note: `Scenery the painter drew around it (${Math.round(dropped * 100)}%) was removed` };

/** Palette distance (0–441) past which a reused character's new painting is flagged as possibly someone else. */
const IDENTITY_DRIFT = 60;
export const r2 = (v: number) => +v.toFixed(2);

/** Ambient effects drawn by the engine, looping with the scene: stars and birds go to `sky`, the rest to `fx`. */
export function ambientLayers(ambient: LayeredPlan["ambient"], W: number, H: number, duration: number, propBoxes: Map<string, [number, number, number, number]>, sky: Layer[], fx: Layer[]) {
  for (const a of ambient) {
    const period = fitPeriod(AMBIENT_PERIOD[a.type], duration);
    const [x0, y0, x1, y1] = (a.box ?? (a.type === "stars" || a.type === "birds" ? [0, 0, 1, 0.45] : [0, 0, 1, 1])).map((v, i) => r2(v * (i % 2 ? H : W)));
    const id = (n: number = 1): string => (fx.concat(sky).some((l) => l.id === `${a.type}-${n}`) ? id(n + 1) : `${a.type}-${n}`);
    if (a.type === "steam") {
      const b = propBoxes.get(a.at!);
      // the steam rides on its cup, so it rises from it wherever the cup is carried
      if (b) fx.push({ id: id(), type: "steam", parent: a.at, params: { x: r2((b[0] + b[2]) / 2), y: r2(b[1] + (b[3] - b[1]) * 0.1), height: r2(Math.max(60, (b[3] - b[1]) * 1.6)), width: r2(Math.max(8, (b[2] - b[0]) * 0.18)), period } });
    } else if (a.type === "stars") sky.unshift({ id: id(), type: "stars", params: { x0, y0, x1, y1, period } });
    else if (a.type === "birds") sky.push({ id: id(), type: "birds", params: { y0, y1, period } });
    else if (a.type === "falling-leaves") fx.push({ id: id(), type: "falling-leaves", params: { x0, y0, x1, y1, period } });
    else fx.push({ id: id(), type: "rain", params: { x0, y0, x1, y1, intensity: 0.8 } });
  }
}

/**
 * What moving a piece uncovers: its pixels next to the body, filled from the body's own colors (a diffusion repaint
 * here keeps painting a new face behind the head). Returns the filled body and each piece's joint with it.
 */
export function fillBehind(src: Raster, rest: Mask, pieces: { id: string; mask: Mask }[], sw: number, sh: number) {
  let body = rest, bodyR = src, hidden = 0, filled = 0;
  const joints = new Map<string, [number, number] | null>();
  for (const p of pieces) {
    const pb = maskBox(p.mask, sw)!;
    const reach = Math.max(4, Math.round(Math.min(pb[2] - pb[0], pb[3] - pb[1]) * 0.25));
    joints.set(p.id, neckPoint(p.mask, rest, sw, sh, reach));
    const band = intersect(p.mask, grow(rest, sw, sh, reach));
    // fill from colors, not from the dark outline strokes around them (those smear into streaks); what colors alone
    // can't reach is filled from everything
    // the outline between the body and the part is passed through but not copied (and kept as drawn)
    const clean = withoutInk(bodyR, body);
    const across = union(band, intersect(subtract(body, clean), grow(band, sw, sh, 4)));
    const spread = smear(bodyR, across, clean);
    const got = intersect(band, spread.filled);
    const first = { r: paste(bodyR, spread.r, got), filled: got };
    const rest_ = subtract(band, first.filled);
    const second = count(rest_) ? smear(first.r, rest_, union(body, first.filled)) : null;
    const s = { r: second ? second.r : first.r, filled: second ? union(first.filled, second.filled) : first.filled };
    hidden += count(band);
    filled += count(s.filled);
    bodyR = s.r;
    body = union(body, s.filled);
  }
  return { body, bodyR, hidden, filled, joints };
}

/** Plans, paints, separates and rigs a layered scene. Throws (with a fix) on failure; the caller's scene is untouched until "done". */
export async function generateLayered(req: GenerateRequest, provider: Provider, tools: LayeredTools, emit: (e: LayeredEvent) => void, signal?: AbortSignal): Promise<SceneSpec> {
  // the scene's visual direction, for every painting below
  const paintPrompt = (subject: string) => paintTags(subject, req.style);
  const NEGATIVE = negativeFor(req.style);
  const { painter } = tools;
  if (!painter.removeBackground || !painter.segment || !painter.inpaint) throw new AIError("The image painter can't separate layers", "Install the segmentation models: npm run setup:painter --layered");
  const [W, H] = ASPECT_SIZE[req.aspect];
  const duration = Math.min(30, Math.max(5, req.duration));
  const stage = (phase: LayeredStage, message: string) => {
    signal?.throwIfAborted();
    emit({ type: "status", phase, message });
  };
  const seed = Math.floor(Math.random() * 2 ** 31);

  // 1. plan
  stage("plan", "Planning the layers and motions");
  // saved characters keep their identity: the planner reuses their id, the painter their look and seed
  const saved = Object.entries(req.characters ?? {});
  const known = saved.length ? `\nCharacters already designed (when one appears, reuse its id exactly; its look is fixed):\n${saved.map(([id, p]) => `- ${id}: ${p.look}`).join("\n")}` : "";
  const user = `Idea: ${req.prompt}\nDuration: ${duration} seconds (the video loops)\nAspect: ${req.aspect} (${W}x${H})${known}`;
  let plan: LayeredPlan | null = null;
  let feedback = "";
  let lastProblems: string[] = [];
  for (let i = 0; i < 3 && !plan; i++) {
    let tokens = 0;
    const text = await provider.generateJSON({ system: prompt("layered", { duration: String(duration) }), user: user + feedback, schema: planJsonSchema, signal, onToken: () => ++tokens % 20 === 0 && emit({ type: "token", phase: "plan", tokens }) });
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (e) {
      feedback = `\nYour last answer was not valid JSON (${(e as Error).message}). Answer with the JSON object only.`;
      continue;
    }
    const r = LayeredPlanSchema.safeParse(raw);
    const tidy = r.success ? tidyPlan(r.data) : null;
    const problems = tidy ? planProblems(tidy, duration) : r.error!.issues.map((x) => `${x.path.join(".")}: ${x.message}`);
    lastProblems = problems;
    if (tidy && !problems.length) plan = { ...tidy, beats: tidy.beats.filter((b) => b.at <= duration).sort((a, b) => a.at - b.at) };
    else feedback = `\nYour last plan had these problems; fix them:\n${problems.slice(0, 12).map((p) => `- ${p}`).join("\n")}`;
  }
  // say what was still wrong, so a person (or a bug report) can see why
  if (!plan) throw new AIError("The model didn't return a usable layer plan", `Try again, or describe the scene more simply. Last problems: ${lastProblems.slice(0, 3).join("; ") || "the answer wasn't valid JSON"}`);
  const meta: SceneSpec["meta"] = { title: plan.title, duration, fps: 30, width: W, height: H };
  emit({ type: "plan", plan, meta });
  await provider.unload?.(); // a 12 GB GPU can't hold the language model and the painter at once

  const assets: Record<string, Asset> = {};
  const tracks: SceneSpec["tracks"] = {};
  const actions: Action[] = [];
  const switches: Switch[] = [];
  // draw order: background, sky effects, props behind, characters, props in front, front effects
  const back: Layer[] = [], sky: Layer[] = [], behind: Layer[] = [], cast: Layer[] = [], front: Layer[] = [], fx: Layer[] = [];
  // every saved profile is carried over (with its reference painting) so later scenes can still use it
  const characters: Record<string, CharacterProfile> = {};
  for (const [id, p] of saved) {
    const ref = p.reference !== undefined ? req.assets?.[p.reference] : undefined;
    characters[id] = { ...p, reference: ref ? `${id}_reference` : undefined };
    if (ref) assets[`${id}_reference`] = { ...ref, kind: "source" };
  }
  const save = (id: string, r: Raster, a: Omit<Asset, "src" | "width" | "height">) => {
    assets[id] = { src: tools.store(tools.encode(r)), width: r.width, height: r.height, ...a };
    return assets[id].src;
  };
  const light = plan.lighting ? `, ${plan.lighting}` : "";
  const separate = [...plan.characters.map((c) => c.id), ...plan.props.map((p) => p.id)].join(", ");
  const needed = new Set([...plan.actions.flatMap((a) => (a.type === "look_at" ? [a.target] : [])), ...plan.characters.flatMap((c) => c.parts.flatMap((p) => (p.target ? [p.target] : []))), ...plan.ambient.flatMap((a) => (a.at ? [a.at] : []))]);

  // 2. background: the empty setting, with everything painted separately kept out
  stage("background", `Painting the empty ${plan.setting}`);
  const bgId = `${plan.setting}_background`;
  emit({ type: "asset", id: bgId, label: "Background", status: "running" });
  const [pw, ph] = PAINT_SIZE[req.aspect];
  // someone sits: the background must paint what they sit on, or they end up floating
  const seat = plan.characters.some((c) => SEATED.test(c.pose)) && !new RegExp(`\\b(${SEAT_WORDS.join("|")}|couch|seat)`, "i").test(plan.environment) ? ", an empty chair" : "";
  const bgPng = await painter.paint({ positive: paintPrompt(`no humans, scenery, ${plan.environment}${seat}${light}, detailed background, depth of field, atmospheric perspective, cinematic lighting`), negative: `${NEGATIVE}, ${NO_PEOPLE}, ${separate}`, width: pw, height: ph, seed, signal });
  const bg = await tools.decode(bgPng);
  const k = Math.max(W / bg.width, H / bg.height); // cover the frame without stretching
  back.push({ id: bgId, type: "image", params: { asset: bgId, x: r2((W - bg.width * k) / 2), y: r2((H - bg.height * k) / 2), w: r2(bg.width * k), h: r2(bg.height * k) } });
  emit({ type: "asset", id: bgId, label: "Background", status: "done", src: save(bgId, bg, { kind: "image" }) });

  // the surfaces things rest on in the background, found once when first needed (in background pixels)
  let ground: Mask | null = null;
  const bgAt = { x: (W - bg.width * k) / 2, y: (H - bg.height * k) / 2 };
  /**
   * Where something planned to rest at scene height `bottom` (x0..x1 wide, `tall` high) actually meets a surface: the
   * median top edge of the floor, sill or ground found under it, searched from a little above its planned bottom to a
   * little below. Null when there is no clear surface there; the planned place is kept.
   */
  const standOn = async (x0: number, x1: number, bottom: number, tall: number): Promise<number | null> => {
    if (!ground) {
      ground = new Uint8Array(bg.width * bg.height);
      for (const what of ["floor", "windowsill", "ground"]) ground = union(ground, maskFrom(await tools.decode(await painter.segment!(bgPng, what, signal)), bg.width, bg.height));
    }
    const g = ground, bw = bg.width, bh = bg.height;
    const py = (y: number) => Math.round((y - bgAt.y) / k);
    const from = Math.max(1, py(bottom - tall * 0.3)), to = Math.min(bh - 1, py(bottom + H * 0.15));
    const edges: number[] = [];
    let cols = 0;
    for (let sx = x0; sx <= x1; sx += Math.max(1, (x1 - x0) / 40)) {
      const x = Math.round((sx - bgAt.x) / k);
      if (x < 0 || x >= bw) continue;
      cols++;
      for (let y = from; y <= to; y++)
        if (g[y * bw + x] >= 128 && g[(y - 1) * bw + x] < 128) {
          edges.push(y);
          break;
        }
    }
    if (!cols || edges.length < cols * 0.3) return null;
    edges.sort((a, b) => a - b);
    return r2(bgAt.y + edges[edges.length >> 1] * k);
  };

  // the seats in the background (chairs, benches, …), found once when a seated character first needs one (scene px)
  let seats: [number, number, number, number][] | null = null;
  /**
   * The seat a character planned at x0..x1 (scene px) sits on: the one whose centre is nearest the box's centre, within a
   * box width of it. Null when the background has none there; the caller keeps the floor placement and flags it.
   */
  const seatFor = async (x0: number, x1: number): Promise<[number, number, number, number] | null> => {
    if (!seats) {
      let m: Mask = new Uint8Array(bg.width * bg.height);
      for (const what of SEAT_WORDS) m = union(m, maskFrom(await tools.decode(await painter.segment!(bgPng, what, signal)), bg.width, bg.height));
      seats = islandBoxes(m, bg.width, bg.width * bg.height * 0.002).map(([a, b, c, d]) => [bgAt.x + a * k, bgAt.y + b * k, bgAt.x + c * k, bgAt.y + d * k]);
    }
    const mid = (x0 + x1) / 2;
    const near = seats.filter((s) => Math.abs((s[0] + s[2]) / 2 - mid) <= x1 - x0).sort((a, b) => Math.abs((a[0] + a[2]) / 2 - mid) - Math.abs((b[0] + b[2]) / 2 - mid));
    return near[0] ?? null;
  };

  /**
   * Paints a picture and checks that what was asked for is in it (SAM finds `noun`); a miss is repainted once with
   * another seed, then fails with the subject named. The anime checkpoint sometimes paints something else entirely.
   */
  const paintChecked = async (noun: string, args: Omit<Parameters<Painter["paint"]>[0], "seed" | "signal">, base = seed + noun.length) => {
    for (let attempt = 0; ; attempt++) {
      const used = base + 7919 * attempt;
      const png = await painter.paint({ ...args, seed: used, signal });
      const img = await tools.decode(png);
      const found = maskFrom(await tools.decode(await painter.segment!(png, noun, signal)), img.width, img.height);
      if (count(found) >= img.width * img.height * 0.005) return { png, img, seed: used, found };
      if (attempt) throw new AIError(`The painter didn't paint a ${noun} (tried twice)`, "Try again, or describe it more simply.");
    }
  };

  /**
   * Cuts a part out of `r` with mask `m` (cleaned, cropped, checked), stores it, and returns its image layer placed by
   * `at` (source px → scene). `from` and `mask` name the stored source and mask, so a person can re-cut it later.
   */
  const place = (id: string, r: Raster, m: Mask, s: number, at: (x: number, y: number) => [number, number], extra: Partial<Layer> & { from: string; mask: string; checks?: Check[]; opacity?: number; small?: boolean; patch?: boolean }) => {
    // face details are small on purpose: don't clean them as specks, don't flag their size. A face patch (a repainted
    // mouth) is a block of face by design, so it isn't held to the cut-out shape rules, and its edge is softened to blend.
    const small = extra.small || extra.patch;
    const cleanup = small ? { grow: 0, holes: 0, specks: 0, feather: extra.patch ? 2 : 0 } : defaultCleanup(r.width, r.height);
    const cut = recut(r, m, cleanup, label(id));
    if (small)
      cut.checks = cut.checks.map((c) =>
        c.name === "coverage" || (extra.patch && c.name === "cutout" && c.status === "fail" && !/empty/.test(c.note ?? "")) ? { ...c, status: "pass" as const, note: c.name === "cutout" ? "A face patch, blended at its edge" : c.note } : c,
      );
    const fail = cut.checks.find((c) => c.status === "fail");
    if (fail) throw new AIError(`The ${label(id)} didn't separate cleanly: ${fail.note}`, "Try again; the source painting and masks are kept.");
    const checks = [...cut.checks, ...(extra.checks ?? [])];
    const review = reviewOf(checks);
    const img = cut.image, box = cut.crop;
    const src = save(id, img, { kind: "image", from: extra.from, mask: extra.mask, crop: box, cleanup, checks, ...(review ? { review } : {}) });
    emit({ type: "asset", id, label: label(id), status: review ? "review" : "done", src, message: review });
    const [x, y] = at(box[0], box[1]);
    const { parent, pivot, opacity } = extra;
    return { id, type: "image", ...(parent && { parent }), ...(pivot && { pivot }), params: { asset: id, x, y, w: r2(img.width * s), h: r2(img.height * s), ...(opacity !== undefined ? { opacity } : {}) } } as Layer;
  };

  // 3–7. each character: paint, cut out, split off the head and moving parts, fill what they hid, rig
  for (const c of plan.characters) {
    // models list the head (or the body) as a moving part too: the head's motion goes to the head piece
    const headPart = c.parts.find((p) => p.id === "head");
    const parts = c.parts.filter((p, i) => p.id !== "head" && p.id !== "body" && c.parts.findIndex((q) => q.id === p.id) === i);
    const wakes = plan.actions.some((a) => a.type === "look_at" && a.who === c.id && a.wakes);
    const usesHead = !!headPart || wakes || c.idle.includes("bob") || c.idle.includes("blink") || plan.actions.some((a) => a.type === "look_at" && a.who === c.id) || parts.some((p) => p.motion === "swing" && !p.target);
    const profile = characters[c.id];
    const look = profile?.look ?? c.look;
    const boxW = (c.box[2] - c.box[0]) * W, boxH = (c.box[3] - c.box[1]) * H;
    const [cw, ch] = sizeFor(boxW / boxH);
    stage("character", `Painting the ${label(c.id)}`);
    emit({ type: "asset", id: `${c.id}_source`, label: `${label(c.id)} (reference)`, status: "running" });
    // a cut-out keeps the pose it was painted in, so a walker is painted walking (facing right; the engine mirrors it)
    const walks = plan.actions.some((a) => a.type === "walk" && a.who === c.id);
    const pose = walks ? `${c.pose.replace(/[^,]*(sleep|lying|lies|asleep|nap|curled|sitting|eyes closed)[^,]*,?/gi, "")}, walking, side view, facing right` : c.pose;
    // animals need "no humans" or the checkpoint draws a girl
    const human = HUMAN.test(`${c.id} ${look}`);
    const { png: srcPng, img: src, seed: paintedWith, found: who } = await paintChecked(
      label(c.id),
      {
        positive: paintPrompt(`${human ? "solo" : "no humans, animal focus, solo"}, ${look}, ${pose}, full body, centered, ${WHITE_BG}${light}`),
        negative: `${NEGATIVE}, ${human ? "multiple people" : "1girl, 1boy, human"}, cropped, out of frame, ${NO_FRAME}, ${NO_SET}`,
        width: cw,
        height: ch,
      },
      profile?.seed,
    );
    emit({ type: "asset", id: `${c.id}_source`, label: `${label(c.id)} (reference)`, status: "done", src: save(`${c.id}_source`, src, { kind: "source" }) });
    const sw = src.width, sh = src.height;
    const maskOf = async (text: string) => maskFrom(await tools.decode(await painter.segment!(srcPng, text, signal)), sw, sh);
    let eyesMask: Mask | null = null;
    const eyesOf = async () => (eyesMask ??= await maskOf("eyes"));

    stage("segment", `Separating the ${label(c.id)}'s parts`);
    const trimmed = subjectOnly(maskFrom(await tools.decode(await painter.removeBackground!(srcPng, signal)), sw, sh), who, sw, sh);
    const all = trimmed.mask;
    if (count(all) < sw * sh * 0.01) throw new AIError(`Couldn't find the ${label(c.id)} in their painting`, "Try again: a new painting usually separates cleanly.");
    save(`${c.id}_mask`, maskImage(all, sw, sh), { kind: "mask", from: `${c.id}_source` });
    // pieces cut off the body, head first; each later piece excludes the earlier ones
    const pieces: { id: string; mask: Mask; motion?: "swing" | "sway"; target?: string }[] = [];
    let rest = all;
    if (usesHead) {
      const head = intersect(await maskOf("head"), rest);
      if (count(head) < 50) throw new AIError(`Couldn't find the ${label(c.id)}'s head (the head mask is empty)`, "Try again, or describe the character with their face visible.");
      pieces.push({ id: `${c.id}_head`, mask: head, motion: headPart?.motion, target: headPart?.target });
      rest = subtract(rest, head);
    }
    for (const p of parts) {
      const m = intersect(await maskOf(p.find), rest);
      // a part that can't be found is left on the body; the rest of the rig still works
      // a sliver (a cuff when the arm was asked for) can't move without tearing away from the body: it stays on it
      if (count(m) < Math.max(50, count(rest) * 0.02)) {
        emit({ type: "asset", id: `${c.id}_${p.id}`, label: label(`${c.id}_${p.id}`), status: "skipped", message: `Couldn't separate a whole "${p.find}" (only a sliver of it was found); it stays still on the body` });
        continue;
      }
      pieces.push({ id: `${c.id}_${p.id}`, mask: m, motion: p.motion, target: p.target });
      rest = subtract(rest, m);
    }
    for (const p of pieces) save(`${p.id}_mask`, maskImage(p.mask, sw, sh), { kind: "mask", from: `${c.id}_source` });

    // what moving a piece uncovers: its pixels next to the body, filled from the body's own colors (a diffusion repaint
    // here keeps painting a new face behind the head)
    stage("reconstruct", `Filling in behind the ${label(c.id)}'s moving parts`);
    const { body, bodyR, hidden, filled, joints } = fillBehind(src, rest, pieces, sw, sh);
    // the reconstructed body (before cutting out) and its mask are kept: they are what the body is re-cut from
    save(`${c.id}_body_fill`, bodyR, { kind: "source", from: `${c.id}_source` });
    save(`${c.id}_body_mask`, maskImage(body, sw, sh), { kind: "mask", from: `${c.id}_source` });
    // filling is a guess from nearby colors: a large fill, or one that couldn't reach every pixel, is for a person to check
    const reconstruction: Check = !hidden
      ? { name: "reconstruction", status: "pass", note: "Nothing is hidden behind its moving parts" }
      : filled < hidden
        ? { name: "reconstruction", status: "review", note: `${hidden - filled} px behind its moving parts couldn't be filled and will show through when they move` }
        : filled > count(body) * 0.03
          ? { name: "reconstruction", status: "review", note: `${filled} px behind its moving parts were filled from nearby colors; check them as the parts move` }
          : { name: "reconstruction", status: "pass", note: `${filled} px behind its moving parts were filled from nearby colors` };

    // eyes: an overlay with the other eye state (opened for waking up, closed for blinking)
    let eyes: Raster | null = null;
    const head = pieces.find((p) => p.id === `${c.id}_head`);
    const eyeState = wakes ? "awake" : c.idle.includes("blink") ? "blink" : null;
    if (head && eyeState) {
      const id = `${c.id}_head_${eyeState}`;
      emit({ type: "asset", id, label: label(id), status: "running" });
      const eyeMask = intersect(await eyesOf(), head.mask);
      if (count(eyeMask) >= 20) {
        const m = grow(eyeMask, sw, sh, Math.max(3, Math.round(sw * 0.012)));
        const words = wakes ? ["open eyes, awake, looking up", "closed eyes, sleeping"] : ["closed eyes, peaceful", "open eyes"];
        const out = await tools.decode(await painter.inpaint!({ image: srcPng, mask: tools.encode(maskImage(m, sw, sh)), positive: paintPrompt(`${words[0]}, ${look}`), negative: `${NEGATIVE}, ${words[1]}`, seed, denoise: 0.65, signal }));
        if (out.width === sw && out.height === sh) {
          eyes = paste(src, out, m);
          save(`${id}_fill`, eyes, { kind: "source", from: `${c.id}_source` });
        }
      }
      if (!eyes) emit({ type: "asset", id, label: label(id), status: "skipped", message: "Couldn't find the eyes; the head keeps its painted eyes" });
    }

    // irises: separated from the eye whites so the eyes can look somewhere without the head turning (for look_at)
    let headFill: Raster | null = null, irises: Mask | null = null;
    if (head && plan.actions.some((a) => a.type === "look_at" && a.who === c.id)) {
      const id = `${c.id}_irises`;
      const sep = separateIrises(src, intersect(await eyesOf(), head.mask), sw, sh);
      const f = sep && smear(src, sep.iris, sep.sclera);
      // the eye whites must cover where the irises were, or moving them would leave holes
      if (sep && f && count(f.filled) === count(sep.iris)) {
        headFill = f.r;
        irises = sep.iris;
        save(`${head.id}_fill`, headFill, { kind: "source", from: `${c.id}_source` });
        save(`${id}_mask`, maskImage(irises, sw, sh), { kind: "mask", from: `${c.id}_source` });
      } else emit({ type: "asset", id, label: label(id), status: "skipped", message: "No eye whites to move the irises within; only the head turns" });
    }

    // face slots: each expression the plan needs is painted as eye / mouth / brow overlays on the head
    const overlays: { id: string; r: Raster; mask: Mask }[] = [];
    if (head && c.expressions.length) {
      const wanted = new Map<FaceSlot, Set<string>>();
      for (const e of c.expressions)
        for (const k of ["eyes", "mouth", "brows"] as const) {
          const o: string = EXPRESSIONS[e][k];
          if (o !== BASE_OPTION[k]) wanted.set(k, (wanted.get(k) ?? new Set()).add(o));
        }
      for (const [kind, options] of wanted) {
        const region = intersect(kind === "eyes" ? await eyesOf() : await maskOf(SLOT_FIND[kind]), head.mask);
        if (count(region) < 12) {
          emit({ type: "asset", id: `${c.id}_${kind}`, label: label(`${c.id}_${kind}`), status: "skipped", message: `Couldn't find the ${SLOT_FIND[kind]}; expressions keep the painted ${SLOT_FIND[kind]}` });
          continue;
        }
        const m = intersect(grow(region, sw, sh, Math.max(3, Math.round(sw * 0.01))), head.mask);
        const sw_: Switch = { id: `${c.id}_${kind}`, kind, character: c.id, options: { [BASE_OPTION[kind]]: null }, keys: [[0, BASE_OPTION[kind]]], fade: 0.08 };
        for (const o of options) {
          const id = `${c.id}_${kind}_${o}`;
          emit({ type: "asset", id, label: label(id), status: "running" });
          const [pos, neg] = SLOT_WORDS[`${kind}:${o}`];
          const out = await tools.decode(await painter.inpaint!({ image: srcPng, mask: tools.encode(maskImage(m, sw, sh)), positive: paintPrompt(`${pos}, ${look}`), negative: `${NEGATIVE}, ${neg}`, seed, denoise: 0.65, signal }));
          if (out.width !== sw || out.height !== sh) {
            emit({ type: "asset", id, label: label(id), status: "skipped", message: "The painter returned another size; the painted face is kept" });
            continue;
          }
          const r = paste(src, out, m);
          save(`${id}_fill`, r, { kind: "source", from: `${c.id}_source` });
          save(`${id}_mask`, maskImage(m, sw, sh), { kind: "mask", from: `${c.id}_source` });
          overlays.push({ id, r, mask: m });
          sw_.options[o] = id;
        }
        if (Object.keys(sw_.options).length > 1) switches.push(sw_);
      }
    }

    // place: fit the whole character into its box (bottom-centred), in scene units
    stage("rig", `Rigging the ${label(c.id)}`);
    const cb = maskBox(all, sw)!;
    const s = Math.min(boxW / (cb[2] - cb[0]), boxH / (cb[3] - cb[1]));
    // feet on the painted floor, sill or ground under the planned box, when one is there (the planner can't see the
    // painting, so its boxes float or sink a little)
    // a seated one goes on its seat instead: centred on it, feet where the seat meets the floor (its bottom edge)
    const sits = SEATED.test(c.pose) && !walks;
    const seatBox = sits ? await seatFor(c.box[0] * W, c.box[2] * W) : null;
    const floor = seatBox ? seatBox[3] : await standOn(c.box[0] * W, c.box[2] * W, c.box[3] * H, boxH);
    const cx = seatBox ? (seatBox[0] + seatBox[2]) / 2 : c.box[0] * W + boxW / 2;
    const ox = cx - ((cb[0] + cb[2]) / 2) * s, oy = (floor ?? c.box[3] * H) - cb[3] * s;
    const seated: Check | null = sits ? (seatBox ? { name: "seat", status: "pass", note: "Placed on the seat painted in the background" } : { name: "seat", status: "review", note: `Sits, but no ${SEAT_WORDS.join(", ")} was found in the background near its box; check it isn't floating` }) : null;
    const at = (x: number, y: number): [number, number] => [r2(ox + x * s), r2(oy + y * s)];
    const feet = at((cb[0] + cb[2]) / 2, cb[3]);

    // identity: a reused character is compared with its saved colors; a new one gets a profile made from this painting
    const colors = palette(crop(cutout(src, all), cb));
    let identity: Check;
    if (profile) {
      const drift = paletteDrift(Object.values(profile.palette), colors);
      identity = drift > IDENTITY_DRIFT ? { name: "identity", status: "review", note: `Its colors differ from the saved ${label(c.id)} profile (distance ${Math.round(drift)}); check it is the same character` } : { name: "identity", status: "pass", note: `Matches the saved ${label(c.id)} profile` };
    } else {
      const hb = head && maskBox(head.mask, sw);
      characters[c.id] = {
        name: label(c.id),
        look,
        reference: `${c.id}_reference`,
        palette: Object.fromEntries(colors.map((h, i) => [`c${i + 1}`, h])),
        proportions: { aspect: r2((cb[2] - cb[0]) / (cb[3] - cb[1])), ...(hb ? { head: r2((hb[3] - hb[1]) / (cb[3] - cb[1])) } : {}) },
        ...(walks ? { facing: "right" as const } : {}),
        seed: paintedWith,
      };
      assets[`${c.id}_reference`] = { ...assets[`${c.id}_source`] };
      identity = { name: "identity", status: "pass", note: `Saved as the ${label(c.id)} profile` };
    }

    // a soft shadow under the feet keeps the character standing on the ground as it moves
    cast.push({ id: c.id, type: "group", params: {}, pivot: feet, shadow: { amount: 0.45, size: 1 } });
    // breathing grows the body from where it rests
    cast.push(place(`${c.id}_body`, bodyR, body, s, at, { parent: c.id, pivot: feet, from: `${c.id}_body_fill`, mask: `${c.id}_body_mask`, checks: [reconstruction, identity, ...(sceneryCheck(trimmed.dropped) ? [sceneryCheck(trimmed.dropped)!] : []), ...(seated ? [seated] : [])] }));
    for (const p of pieces) {
      const joint = joints.get(p.id);
      const pb = maskBox(p.mask, sw)!;
      const jointCheck: Check = joint ? { name: "joint", status: "pass", note: "Its pivot is where it meets the body" } : { name: "joint", status: "review", note: "It doesn't touch the body, so its pivot is a guess; drag it into place" };
      const lifted = p.id === head?.id && headFill;
      cast.push(place(p.id, lifted ? headFill! : src, p.mask, s, at, { parent: `${c.id}_body`, pivot: at(...(joint ?? [(pb[0] + pb[2]) / 2, pb[3]])), from: lifted ? `${p.id}_fill` : `${c.id}_source`, mask: `${p.id}_mask`, checks: [jointCheck] }));
      // a swing reaches toward its target (by default the character's own head: sipping); with nothing to reach for it sways
      const reach = p.target ?? `${c.id}_head`;
      if (p.motion === "swing" && reach !== p.id) actions.push({ id: `${p.id}_swings`, type: "swing", part: p.id, target: reach, start: 0, ease: "inOut", amount: 1 });
      else if (p.motion) actions.push({ id: `${p.id}_sways`, type: "sway", part: p.id, start: 0, ease: "inOut", amount: 2 });
    }
    if (head && irises)
      cast.push(place(`${c.id}_irises`, src, irises, s, at, { parent: head.id, from: `${c.id}_source`, mask: `${c.id}_irises_mask`, small: true, checks: [{ name: "reconstruction", status: "pass", note: "The eye whites under them were filled from the whites around them" }] }));
    for (const o of overlays) cast.push(place(o.id, o.r, o.mask, s, at, { parent: head!.id, from: `${o.id}_fill`, mask: `${o.id}_mask`, patch: true }));
    if (eyes && head) cast.push(place(`${c.id}_head_${eyeState}`, eyes, head.mask, s, at, { parent: head.id, from: `${c.id}_head_${eyeState}_fill`, mask: `${head.id}_mask`, opacity: 0 }));
    // a walker that rests at the far end (naps on the sill) is shown there in a second painted pose
    const walk = plan.actions.find((a) => a.type === "walk" && a.who === c.id);
    const restPose = walk?.type === "walk" && walk.rest > 0 ? (walk.rest_pose ?? (/sleep|asleep|nap|curled|lying|lies/i.test(c.pose) ? c.pose : undefined)) : undefined;
    if (walk?.type === "walk" && restPose) {
      const id = `${c.id}_rest`;
      stage("character", `Painting the ${label(c.id)} resting`);
      emit({ type: "asset", id, label: label(id), status: "running" });
      const r = await paintChecked(
        label(c.id),
        { positive: paintPrompt(`${human ? "solo" : "no humans, animal focus, solo"}, ${look}, ${restPose}, full body, centered, ${WHITE_BG}${light}`), negative: `${NEGATIVE}, ${human ? "multiple people" : "1girl, 1boy, human"}, cropped, out of frame, ${NO_FRAME}, ${NO_SET}`, width: cw, height: ch },
        paintedWith,
      );
      const rw = r.img.width, rh = r.img.height;
      const rm = subjectOnly(maskFrom(await tools.decode(await painter.removeBackground!(r.png, signal)), rw, rh), r.found, rw, rh).mask;
      const rb = count(rm) >= rw * rh * 0.01 ? maskBox(rm, rw) : null;
      if (rb) {
        save(`${id}_source`, r.img, { kind: "source" });
        save(`${id}_mask`, maskImage(rm, rw, rh), { kind: "mask", from: `${id}_source` });
        // as much cat as the walker (a curled pose is wider and lower), feet where the walker's are; the walk carries it
        const rs = s * Math.sqrt(count(all) / count(rm));
        const rat = (x: number, y: number): [number, number] => [r2(feet[0] + (x - (rb[0] + rb[2]) / 2) * rs), r2(feet[1] + (y - rb[3]) * rs)];
        cast.push(place(id, r.img, rm, rs, rat, { parent: c.id, pivot: feet, from: `${id}_source`, mask: `${id}_mask` }));
        // out and back are the same length, so it arrives halfway through the travel time (rest clamped as the engine does)
        const rest = Math.min(walk.rest, (walk.end - walk.start) * 0.8), arrive = r2(walk.start + (walk.end - walk.start - rest) / 2);
        switches.push({ id: `${c.id}_pose`, kind: "view", character: c.id, options: { walking: `${c.id}_body`, resting: id }, keys: [[0, "walking"], [arrive, "resting"], [r2(arrive + rest), "walking"]], fade: 0.15 });
        actions.push({ id: `${id}_breathes`, type: "breathe", part: id, start: 0, ease: "inOut", amount: 1 });
      } else emit({ type: "asset", id, label: label(id), status: "skipped", message: "The resting pose didn't separate cleanly; it rests in its walking pose" });
    }
    if (c.idle.includes("breathe")) actions.push({ id: `${c.id}_breathes`, type: "breathe", part: `${c.id}_body`, start: 0, ease: "inOut", amount: 1 });
    if (c.idle.includes("bob") && head) actions.push({ id: `${c.id}_bobs`, type: "bob", part: head.id, start: 0, ease: "inOut", amount: 1 });
    if (eyes && eyeState === "blink") actions.push({ id: `${c.id}_blinks`, type: "blink", part: `${c.id}_head_blink`, start: 0, ease: "linear", amount: 1 });
  }

  // props: painted alone on a plain background, cut out, fitted into their box
  const propBoxes = new Map<string, [number, number, number, number]>();
  for (const p of plan.props) {
    stage("props", `Painting the ${label(p.id)}`);
    emit({ type: "asset", id: p.id, label: label(p.id), status: "running" });
    try {
      const { png, img: src, found } = await paintChecked(label(p.id), { positive: paintPrompt(`no humans, ${p.look}, single object, centered, ${LIGHT_THING.test(p.look) ? GREY_BG : WHITE_BG}${light}`), negative: `${NEGATIVE}, ${NO_PEOPLE}, ${NO_FRAME}`, width: 1024, height: 1024 });
      const trimmed = subjectOnly(maskFrom(await tools.decode(await painter.removeBackground!(png, signal)), src.width, src.height), found, src.width, src.height);
      const m = trimmed.mask;
      const b = maskBox(m, src.width);
      if (!b) throw new AIError(`The ${label(p.id)} didn't separate cleanly: the mask is empty`, "Try again.");
      save(`${p.id}_source`, src, { kind: "source" });
      save(`${p.id}_mask`, maskImage(m, src.width, src.height), { kind: "mask", from: `${p.id}_source` });
      const bw = (p.box[2] - p.box[0]) * W, bh = (p.box[3] - p.box[1]) * H;
      const s = Math.min(bw / (b[2] - b[0]), bh / (b[3] - b[1]));
      const x0 = p.box[0] * W + (bw - (b[2] - b[0]) * s) / 2, y0 = p.box[1] * H + (bh - (b[3] - b[1]) * s) / 2;
      const at = (x: number, y: number): [number, number] => [r2(x0 + (x - b[0]) * s), r2(y0 + (y - b[1]) * s)];
      const w = (b[2] - b[0]) * s, h = (b[3] - b[1]) * s;
      // swaying things rock about where they hang or stand: the top for hanging things, otherwise the bottom
      const pivot: [number, number] = [r2(x0 + w / 2), r2(/hang|lantern|chime|lamp/i.test(p.look) ? y0 : y0 + h)];
      const scenery = sceneryCheck(trimmed.dropped);
      const layer = place(p.id, src, m, s, at, { from: `${p.id}_source`, mask: `${p.id}_mask`, ...(p.motion === "sway" ? { pivot } : {}), ...(scenery ? { checks: [scenery] } : {}) });
      (p.front ? front : p.motion === "drift" ? sky : behind).push(layer);
      propBoxes.set(p.id, [x0, y0, x0 + w, y0 + h]);
      if (p.motion !== "none") actions.push({ id: `${p.id}_${p.motion === "sway" ? "sways" : "drifts"}`, type: p.motion, part: p.id, start: 0, ease: "inOut", amount: 1 });
    } catch (e) {
      if (signal?.aborted || needed.has(p.id)) throw e;
      // a decorative prop can go; the scene still works without it
      emit({ type: "asset", id: p.id, label: label(p.id), status: "skipped", message: (e as Error).message });
    }
  }

  // a prop where a reaching part is (a mug in the hand that lifts it) is held: it rides on that part
  const box = (l: Layer): [number, number, number, number] | null => {
    const q = l.params as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
    return [q.x ?? 0, q.y ?? 0, q.w, q.h].every((v) => typeof v === "number") ? [q.x as number, q.y as number, (q.x as number) + (q.w as number), (q.y as number) + (q.h as number)] : null;
  };
  for (const prop of [...behind, ...front]) {
    const pb = box(prop);
    if (!pb || prop.parent !== undefined) continue;
    for (const a of actions.filter((x) => x.type === "swing")) {
      const part = cast.find((l) => l.id === a.part), qb = part && box(part);
      if (!qb) continue;
      const ix = Math.max(0, Math.min(pb[2], qb[2]) - Math.max(pb[0], qb[0])), iy = Math.max(0, Math.min(pb[3], qb[3]) - Math.max(pb[1], qb[1]));
      if (ix * iy < (pb[2] - pb[0]) * (pb[3] - pb[1]) * 0.2) continue;
      prop.parent = a.part;
      // a held thing doesn't sway on its own
      for (let i = actions.length - 1; i >= 0; i--) if (actions[i].part === prop.id && actions[i].type !== "swing") actions.splice(i, 1);
      break;
    }
  }

  // ambient effects: drawn by the engine, looping with the scene
  ambientLayers(plan.ambient, W, H, duration, propBoxes, sky, fx);

  // timed actions → keyframes
  stage("animate", "Turning the motions into keyframes");
  // planes of the shot (camera parallax, fog and depth of field): the setting and sky far, the props behind and the
  // characters in the middle, what is in front of them near; rig parts inherit their character's plane
  const plane = (list: Layer[], p: NonNullable<Layer["plane"]>) => list.map((l) => (l.parent === undefined ? { ...l, plane: p } : l));
  const layers = [...plane(back, "background"), ...plane(sky, "background"), ...plane(behind, "midground"), ...plane(cast, "midground"), ...plane(front, "foreground"), ...plane(fx, "foreground")];
  for (const a of plan.actions) {
    if (a.type === "expression") continue; // keyed on the face switches below
    if (a.type === "walk") {
      actions.push({ id: `${a.who}_walks`, type: "path", part: a.who, start: a.start, end: a.end, ease: "inOut", amount: 1, points: a.path.map(([x, y]) => [r2(x * W), r2(y * H)]), ...(a.rest > 0 ? { rest: Math.min(a.rest, (a.end - a.start) * 0.8) } : {}) });
      continue;
    }
    const target = layers.some((l) => l.id === a.target) ? a.target : `${a.target}_head`;
    if (a.wakes && layers.some((l) => l.id === `${a.who}_head_awake`)) {
      tracks[`${a.who}_eyes_open`] = { keys: [[a.start, 0], [Math.min(duration, a.start + 0.3), 1]], ease: "linear" };
      const awake = layers.find((l) => l.id === `${a.who}_head_awake`)!;
      awake.params = { ...awake.params, opacity: `@${a.who}_eyes_open` };
    }
    actions.push({ id: `${a.who}_looks_at_${a.target}`, type: "look_at", part: `${a.who}_head`, target, start: a.start, end: Math.min(a.end, a.start + MAX_TURN_SECONDS), ease: "inOut", amount: 1 });
    // the eyes lead: they reach the target quickly, the head follows
    if (layers.some((l) => l.id === `${a.who}_irises`))
      actions.push({ id: `${a.who}_gazes_at_${a.target}`, type: "gaze", part: `${a.who}_irises`, target, start: a.start, end: Math.min(a.end, a.start + 0.3), ease: "out", amount: 1 });
  }
  // a render of another shape (a vertical cut of a wide scene) stays centred on the first character
  const lead = plan.characters[0] && layers.find((l) => l.id === plan.characters[0].id);
  const camera = lead?.pivot ? { camera: { zoom: 1, parallax: 0, focus: [lead.pivot[0], r2(lead.pivot[1] - ((plan.characters[0].box[3] - plan.characters[0].box[1]) * H) / 2)] as [number, number] } } : {};
  let scene = { version: 1, meta, palette: {}, tracks, layers, overlays: [], beats: plan.beats, assets, actions, ...camera, ...(Object.keys(characters).length ? { characters } : {}), ...(switches.length ? { switches } : {}) } as SceneSpec;
  for (const a of plan.actions) if (a.type === "expression") scene = applyExpression(scene, a.who, a.expression as Expression, a.start).spec;
  const draft = validateScene(scene);
  if (!draft.ok) throw new Error(`Layered scene failed validation: ${draft.errors.join("; ")}`);

  stage("validate", "Checking layers, masks and references");
  const final = validateScene(compileActions(draft.spec));
  if (!final.ok) throw new Error(`Layered scene failed validation: ${final.errors.join("; ")}`);
  for (const pr of poseProblems(final.spec)) {
    const a = final.spec.assets?.[String(final.spec.layers.find((l) => l.id === pr.layer)?.params.asset)];
    if (!a) continue;
    const checks = [...(a.checks ?? []), { name: "turn" as const, status: "review" as const, note: pr.message }];
    final.spec.assets![String(final.spec.layers.find((l) => l.id === pr.layer)!.params.asset)] = { ...a, checks, review: reviewOf(checks) };
  }
  emit({ type: "done", spec: final.spec, repairs: 0 });
  return final.spec;
}
