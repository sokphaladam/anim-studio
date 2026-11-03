import { z } from "zod";

const TRACK_REF = /^@[A-Za-z_][\w-]*$/;
const PALETTE_REF = /^\$[A-Za-z_][\w-]*$/;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Casts keep the runtime ZodString (so JSON schema export works) while giving TS a template-literal type.
export const trackRef = z
  .string()
  .regex(TRACK_REF, "Expected an @track reference like \"@wind\"") as unknown as z.ZodType<`@${string}`>;
export const paletteRef = z
  .string()
  .regex(PALETTE_REF, "Expected a $palette reference like \"$fox\"") as unknown as z.ZodType<`$${string}`>;
export const hex = z.string().regex(HEX, "Expected a hex color like \"#e9773c\"");

/** A number or an "@track" reference. */
export const num = z.union([z.number(), trackRef]);
/** A hex color or a "$palette" reference. */
export const color = z.union([hex, paletteRef]);

export const EaseSchema = z.enum(["linear", "inOut", "in", "out", "step"]);

export const TrackSchema = z
  .object({
    keys: z.array(z.tuple([z.number().min(0), z.number()])).min(1),
    ease: EaseSchema.default("inOut"),
    /** Repeat forever: time is taken modulo the last key's time, so the keys are one cycle. */
    loop: z.boolean().optional(),
  })
  .refine((t) => t.keys.every((k, i) => i === 0 || k[0] >= t.keys[i - 1][0]), "TrackSchema keys must be sorted by time");

export const TransformSchema = z.object({
  x: num.default(0),
  y: num.default(0),
  rotation: num.default(0),
  scale: num.default(1),
});

const Point = z.tuple([z.number(), z.number(), z.number().min(0).max(1)]);
export const StrokeSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("brush"), preset: z.string().default("ink"), color: hex, size: z.number().positive(), points: z.array(Point).min(1) }),
  z.object({ tool: z.literal("eraser"), size: z.number().positive(), points: z.array(Point).min(1) }),
  z.object({ tool: z.literal("fill"), at: z.tuple([z.number(), z.number()]), color: hex }),
]);
export const DrawingFrameSchema = z.object({ start: z.number().min(0), strokes: z.array(StrokeSchema) });

export const LayerSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  transform: TransformSchema.optional(),
  frames: z.array(DrawingFrameSchema).optional(),
  /** Rig parent (another layer's id): this layer's transform applies inside the parent's. Draw order stays the layers order. */
  parent: z.string().min(1).optional(),
  /** Point this layer rotates and scales about, in its own coordinates (scene units before its transform). Default: the center of what it draws. */
  pivot: z.tuple([z.number(), z.number()]).optional(),
});

/** A stored image. The bytes live in the image store (src); the scene only refers to them. */
export const AssetSchema = z.object({
  src: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** image: shown by an image layer · source: original generated artwork, kept for retries · mask: a derived segmentation mask. */
  kind: z.enum(["image", "source", "mask"]).default("image"),
  /** The asset this one was derived from. */
  from: z.string().optional(),
  /** Why a person should check it (an uncertain mask, pivot or fill). */
  review: z.string().optional(),
});

/**
 * What a semantic action can do to its part. One-shot: look_at (turn toward target and hold), path (travel through
 * points and back). Loops for the whole scene: breathe, bob (nod to music), blink (show an eyes-closed overlay),
 * sway (rock about the pivot), drift (glide sideways and back), swing (reach toward target and back, e.g. sipping).
 */
export const ACTION_TYPES = ["look_at", "path", "breathe", "bob", "blink", "sway", "drift", "swing"] as const;
/** flip: 1 mirrors the part left-right about its pivot (a walker turning around), 0 leaves it as painted. */
export const ACTION_CHANNELS = ["x", "y", "rotation", "scale", "opacity", "flip"] as const;
const LOOPS = new Set(["breathe", "bob", "blink", "sway", "drift", "swing"]);
export const isLoopAction = (type: string) => LOOPS.has(type);

