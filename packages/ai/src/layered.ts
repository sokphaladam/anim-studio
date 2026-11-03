// Layered animation: the language model plans layers and motions, the image painter paints each layer, and the parts
// are cut out with real masks. The result is an ordinary editable scene of image layers rigged with parents and pivots,
// plus ambient effects, with every motion compiled to (mostly looping) keyframes before playback.
import { compileActions, fitPeriod, validateScene } from "@anim/engine";
import type { Action, Asset, Layer, SceneSpec } from "@anim/spec";
import { z } from "zod";
import { ASPECT_SIZE, LOOK, PAINT_SIZE, paintPrompt, type GenerateRequest } from "./generate";
import { extractJson } from "./json";
import { count, crop, cutout, defringe, grow, haloShare, peelPale, intersect, maskBox, maskFrom, maskImage, neckPoint, partProblems, paste, smear, subtract, touchesEdge, union, type Box, type Mask, type Raster } from "./masks";
import type { Painter } from "./painters/comfyui";
import { prompt } from "./prompts";
import { AIError, type Provider } from "./types";

const Slug = z.string().regex(/^[a-z][a-z0-9_]*$/, "Use a lowercase word like \"girl\"");
const Frac = z.number().min(0).max(1);
const PlaceBox = z.tuple([Frac, Frac, Frac, Frac]);
const IDLE = ["breathe", "bob", "blink"] as const;
const AMBIENT = ["stars", "falling-leaves", "birds", "steam", "rain"] as const;

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
        z.object({ type: z.literal("walk"), who: Slug, path: z.array(z.tuple([Frac, Frac])).min(2).max(6), start: z.number().min(0), end: z.number().positive() }),
      ]),
    )
    .max(4)
    .default([]),
});
export type LayeredPlan = z.output<typeof LayeredPlanSchema>;
const planJsonSchema = z.toJSONSchema(LayeredPlanSchema, { io: "input" });

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
    if (a.end <= a.start || a.end > duration) out.push(`actions[${i}]: start ${a.start}s and end ${a.end}s must satisfy 0 <= start < end <= ${duration}`);
  });
  return out;
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
  | { type: "done"; spec: SceneSpec; repairs: number };

const WHITE_BG = "simple background, white background";
// light things (clouds, steam, the moon) vanish on white, so they are painted on grey to be cut out
const GREY_BG = "simple background, grey background";
const LIGHT_THING = /cloud|moon|snow|smoke|steam|mist|ghost|white/i;
const NO_PEOPLE = "1girl, 1boy, person, people, human, face, animal, character";
// the anime checkpoint draws a picture-in-a-picture or a landscape when it isn't told not to
// the white outline: anime paintings on white often get a sticker border, which a cut-out then keeps as a halo
const NO_FRAME = "frame, border, picture frame, framed, card, scenery, landscape, horizon, white outline, sticker, die-cut";
const HUMAN = /\b(1?girl|1?boy|man|woman|person|kid|child|lady|guy|human|witch|student)s?\b/i;
/** SDXL sizes (~1 megapixel, multiples of 64); a character is painted at the one closest to its box's shape. */
const SDXL_SIZES: [number, number][] = [[1024, 1024], [1152, 896], [896, 1152], [1216, 832], [832, 1216], [1344, 768], [768, 1344]];
const sizeFor = (aspect: number) => SDXL_SIZES.reduce((b, s) => (Math.abs(Math.log(s[0] / s[1] / aspect)) < Math.abs(Math.log(b[0] / b[1] / aspect)) ? s : b));
/** Longest turn a look_at takes; models sometimes stretch it to the end of the scene, leaving no held pose. */
const MAX_TURN_SECONDS = 2;
/** Default ambient loop lengths (seconds), fitted to the scene so the video loops seamlessly. */
const AMBIENT_PERIOD = { stars: 6, "falling-leaves": 6, birds: 12, steam: 3, rain: 1 } as const;
const label = (id: string) => id.replace(/_/g, " ");
const r2 = (v: number) => +v.toFixed(2);

