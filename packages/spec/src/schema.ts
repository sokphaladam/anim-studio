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
