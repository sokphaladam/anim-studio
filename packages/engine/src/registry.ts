import { z } from "zod";
import { SceneSpecSchema, formatIssues, type Resolved, type SceneSpec as Spec } from "@anim/spec";
import { integrate } from "./tracks";
import { resolve } from "./resolve";

export type Ctx2D = CanvasRenderingContext2D;
export type Category = "backgrounds" | "particles" | "props" | "characters" | "fx" | "text" | "drawing";

export interface Env {
  spec: Spec;
  /** Logical scene size (meta.width × meta.height). */
  width: number;
  height: number;
  /** Integral from 0 to t of a raw num param: "@track" is integrated, a constant n gives n·t. */
  integrate(raw: unknown): number;
  /** Scratch space shared by layers within one frame (lantern → glow). Reset every render, so no state crosses frames. */
  shared: Record<string, unknown>;
  /** This object's params with defaults applied but references not yet resolved. */
  raw: Record<string, unknown>;
  /** Draws another registered object at its own origin (used by path-mover). */
  drawObject(type: string, params: Record<string, unknown>, overrides?: Record<string, unknown>): void;
}

export interface ObjectDef<S extends z.ZodObject = z.ZodObject> {
  type: string;
  category: Category;
  /** One sentence; goes straight into the AI catalog. */
  description: string;
  params: S;
  draw(ctx: Ctx2D, p: Resolved<z.output<S>>, t: number, env: Env): void;
}

const registry = new Map<string, ObjectDef>();

export function defineObject<S extends z.ZodObject>(def: ObjectDef<S>): ObjectDef<S> {
  registry.set(def.type, def);
  return def;
}

export const getObject = (type: string) => registry.get(type);
export const objectTypes = () => [...registry.keys()];

const parsedCache = new WeakMap<object, Record<string, unknown>>();
/** Applies param defaults once per params object (cached by identity, so it is cheap per frame). */
export function parseParams(def: ObjectDef, params: Record<string, unknown>): Record<string, unknown> {
  let p = parsedCache.get(params);
  if (!p) {
    p = def.params.parse(params) as Record<string, unknown>;
    parsedCache.set(params, p);
  }
  return p;
}

export function makeEnv(spec: Spec, t: number, shared: Record<string, unknown>, ctx: Ctx2D): Omit<Env, "raw"> {
  const env: Omit<Env, "raw"> = {
    spec,
    width: spec.meta.width,
    height: spec.meta.height,
    shared,
    integrate(raw) {
      if (typeof raw === "number") return raw * t;
      if (typeof raw === "string" && raw[0] === "@") {
        const tr = spec.tracks[raw.slice(1)];
        return tr ? integrate(tr, t) : 0;
      }
      return 0;
    },
    drawObject(type, params, overrides) {
      const def = registry.get(type);
      if (!def) return;
      drawWith(ctx, def, { ...parseParams(def, params), ...overrides }, t, env);
    },
  };
  return env;
}

export function drawWith(ctx: Ctx2D, def: ObjectDef, raw: Record<string, unknown>, t: number, env: Omit<Env, "raw">) {
  ctx.save();
  def.draw(ctx, resolve(raw, env.spec, t) as Resolved<z.output<z.ZodObject>>, t, { ...env, raw });
  ctx.restore();
}

/** Compact text list of every object type, its params and defaults. The AI prompts are built from this. */
export function catalog(): string {
  return [...registry.values()]
    .map((d) => {
      const params = Object.entries(d.params.shape)
        .map(([k, s]) => {
          const r = (s as z.ZodType).safeParse(undefined);
          return r.success && r.data !== undefined ? `${k}=${JSON.stringify(r.data)}` : k;
        })
        .join(", ");
      return `- ${d.type} (${d.category}): ${d.description} Params: ${params || "none"}`;
    })
    .join("\n");
}

export type ValidationResult = { ok: true; spec: Spec } | { ok: false; errors: string[] };

/** Full validation: scene shape, references, known object types and each object's own params. */
export function validateScene(input: unknown): ValidationResult {
  const r = SceneSpecSchema.safeParse(input);
  if (!r.success) return { ok: false, errors: formatIssues(r.error) };
  const errors: string[] = [];
  const check = (list: { type: string; params: Record<string, unknown> }[], key: "layers" | "overlays") =>
    list.forEach((l, i) => {
      const def = registry.get(l.type);
      if (!def) {
        errors.push(`${key}[${i}].type: Unknown object type "${l.type}". Use one of: ${objectTypes().join(", ")}`);
        return;
      }
      const p = def.params.strict().safeParse(l.params);
      if (!p.success) errors.push(...formatIssues(p.error, [key, i, "params"]));
      const frames = "frames" in l ? (l.frames as { start: number }[] | undefined) : undefined;
      if (frames && l.type !== "drawing") errors.push(`${key}[${i}].frames: Only drawing layers have frames`);
      frames?.forEach((f, j) => {
        if (j && f.start <= frames[j - 1].start) errors.push(`${key}[${i}].frames[${j}].start: Frames must be in time order with distinct starts`);
        if (f.start > r.data.meta.duration) errors.push(`${key}[${i}].frames[${j}].start: ${f.start}s is past the ${r.data.meta.duration}s duration`);
      });
    });
  check(r.data.layers, "layers");
  check(r.data.overlays, "overlays");
  return errors.length ? { ok: false, errors } : { ok: true, spec: r.data };
}

