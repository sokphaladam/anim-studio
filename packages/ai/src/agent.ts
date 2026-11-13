// Image-first layered animation, run as an agent: paint the whole scene once, look at it, decide what moves, check each
// decision against the picture (the segmenter must find it), feed misses back, then cut the movers out over a repainted
// clean background and rig them. Unlike generateLayered, nothing is painted apart, so every layer matches the picture.
import { compileActions, validateScene } from "@anim/engine";
import type { Action, Asset, Layer, SceneSpec } from "@anim/spec";
import { z } from "zod";
import { ASPECT_SIZE, negativeFor, PAINT_SIZE, paintingPrompts, paintPrompt, type GenerateRequest } from "./generate";
import { extractJson } from "./json";
import { AMBIENT, ambientLayers, fillBehind, IDLE, label, r2, type LayeredEvent, type LayeredStage, type LayeredTools } from "./layered";
import { count, defaultCleanup, grow, intersect, maskBox, maskFrom, maskImage, paste, recut, reviewOf, subtract, union, type Check, type Mask } from "./masks";
import { prompt } from "./prompts";
import { AIError, type Provider } from "./types";

const Slug = z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use a lowercase word like "girl"');
const Frac = z.number().min(0).max(1);

export const SceneReadSchema = z.object({
  title: z.string().min(1),
  mood: z.string().default(""),
  beats: z.array(z.object({ at: z.number().min(0), label: z.string().min(1) })).min(1),
  environment: z.string().min(3),
  objects: z
    .array(
      z.object({
        id: Slug,
        find: z.string().min(2),
        kind: z.enum(["character", "prop"]),
        idle: z.array(z.enum(IDLE)).default([]),
        parts: z
          .array(
            z.object({
              id: Slug,
              find: z.string().min(2),
              motion: z.enum(["swing", "sway"]),
            }),
          )
          .max(2)
          .default([]),
        motion: z.enum(["none", "sway", "drift", "spin", "glow", "flicker"]).default("none"),
      }),
    )
    .min(1)
    .max(5),
  ambient: z
    .array(
      z.object({
        type: z.enum(AMBIENT),
        box: z.tuple([Frac, Frac, Frac, Frac]).optional(),
        at: Slug.optional(),
      }),
    )
    .max(3)
    .default([]),
});
export type SceneRead = z.output<typeof SceneReadSchema>;
const readJsonSchema = z.toJSONSchema(SceneReadSchema, { io: "input" });

/** Smallest share of the picture a found object must cover; less is a segmenter miss, not the thing. */
const MIN_SHARE = 0.003;
/** How many times the agent may look again after the segmenter couldn't find what it named. */
const LOOKS = 3;

/** Ids used twice, or steam at something that isn't a prop: what the schema can't see. */
export function readProblems(r: SceneRead): string[] {
  const ids = r.objects.map((o) => o.id);
  const out = ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `"${id}" is used twice; give every object its own id`);
  r.ambient.forEach((a, i) => a.type === "steam" && !r.objects.some((o) => o.id === a.at && o.kind === "prop") && out.push(`ambient[${i}]: steam needs "at": a prop id`));
  return out;
}