/**
 * A semantic action. It is compiled into one track per channel it moves (`tracks`) before playback; the renderer adds
 * those values on top of the part's own transform, so actions never overwrite hand-made keys.
 */
export const ActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ACTION_TYPES),
  /** Layer that moves (a rigged part, a group or a prop). */
  part: z.string().min(1),
  /** Layer it turns or reaches toward (look_at, swing). */
  target: z.string().min(1).optional(),
  /** One-shot actions: when they run. Loops run the whole scene. */
  start: z.number().min(0).default(0),
  end: z.number().positive().optional(),
  /** look_at: hold the final pose until this time, then return; default: hold to the end. */
  hold: z.number().positive().optional(),
  ease: EaseSchema.default("inOut"),
  /** Strength: 1 = the natural amount. */
  amount: z.number().positive().max(5).default(1),
  /** Loops: seconds per cycle, rounded so a whole number of cycles fits the scene (seamless looping). */
  period: z.number().positive().optional(),
  /** path: where the part's pivot travels, in scene coordinates; the first point is where it rests. */
  points: z.array(z.tuple([z.number(), z.number()])).min(2).optional(),
  /** Filled in by compiling: channel → track name. */
  tracks: z.partialRecord(z.enum(ACTION_CHANNELS), z.string()).optional(),
});

export const OverlaySchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const BeatSchema = z.object({ at: z.number().min(0), label: z.string().min(1), note: z.string().optional() });

export const MetaSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  /** Legacy: the art tradition older scenes were made in. Kept so they still load; nothing reads it. */
  style: z.string().optional(),
  duration: z.number().positive().max(60),
  fps: z.union([z.literal(12), z.literal(24), z.literal(30)]).default(30),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const CameraSchema = z.object({ zoom: num.default(1), x: num.optional(), y: num.optional() });

