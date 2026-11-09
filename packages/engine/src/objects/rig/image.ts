import { defineObject, z, num } from "../common";
import { getImage } from "../../images";

/** A stored RGBA image (spec.assets[asset]) drawn at x, y with size w × h in scene units. Generated character parts and props use it. */
export const image = defineObject({
  type: "image",
  category: "images",
  description: "A stored transparent image (a generated background, prop or character part), placed in scene units.",
  params: z.object({
    asset: z.string().min(1),
    x: num.default(0),
    y: num.default(0),
    w: z.number().positive(),
    h: z.number().positive(),
    opacity: num.default(1),
  }),
  draw(ctx, p, _t, env) {
    const a = env.spec.assets?.[p.asset];
    const img = a && getImage(a.src);
    // not loaded yet: draw nothing rather than a placeholder that would show through the parts above it
    if (!img || p.opacity <= 0) return;
    ctx.globalAlpha *= Math.min(1, p.opacity);
    ctx.drawImage(img as CanvasImageSource, p.x, p.y, p.w, p.h);
  },
});

/** Rig group: draws nothing; its transform moves every layer parented to it (a character's root). */
export const group = defineObject({
  type: "group",
  category: "groups",
  description: "A group of rigged parts; move the group to move them all.",
  params: z.object({}),
  draw() {},
});

/**
 * Rig bone: draws nothing. Its pivot is the joint; it points `length` scene units along `angle` (radians, 0 = right,
 * clockwise, in its own coordinates). Child bones and parts parented to it follow its rotation. `min`/`max` limit the
 * rotation (radians, relative to how it was drawn), for hand-set keys and IK alike.
 */
export const bone = defineObject({
  type: "bone",
  category: "groups",
  description: "A rig bone (joint at its pivot); rotate it to bend the parts and mesh attached to it.",
  params: z.object({
    length: z.number().positive(),
    angle: z.number().default(0),
    min: z.number().min(-Math.PI * 2).max(0).optional(),
    max: z.number().min(0).max(Math.PI * 2).optional(),
  }),
  draw() {},
});