export async function generateAgent(req: GenerateRequest, provider: Provider, tools: LayeredTools, emit: (e: LayeredEvent) => void, signal?: AbortSignal): Promise<SceneSpec> {
  const { painter } = tools;
  if (!painter.segment || !painter.inpaint) throw new AIError("The image painter can't separate layers", "Install the segmentation models: npm run setup:painter --layered");
  const [W, H] = ASPECT_SIZE[req.aspect];
  const duration = Math.min(30, Math.max(5, req.duration));
  const NEGATIVE = negativeFor(req.style);
  const stage = (phase: LayeredStage, message: string) => {
    signal?.throwIfAborted();
    emit({ type: "status", phase, message });
  };
  const think = (text: string, details?: string[]) => emit({ type: "thought", text, ...(details && { details }) });
  const seed = Math.floor(Math.random() * 2 ** 31);
  const assets: Record<string, Asset> = {};
  const save = (id: string, r: Parameters<LayeredTools["encode"]>[0], a: Omit<Asset, "src" | "width" | "height">) => {
    assets[id] = {
      src: tools.store(tools.encode(r)),
      width: r.width,
      height: r.height,
      ...a,
    };
    return assets[id].src;
  };

  // 1. paint the whole picture, as the prompt says
  stage("background", "Painting the whole scene");
  emit({
    type: "asset",
    id: "scene_source",
    label: "Whole scene",
    status: "running",
  });
  const { paint } = paintingPrompts(req.prompt, req.style);
  const [pw, ph] = PAINT_SIZE[req.aspect];
  await provider.unload?.();
  const png = await painter.paint({
    ...paint,
    width: pw,
    height: ph,
    seed,
    signal,
  });
  const src = await tools.decode(png);
  const sw = src.width,
    sh = src.height;
  emit({
    type: "asset",
    id: "scene_source",
    label: "Whole scene",
    status: "done",
    src: save("scene_source", src, { kind: "source" }),
  });
  const found = new Map<string, Mask>();
  const find = async (text: string) => {
    if (!found.has(text)) found.set(text, maskFrom(await tools.decode(await painter.segment!(png, text, signal)), sw, sh));
    return found.get(text)!;
  };

  // 2. look → decide → check against the picture, until everything it names is really there
  const image = provider.vision ? `data:image/png;base64,${Buffer.from(png).toString("base64")}` : undefined;
  const user = `Idea: ${req.prompt}\nDuration: ${duration} seconds (the video loops)\n${image ? "The painting is attached." : "No image: decide from the idea, naming only what the idea says is there."}`;
  let read: SceneRead | null = null;
  let objects: SceneRead["objects"] = [];
  let feedback = "";
  for (let look = 1; look <= LOOKS; look++) {
    stage("plan", look === 1 ? "Looking at the painting: what should move?" : `Looking again (${look} of ${LOOKS}): fixing what wasn't found`);
    const text = await provider.generateJSON({
      system: prompt("agent", { duration: String(duration) }),
      user: user + feedback,
      schema: readJsonSchema,
      image,
      signal,
    });
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (e) {
      feedback = `\nYour last answer was not valid JSON (${(e as Error).message}). Answer with the JSON object only.`;
      continue;
    }
    const r = SceneReadSchema.safeParse(raw);
    const problems = r.success ? readProblems(r.data) : r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`);
    if (!r.success || problems.length) {
      feedback = `\nYour last answer had these problems; fix them:\n${problems
        .slice(0, 10)
        .map((p) => `- ${p}`)
        .join("\n")}`;
      continue;
    }
    await provider.unload?.();
    stage("segment", "Checking each object is really in the painting");
    read = r.data;
    objects = [];
    const missing: string[] = [];
    for (const o of read.objects)
      if (count(await find(o.find)) >= sw * sh * MIN_SHARE) objects.push(o);
      else missing.push(`${o.id} ("${o.find}")`);
    if (!missing.length) break;
    think(`Couldn't find ${missing.join(", ")} in the painting`, look < LOOKS ? ["Looking again"] : ["Leaving them out"]);
    feedback = `\nThe segmenter found nothing for these in the picture: ${missing.join(", ")}. Rename each to what is really visible, or drop it.`;
  }
  if (!read) throw new AIError("The model didn't return a usable reading of the painting", "Try again, or describe the scene more simply.");
  if (!objects.length) throw new AIError("Nothing the model named could be found in the painting", "Try again: a new painting with a clearer subject usually works.");
  think(`I see “${read.title}”: ${objects.map((o) => `${label(o.id)} (${o.kind === "character" ? o.idle.join(", ") || "still" : o.motion})`).join(", ")}`, [
    ...objects.flatMap((o) => o.parts.map((p) => `${label(o.id)}'s ${p.find}: ${p.motion}`)),
    ...read.ambient.map((a) => `effect: ${a.type}`),
  ]);

  // each pixel belongs to one object: the front-most (listed first) claims it
  const masks = new Map<string, Mask>();
  let claimed: Mask = new Uint8Array(sw * sh);
  for (const o of objects) {
    masks.set(o.id, subtract(await find(o.find), claimed));
    claimed = union(claimed, masks.get(o.id)!);
  }

  // 3. the clean background: what the objects covered, repainted, then checked that they are really gone
  stage("reconstruct", "Repainting the background behind the objects");
  emit({
    type: "asset",
    id: "background",
    label: "Background",
    status: "running",
  });
  const hole = grow(claimed, sw, sh, Math.max(6, Math.round(Math.max(sw, sh) * 0.02)));
  const holePng = tools.encode(maskImage(hole, sw, sh));
  // what the segmenter still finds of an object where it was, past this many pixels, means it wasn't painted over
  const limits = objects.map((o) => count(masks.get(o.id)!) * 0.3);
  let bg = src,
    left = objects.map((o) => label(o.id));
  for (let attempt = 0; attempt < 2 && left.length; attempt++) {
    const out = await tools.decode(
      await painter.inpaint!({
        image: png,
        mask: holePng,
        positive: paintPrompt(`no humans, scenery, empty, ${read.environment}`, req.style),
        negative: `${NEGATIVE}, ${objects.map((o) => o.find).join(", ")}, person, animal, character`,
        seed: seed + 101 * (attempt + 1),
        denoise: 1,
        signal,
      }),
    );
    if (out.width !== sw || out.height !== sh) break;
    bg = paste(src, out, hole);
    const plate = tools.encode(bg);
    left = [];
    for (const [i, o] of objects.entries()) {
      const seen = maskFrom(await tools.decode(await painter.segment!(plate, o.find, signal)), sw, sh);
      if (count(intersect(seen, masks.get(o.id)!)) > limits[i]) left.push(label(o.id));
    }
    if (left.length && !attempt) think(`The background still shows a ${left.join(", ")}`, ["Repainting it again"]);
  }
  const plateCheck: Check = left.length
    ? { name: "reconstruction", status: "review", note: `The repainted background still shows a ${left.join(", ")}; it may double up when they move` }
    : { name: "reconstruction", status: "pass", note: "The background behind the objects was repainted and checked empty" };
  const plateReview = reviewOf([plateCheck]);
  const k = Math.max(W / sw, H / sh),
    ox = (W - sw * k) / 2,
    oy = (H - sh * k) / 2;
  const at = (x: number, y: number): [number, number] => [r2(ox + x * k), r2(oy + y * k)];
  const bgSrc = save("background", bg, {
    kind: "image",
    checks: [plateCheck],
    ...(plateReview ? { review: plateReview } : {}),
  });
  emit({
    type: "asset",
    id: "background",
    label: "Background",
    status: plateReview ? "review" : "done",
    src: bgSrc,
    message: plateReview,
  });
  const back: Layer[] = [
    {
      id: "background",
      type: "image",
      plane: "background",
      params: {
        asset: "background",
        x: r2(ox),
        y: r2(oy),
        w: r2(sw * k),
        h: r2(sh * k),
      },
    },
  ];

  /** Cuts `m` out of `r`, stores it, and returns its image layer in place (the picture's own position). */
  const place = (
    id: string,
    r: typeof src,
    m: Mask,
    extra: {
      parent?: string;
      pivot?: [number, number];
      from: string;
      checks?: Check[];
      opacity?: number;
    },
  ) => {
    const cleanup = defaultCleanup(sw, sh);
    save(`${id}_mask`, maskImage(m, sw, sh), {
      kind: "mask",
      from: extra.from,
    });
    const cut = recut(r, m, cleanup, label(id));
    const fail = cut.checks.find((c) => c.status === "fail");
    if (fail) throw new AIError(`The ${label(id)} didn't separate cleanly: ${fail.note}`, "Try again; a new painting usually separates cleanly.");
    const checks = [...cut.checks, ...(extra.checks ?? [])];
    const review = reviewOf(checks);
    const s = save(id, cut.image, {
      kind: "image",
      from: extra.from,
      mask: `${id}_mask`,
      crop: cut.crop,
      cleanup,
      checks,
      ...(review ? { review } : {}),
    });
    emit({
      type: "asset",
      id,
      label: label(id),
      status: review ? "review" : "done",
      src: s,
      message: review,
    });
    const [x, y] = at(cut.crop[0], cut.crop[1]);
    return {
      id,
      type: "image",
      ...(extra.parent && { parent: extra.parent }),
      ...(extra.pivot && { pivot: extra.pivot }),
      params: {
        asset: id,
        x,
        y,
        w: r2(cut.image.width * k),
        h: r2(cut.image.height * k),
        ...(extra.opacity !== undefined ? { opacity: extra.opacity } : {}),
      },
    } as Layer;
  };

  // 4. rig: characters split into body, head and moving parts; props keep one layer and a pivot
  const actions: Action[] = [];
  const mid: Layer[] = [],
    sky: Layer[] = [],
    fx: Layer[] = [];
  const propBoxes = new Map<string, [number, number, number, number]>();
  for (const o of [...objects].reverse()) {
    const all = masks.get(o.id)!;
    const b = maskBox(all, sw)!;
    if (o.kind === "prop") {
      stage("props", `Cutting out the ${label(o.id)}`);
      // swaying things rock about where they hang or stand: the top for hanging things, otherwise the bottom;
      // spinning things turn about their middle
      const pivot =
        o.motion === "spin" ? at((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) : at((b[0] + b[2]) / 2, /lantern|chime|lamp|hang/i.test(o.find) ? b[1] : b[3]);
      const layer = place(o.id, src, all, {
        from: "scene_source",
        ...((o.motion === "sway" || o.motion === "spin") && { pivot }),
      });
      (o.motion === "drift" ? sky : mid).push({
        ...layer,
        plane: o.motion === "drift" ? "background" : "midground",
      });
      const [x0, y0] = at(b[0], b[1]),
        [x1, y1] = at(b[2], b[3]);
      propBoxes.set(o.id, [x0, y0, x1, y1]);
      if (o.motion !== "none")
        actions.push({
          id: `${o.id}_${o.motion}s`,
          type: o.motion,
          part: o.id,
          start: 0,
          ease: "inOut",
          amount: 1,
        });
      continue;
    }
    stage("rig", `Rigging the ${label(o.id)}`);
    const usesHead = o.idle.includes("bob") || o.idle.includes("blink") || o.parts.some((p) => p.motion === "swing");
    const pieces: { id: string; mask: Mask; motion?: "swing" | "sway" }[] = [];
    let rest = all;
    if (usesHead) {
      const head = intersect(await find(`${o.find} head`), rest);
      if (count(head) >= 50) {
        pieces.push({ id: `${o.id}_head`, mask: head });
        rest = subtract(rest, head);
      } else think(`Couldn't find the ${label(o.id)}'s head`, ["It nods and blinks as one piece"]);
    }
    for (const p of o.parts) {
      const m = intersect(await find(p.find), rest);
      if (count(m) < Math.max(50, count(rest) * 0.02)) {
        emit({
          type: "asset",
          id: `${o.id}_${p.id}`,
          label: label(`${o.id}_${p.id}`),
          status: "skipped",
          message: `Couldn't separate a whole "${p.find}"; it stays still on the body`,
        });
        continue;
      }
      pieces.push({ id: `${o.id}_${p.id}`, mask: m, motion: p.motion });
      rest = subtract(rest, m);
    }
    const { body, bodyR, joints } = fillBehind(src, rest, pieces, sw, sh);
    save(`${o.id}_body_fill`, bodyR, { kind: "source", from: "scene_source" });
    const feet = at((b[0] + b[2]) / 2, b[3]);
    mid.push({
      id: o.id,
      type: "group",
      plane: "midground",
      params: {},
      pivot: feet,
    });
    mid.push(
      place(`${o.id}_body`, bodyR, body, {
        parent: o.id,
        pivot: feet,
        from: `${o.id}_body_fill`,
        checks: [plateCheck],
      }),
    );
    const head = pieces.find((p) => p.id === `${o.id}_head`);
    for (const p of pieces) {
      const pb = maskBox(p.mask, sw)!;
      const joint = joints.get(p.id);
      mid.push(
        place(p.id, src, p.mask, {
          parent: `${o.id}_body`,
          pivot: at(...(joint ?? [(pb[0] + pb[2]) / 2, pb[3]])),
          from: "scene_source",
          checks: [
            joint
              ? {
                  name: "joint",
                  status: "pass",
                  note: "Its pivot is where it meets the body",
                }
              : {
                  name: "joint",
                  status: "review",
                  note: "It doesn't touch the body, so its pivot is a guess; drag it into place",
                },
          ],
        }),
      );
      if (p.motion === "swing" && head)
        actions.push({
          id: `${p.id}_swings`,
          type: "swing",
          part: p.id,
          target: head.id,
          start: 0,
          ease: "inOut",
          amount: 1,
        });
      else if (p.motion)
        actions.push({
          id: `${p.id}_sways`,
          type: "sway",
          part: p.id,
          start: 0,
          ease: "inOut",
          amount: 2,
        });
    }
    // blink: the head's eyes repainted closed, shown for a moment now and then
    if (head && o.idle.includes("blink")) {
      const eyes = intersect(await find(`${o.find} eyes`), head.mask);
      if (count(eyes) >= 20) {
        const m = grow(eyes, sw, sh, Math.max(3, Math.round(sw * 0.012)));
        const out = await tools.decode(
          await painter.inpaint!({
            image: png,
            mask: tools.encode(maskImage(m, sw, sh)),
            positive: paintPrompt(`closed eyes, peaceful, ${o.find}`, req.style),
            negative: `${NEGATIVE}, open eyes`,
            seed,
            denoise: 0.65,
            signal,
          }),
        );
        if (out.width === sw && out.height === sh) {
          const closed = paste(src, out, m);
          save(`${o.id}_head_blink_fill`, closed, {
            kind: "source",
            from: "scene_source",
          });
          mid.push(
            place(`${o.id}_head_blink`, closed, head.mask, {
              parent: head.id,
              from: `${o.id}_head_blink_fill`,
              opacity: 0,
            }),
          );
          actions.push({
            id: `${o.id}_blinks`,
            type: "blink",
            part: `${o.id}_head_blink`,
            start: 0,
            ease: "linear",
            amount: 1,
          });
        }
      } else think(`Couldn't find the ${label(o.id)}'s eyes`, ["No blink: draw closed eyes on a new layer to add one"]);
    }
    if (o.idle.includes("breathe"))
      actions.push({
        id: `${o.id}_breathes`,
        type: "breathe",
        part: `${o.id}_body`,
        start: 0,
        ease: "inOut",
        amount: 1,
      });
    if (o.idle.includes("bob") && head)
      actions.push({
        id: `${o.id}_bobs`,
        type: "bob",
        part: head.id,
        start: 0,
        ease: "inOut",
        amount: 1,
      });
  }
  ambientLayers(read.ambient, W, H, duration, propBoxes, sky, fx);

  // 5. compile and check
  stage("animate", "Turning the motions into keyframes");
  const layers = [
    ...back,
    ...sky.map((l) => (l.parent === undefined ? { ...l, plane: "background" as const } : l)),
    ...mid,
    ...fx.map((l) => (l.parent === undefined ? { ...l, plane: "foreground" as const } : l)),
  ];
  const scene = {
    version: 1,
    meta: { title: read.title, duration, fps: 30, width: W, height: H },
    palette: {},
    tracks: {},
    layers,
    overlays: [],
    beats: read.beats.filter((x) => x.at <= duration),
    assets,
    actions,
  } as SceneSpec;
  stage("validate", "Checking layers, masks and references");
  const valid = (v: ReturnType<typeof validateScene>) => {
    if (!v.ok) throw new Error(`Agent scene failed validation: ${v.errors.join("; ")}`);
    return v.spec;
  };
  const final = { spec: valid(validateScene(compileActions(valid(validateScene(scene))))) };
  emit({ type: "done", spec: final.spec, repairs: 0 });
  return final.spec;
}