/** Every "$name" / "@name" string inside a value, with its JSON path. */
export function collectRefs(value: unknown, path: (string | number)[] = [], out: { ref: string; path: (string | number)[] }[] = []) {
  if (typeof value === "string" && (TRACK_REF.test(value) || PALETTE_REF.test(value))) out.push({ ref: value, path });
  else if (Array.isArray(value)) value.forEach((v, i) => collectRefs(v, [...path, i], out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collectRefs(v, [...path, k], out);
  return out;
}

export const SceneSpecSchema = z
  .object({
    version: z.literal(1),
    meta: MetaSchema,
    palette: z.record(z.string(), hex).default({}),
    tracks: z.record(z.string(), TrackSchema).default({}),
    camera: CameraSchema.optional(),
    layers: z.array(LayerSchema),
    overlays: z.array(OverlaySchema).default([]),
    beats: z.array(BeatSchema).default([]),
    assets: z.record(z.string(), AssetSchema).optional(),
    actions: z.array(ActionSchema).optional(),
  })
  .superRefine((s, ctx) => {
    const dur = s.meta.duration;
    for (const [name, tr] of Object.entries(s.tracks))
      tr.keys.forEach((k, i) => {
        if (k[0] > dur) ctx.addIssue({ code: "custom", path: ["tracks", name, "keys", i, 0], message: `Key time ${k[0]}s is past the ${dur}s duration` });
      });
    s.beats.forEach((b, i) => {
      if (b.at > dur) ctx.addIssue({ code: "custom", path: ["beats", i, "at"], message: `BeatSchema at ${b.at}s is past the ${dur}s duration` });
    });
    const seen = new Set<string>();
    s.layers.forEach((l, i) => {
      if (seen.has(l.id)) ctx.addIssue({ code: "custom", path: ["layers", i, "id"], message: `Duplicate layer id "${l.id}"` });
      seen.add(l.id);
    });
    const assets = s.assets ?? {};
    const parentOf = new Map(s.layers.map((l) => [l.id, l.parent]));
    s.layers.forEach((l, i) => {
      if (l.parent !== undefined && !seen.has(l.parent)) ctx.addIssue({ code: "custom", path: ["layers", i, "parent"], message: `Unknown parent layer "${l.parent}"` });
      // walk up from each layer: coming back to it means a cycle
      for (let p = l.parent, n = 0; p !== undefined && n <= s.layers.length; p = parentOf.get(p), n++)
        if (p === l.id) {
          ctx.addIssue({ code: "custom", path: ["layers", i, "parent"], message: `Layer "${l.id}" is its own ancestor (circular parents)` });
          break;
        }
      if (l.type === "image" && !(typeof l.params.asset === "string" && l.params.asset in assets))
        ctx.addIssue({ code: "custom", path: ["layers", i, "params", "asset"], message: `Unknown asset "${String(l.params.asset)}". Known assets: ${Object.keys(assets).join(", ") || "none"}` });
    });
    for (const [id, a] of Object.entries(assets))
      if (a.from !== undefined && !(a.from in assets)) ctx.addIssue({ code: "custom", path: ["assets", id, "from"], message: `Unknown source asset "${a.from}"` });
    const actionIds = new Set<string>();
    s.actions?.forEach((a, i) => {
      const at = (k: string, message: string) => ctx.addIssue({ code: "custom", path: ["actions", i, k], message });
      if (actionIds.has(a.id)) at("id", `Duplicate action id "${a.id}"`);
      actionIds.add(a.id);
      if (!seen.has(a.part)) at("part", `Unknown layer "${a.part}"`);
      const aims = a.type === "look_at" || a.type === "swing";
      if (aims && a.target === undefined) at("target", `A ${a.type} needs a target layer`);
      if (a.target !== undefined && !seen.has(a.target)) at("target", `Unknown target layer "${a.target}"`);
      if (a.target === a.part) at("target", "A part can't aim at itself");
      if (a.type === "look_at" && a.end === undefined) at("end", "A look_at needs an end time");
      if (a.type === "path" && !a.points) at("points", "A path needs at least 2 points");
      if (a.end !== undefined && a.end <= a.start) at("end", `End ${a.end}s must be after start ${a.start}s`);
      if (a.end !== undefined && a.end > dur) at("end", `End ${a.end}s is past the ${dur}s duration`);
      if (a.start > dur) at("start", `Start ${a.start}s is past the ${dur}s duration`);
      if (a.hold !== undefined && (a.hold < (a.end ?? dur) || a.hold > dur)) at("hold", `Hold ${a.hold}s must be between the end (${a.end}s) and the duration (${dur}s)`);
      for (const [ch, name] of Object.entries(a.tracks ?? {})) if (!(name in s.tracks)) at("tracks", `Unknown ${ch} track "${name}"`);
    });
    for (const { ref, path } of collectRefs({ camera: s.camera, layers: s.layers, overlays: s.overlays })) {
      const name = ref.slice(1);
      if (ref[0] === "@" && !(name in s.tracks))
        ctx.addIssue({ code: "custom", path, message: `Unknown track "${ref}". Known tracks: ${Object.keys(s.tracks).join(", ") || "none"}` });
      if (ref[0] === "$" && !(name in s.palette))
        ctx.addIssue({ code: "custom", path, message: `Unknown palette color "${ref}". Known colors: ${Object.keys(s.palette).join(", ") || "none"}` });
    }
  });

/** Readable "path: message" lines for a Zod error. */
export function formatIssues(error: z.ZodError, prefix: (string | number)[] = []): string[] {
  return error.issues.map((i) => {
    const p = [...prefix, ...i.path].map((s) => (typeof s === "number" ? `[${s}]` : `.${String(s)}`)).join("").replace(/^\./, "");
    return `${p || "(root)"}: ${i.message}`;
  });
}