/** Plans, paints, separates and rigs a layered scene. Throws (with a fix) on failure; the caller's scene is untouched until "done". */
export async function generateLayered(req: GenerateRequest, provider: Provider, tools: LayeredTools, emit: (e: LayeredEvent) => void, signal?: AbortSignal): Promise<SceneSpec> {
  const { painter } = tools;
  if (!painter.removeBackground || !painter.segment || !painter.inpaint) throw new AIError("The image painter can't separate layers", "Install the segmentation models: pnpm setup:painter --layered");
  const [W, H] = ASPECT_SIZE[req.aspect];
  const duration = Math.min(30, Math.max(5, req.duration));
  const stage = (phase: LayeredStage, message: string) => {
    signal?.throwIfAborted();
    emit({ type: "status", phase, message });
  };
  const seed = Math.floor(Math.random() * 2 ** 31);

  // 1. plan
  stage("plan", "Planning the layers and motions");
  const user = `Idea: ${req.prompt}\nDuration: ${duration} seconds (the video loops)\nAspect: ${req.aspect} (${W}x${H})`;
  let plan: LayeredPlan | null = null;
  let feedback = "";
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
    const problems = r.success ? planProblems(r.data, duration) : r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`);
    if (r.success && !problems.length) plan = { ...r.data, beats: r.data.beats.filter((b) => b.at <= duration).sort((a, b) => a.at - b.at) };
    else feedback = `\nYour last plan had these problems; fix them:\n${problems.slice(0, 12).map((p) => `- ${p}`).join("\n")}`;
  }
  if (!plan) throw new AIError("The model didn't return a usable layer plan", "Try again, or describe the scene more simply.");
  const meta: SceneSpec["meta"] = { title: plan.title, duration, fps: 30, width: W, height: H };
  emit({ type: "plan", plan, meta });
  await provider.unload?.(); // a 12 GB GPU can't hold the language model and the painter at once

  const assets: Record<string, Asset> = {};
  const tracks: SceneSpec["tracks"] = {};
  const actions: Action[] = [];
  // draw order: background, sky effects, props behind, characters, props in front, front effects
  const back: Layer[] = [], sky: Layer[] = [], behind: Layer[] = [], cast: Layer[] = [], front: Layer[] = [], fx: Layer[] = [];
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
  const bg = await tools.decode(await painter.paint({ positive: paintPrompt(`no humans, scenery, ${plan.environment}${light}`), negative: `${LOOK.negative}, ${NO_PEOPLE}, ${separate}`, width: pw, height: ph, seed, signal }));
  const k = Math.max(W / bg.width, H / bg.height); // cover the frame without stretching
  back.push({ id: bgId, type: "image", params: { asset: bgId, x: r2((W - bg.width * k) / 2), y: r2((H - bg.height * k) / 2), w: r2(bg.width * k), h: r2(bg.height * k) } });
  emit({ type: "asset", id: bgId, label: "Background", status: "done", src: save(bgId, bg, { kind: "image" }) });

  /**
   * Paints a picture and checks that what was asked for is in it (SAM finds `noun`); a miss is repainted once with
   * another seed, then fails with the subject named. The anime checkpoint sometimes paints something else entirely.
   */
  const paintChecked = async (noun: string, args: Omit<Parameters<Painter["paint"]>[0], "seed" | "signal">) => {
    for (let attempt = 0; ; attempt++) {
      const png = await painter.paint({ ...args, seed: seed + 7919 * attempt + noun.length, signal });
      const img = await tools.decode(png);
      if (count(maskFrom(await tools.decode(await painter.segment!(png, noun, signal)), img.width, img.height)) >= img.width * img.height * 0.005) return { png, img };
      if (attempt) throw new AIError(`The painter didn't paint a ${noun} (tried twice)`, "Try again, or describe it more simply.");
    }
  };

  /** Crops, cleans and checks a cut-out, stores it, and returns its image layer placed by `at` (source px → scene). */
  const place = (id: string, r: Raster, box: Box, s: number, at: (x: number, y: number) => [number, number], extra: Partial<Layer> & { from: string; review?: string; opacity?: number }) => {
    const img = defringe(peelPale(crop(r, box)));
    const problems = partProblems(img, id);
    if (problems.length) throw new AIError(`The ${label(id)} didn't separate cleanly: ${problems[0].replace(/^[^:]+: /, "")}`, "Try again; the source painting and masks are kept.");
    const halo = haloShare(img);
    const review = extra.review ?? (halo > 0.25 ? `${Math.round(halo * 100)}% of its edge is a white halo` : undefined);
    const src = save(id, img, { kind: "image", from: extra.from, ...(review ? { review } : {}) });
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
    const boxW = (c.box[2] - c.box[0]) * W, boxH = (c.box[3] - c.box[1]) * H;
    const [cw, ch] = sizeFor(boxW / boxH);
    stage("character", `Painting the ${label(c.id)}`);
    emit({ type: "asset", id: `${c.id}_source`, label: `${label(c.id)} (reference)`, status: "running" });
    // a cut-out keeps the pose it was painted in, so a walker is painted walking (facing right; the engine mirrors it)
    const walks = plan.actions.some((a) => a.type === "walk" && a.who === c.id);
    const pose = walks ? `${c.pose.replace(/[^,]*(sleep|lying|lies|asleep|nap|curled|sitting|eyes closed)[^,]*,?/gi, "")}, walking, side view, facing right` : c.pose;
    // animals need "no humans" or the checkpoint draws a girl
    const human = HUMAN.test(`${c.id} ${c.look}`);
    const { png: srcPng, img: src } = await paintChecked(label(c.id), {
      positive: paintPrompt(`${human ? "solo" : "no humans, animal focus, solo"}, ${c.look}, ${pose}, full body, centered, ${WHITE_BG}${light}`),
      negative: `${LOOK.negative}, ${human ? "multiple people" : "1girl, 1boy, human"}, cropped, out of frame, ${NO_FRAME}`,
      width: cw,
      height: ch,
    });
    emit({ type: "asset", id: `${c.id}_source`, label: `${label(c.id)} (reference)`, status: "done", src: save(`${c.id}_source`, src, { kind: "source" }) });
    const sw = src.width, sh = src.height;
    const maskOf = async (text: string) => maskFrom(await tools.decode(await painter.segment!(srcPng, text, signal)), sw, sh);

    stage("segment", `Separating the ${label(c.id)}'s parts`);
    const all = maskFrom(await tools.decode(await painter.removeBackground!(srcPng, signal)), sw, sh);
    if (count(all) < sw * sh * 0.01) throw new AIError(`Couldn't find the ${label(c.id)} in their painting`, "Try again: a new painting usually separates cleanly.");
    save(`${c.id}_mask`, maskImage(all, sw, sh), { kind: "mask", from: `${c.id}_source` });
    const cutOff = touchesEdge(all, sw, sh) ? "It runs off the edge of its painting, so one side is cut straight; erase that side or regenerate" : undefined;
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
      if (count(m) < 50) {
        emit({ type: "asset", id: `${c.id}_${p.id}`, label: label(`${c.id}_${p.id}`), status: "skipped", message: `Couldn't find "${p.find}"; it stays still on the body` });
        continue;
      }
      pieces.push({ id: `${c.id}_${p.id}`, mask: m, motion: p.motion, target: p.target });
      rest = subtract(rest, m);
    }
    for (const p of pieces) save(`${p.id}_mask`, maskImage(p.mask, sw, sh), { kind: "mask", from: `${c.id}_source` });

    // what moving a piece uncovers: its pixels next to the body, filled from the body's own colors (a diffusion repaint
    // here keeps painting a new face behind the head)
    stage("reconstruct", `Filling in behind the ${label(c.id)}'s moving parts`);
    let body = rest, bodyR = src;
    const joints = new Map<string, [number, number] | null>();
    for (const p of pieces) {
      const pb = maskBox(p.mask, sw)!;
      const reach = Math.max(4, Math.round(Math.min(pb[2] - pb[0], pb[3] - pb[1]) * 0.25));
      joints.set(p.id, neckPoint(p.mask, rest, sw, sh, reach));
      const band = intersect(p.mask, grow(rest, sw, sh, reach));
      const s = smear(bodyR, band, body);
      bodyR = s.r;
      body = union(body, s.filled);
    }
    bodyR = cutout(bodyR, body);

    // eyes: an overlay with the other eye state (opened for waking up, closed for blinking)
    let eyes: Raster | null = null;
    const head = pieces.find((p) => p.id === `${c.id}_head`);
    const eyeState = wakes ? "awake" : c.idle.includes("blink") ? "blink" : null;
    if (head && eyeState) {
      const id = `${c.id}_head_${eyeState}`;
      emit({ type: "asset", id, label: label(id), status: "running" });
      const eyeMask = intersect(await maskOf("eyes"), head.mask);
      if (count(eyeMask) >= 20) {
        const m = grow(eyeMask, sw, sh, Math.max(3, Math.round(sw * 0.012)));
        const words = wakes ? ["open eyes, awake, looking up", "closed eyes, sleeping"] : ["closed eyes, peaceful", "open eyes"];
        const out = await tools.decode(await painter.inpaint!({ image: srcPng, mask: tools.encode(maskImage(m, sw, sh)), positive: paintPrompt(`${words[0]}, ${c.look}`), negative: `${LOOK.negative}, ${words[1]}`, seed, denoise: 0.65, signal }));
        if (out.width === sw && out.height === sh) eyes = cutout(paste(src, out, m), head.mask);
      }
      if (!eyes) emit({ type: "asset", id, label: label(id), status: "skipped", message: "Couldn't find the eyes; the head keeps its painted eyes" });
    }

    // place: fit the whole character into its box (bottom-centred), in scene units
    stage("rig", `Rigging the ${label(c.id)}`);
    const cb = maskBox(all, sw)!;
    const s = Math.min(boxW / (cb[2] - cb[0]), boxH / (cb[3] - cb[1]));
    const ox = c.box[0] * W + (boxW - (cb[2] - cb[0]) * s) / 2 - cb[0] * s, oy = c.box[3] * H - cb[3] * s;
    const at = (x: number, y: number): [number, number] => [r2(ox + x * s), r2(oy + y * s)];
    const feet = at((cb[0] + cb[2]) / 2, cb[3]);
    cast.push({ id: c.id, type: "group", params: {}, pivot: feet });
    // breathing grows the body from where it rests
    cast.push(place(`${c.id}_body`, bodyR, maskBox(body, sw)!, s, at, { parent: c.id, pivot: feet, from: `${c.id}_source`, review: cutOff }));
    for (const p of pieces) {
      const joint = joints.get(p.id);
      const pb = maskBox(p.mask, sw)!;
      const review = joint ? undefined : `It doesn't touch the body, so its pivot is a guess; drag it into place`;
      cast.push(place(p.id, cutout(src, p.mask), pb, s, at, { parent: `${c.id}_body`, pivot: at(...(joint ?? [(pb[0] + pb[2]) / 2, pb[3]])), from: `${c.id}_source`, review }));
      // a swing reaches toward its target (by default the character's own head: sipping); with nothing to reach for it sways
      const reach = p.target ?? `${c.id}_head`;
      if (p.motion === "swing" && reach !== p.id) actions.push({ id: `${p.id}_swings`, type: "swing", part: p.id, target: reach, start: 0, ease: "inOut", amount: 1 });
      else if (p.motion) actions.push({ id: `${p.id}_sways`, type: "sway", part: p.id, start: 0, ease: "inOut", amount: 2 });
    }
    if (eyes && head) cast.push(place(`${c.id}_head_${eyeState}`, eyes, maskBox(head.mask, sw)!, s, at, { parent: head.id, from: `${c.id}_source`, opacity: 0 }));
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
      const { png, img: src } = await paintChecked(label(p.id), { positive: paintPrompt(`no humans, ${p.look}, single object, centered, ${LIGHT_THING.test(p.look) ? GREY_BG : WHITE_BG}${light}`), negative: `${LOOK.negative}, ${NO_PEOPLE}, ${NO_FRAME}`, width: 1024, height: 1024 });
      const m = maskFrom(await tools.decode(await painter.removeBackground!(png, signal)), src.width, src.height);
      const b = maskBox(m, src.width);
      if (!b) throw new AIError(`The ${label(p.id)} didn't separate cleanly: the mask is empty`, "Try again.");
      save(`${p.id}_source`, src, { kind: "source" });
      const bw = (p.box[2] - p.box[0]) * W, bh = (p.box[3] - p.box[1]) * H;
      const s = Math.min(bw / (b[2] - b[0]), bh / (b[3] - b[1]));
      const x0 = p.box[0] * W + (bw - (b[2] - b[0]) * s) / 2, y0 = p.box[1] * H + (bh - (b[3] - b[1]) * s) / 2;
      const at = (x: number, y: number): [number, number] => [r2(x0 + (x - b[0]) * s), r2(y0 + (y - b[1]) * s)];
      const w = (b[2] - b[0]) * s, h = (b[3] - b[1]) * s;
      // swaying things rock about where they hang or stand: the top for hanging things, otherwise the bottom
      const pivot: [number, number] = [r2(x0 + w / 2), r2(/hang|lantern|chime|lamp/i.test(p.look) ? y0 : y0 + h)];
      const review = touchesEdge(m, src.width, src.height) ? "It runs off the edge of its painting, so one side is cut straight; erase that side or regenerate" : undefined;
      const layer = place(p.id, cutout(src, m), b, s, at, { from: `${p.id}_source`, review, ...(p.motion === "sway" ? { pivot } : {}) });
      (p.front ? front : p.motion === "drift" ? sky : behind).push(layer);
      propBoxes.set(p.id, [x0, y0, x0 + w, y0 + h]);
      if (p.motion !== "none") actions.push({ id: `${p.id}_${p.motion === "sway" ? "sways" : "drifts"}`, type: p.motion, part: p.id, start: 0, ease: "inOut", amount: 1 });
    } catch (e) {
      if (signal?.aborted || needed.has(p.id)) throw e;
      // a decorative prop can go; the scene still works without it
      emit({ type: "asset", id: p.id, label: label(p.id), status: "skipped", message: (e as Error).message });
    }
  }

  // ambient effects: drawn by the engine, looping with the scene
  for (const a of plan.ambient) {
    const period = fitPeriod(AMBIENT_PERIOD[a.type], duration);
    const [x0, y0, x1, y1] = (a.box ?? (a.type === "stars" || a.type === "birds" ? [0, 0, 1, 0.45] : [0, 0, 1, 1])).map((v, i) => r2(v * (i % 2 ? H : W)));
    const id = (n: number = 1): string => (fx.concat(sky).some((l) => l.id === `${a.type}-${n}`) ? id(n + 1) : `${a.type}-${n}`);
    if (a.type === "steam") {
      const b = propBoxes.get(a.at!);
      if (b) fx.push({ id: id(), type: "steam", params: { x: r2((b[0] + b[2]) / 2), y: r2(b[1] + (b[3] - b[1]) * 0.1), height: r2(Math.max(60, (b[3] - b[1]) * 1.6)), width: r2(Math.max(8, (b[2] - b[0]) * 0.18)), period } });
    } else if (a.type === "stars") sky.unshift({ id: id(), type: "stars", params: { x0, y0, x1, y1, period } });
    else if (a.type === "birds") sky.push({ id: id(), type: "birds", params: { y0, y1, period } });
    else if (a.type === "falling-leaves") fx.push({ id: id(), type: "falling-leaves", params: { x0, y0, x1, y1, period } });
    else fx.push({ id: id(), type: "rain", params: { x0, y0, x1, y1, intensity: 0.8 } });
  }

  // timed actions → keyframes
  stage("animate", "Turning the motions into keyframes");
  const layers = [...back, ...sky, ...behind, ...cast, ...front, ...fx];
  for (const a of plan.actions) {
    if (a.type === "walk") {
      actions.push({ id: `${a.who}_walks`, type: "path", part: a.who, start: a.start, end: a.end, ease: "inOut", amount: 1, points: a.path.map(([x, y]) => [r2(x * W), r2(y * H)]) });
      continue;
    }
    const target = layers.some((l) => l.id === a.target) ? a.target : `${a.target}_head`;
    if (a.wakes && layers.some((l) => l.id === `${a.who}_head_awake`)) {
      tracks[`${a.who}_eyes_open`] = { keys: [[a.start, 0], [Math.min(duration, a.start + 0.3), 1]], ease: "linear" };
      const awake = layers.find((l) => l.id === `${a.who}_head_awake`)!;
      awake.params = { ...awake.params, opacity: `@${a.who}_eyes_open` };
    }
    actions.push({ id: `${a.who}_looks_at_${a.target}`, type: "look_at", part: `${a.who}_head`, target, start: a.start, end: Math.min(a.end, a.start + MAX_TURN_SECONDS), ease: "inOut", amount: 1 });
  }
  const draft = validateScene({ version: 1, meta, palette: {}, tracks, layers, overlays: [], beats: plan.beats, assets, actions });
  if (!draft.ok) throw new Error(`Layered scene failed validation: ${draft.errors.join("; ")}`);

  stage("validate", "Checking layers, masks and references");
  const final = validateScene(compileActions(draft.spec));
  if (!final.ok) throw new Error(`Layered scene failed validation: ${final.errors.join("; ")}`);
  emit({ type: "done", spec: final.spec, repairs: 0 });
  return final.spec;
}
