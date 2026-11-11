import { defineObject, z } from "../common";
import { frameUrl, getImage, type Bitmap } from "../../images";
import type { Ctx2D } from "../../registry";

function cover(ctx: Ctx2D, img: Bitmap, w: number, h: number, alpha = 1) {
  const k = Math.max(w / img.width, h / img.height);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img as CanvasImageSource, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
  ctx.globalAlpha = 1;
}

export const footage = defineObject({
  type: "footage",
  category: "backgrounds",
  description: "An animated clip (made by the video model, not by you) filling the frame, played frame by frame; longer scenes loop it with a short crossfade. Put fx after it.",
  params: z.object({
    /** Folder URL of the frames, ending in "/". */
    frames: z.string().min(1),
    count: z.number().int().min(1),
    fps: z.number().positive(),
    /** Seconds the end blends into the start when the clip loops. */
    crossfade: z.number().min(0).default(0.6),
    /** Scene second the clip starts at; before it the layer draws nothing. */
    start: z.number().min(0).default(0),
    /** Seconds cut from the clip's beginning and end. */
    trimIn: z.number().min(0).default(0),
    trimOut: z.number().min(0).default(0),
    /** Repeat to fill the scene; off plays once, then draws nothing (a placed cinematic shot). */
    loop: z.boolean().default(true),
    /** Drawings per second: each frame is held, as hand animation is (on twos/threes); 0 shows every frame. */
    hold: z.number().min(0).default(0),
    /** Loop forward then backward, so the end always meets the start (the video model's clips drift and never match). */
    pingpong: z.boolean().default(false),
    /** The cinematic shot this clip shows, so redoing that shot replaces it here too. */
    shot: z.string().optional(),
  }),
  draw(ctx, p, t, env) {
    // the part of the clip that plays, at least one frame however it is trimmed
    const len = Math.max(1 / p.fps, p.count / p.fps - p.trimIn - p.trimOut);
    const u = t - p.start;
    if (u < 0 || (!p.loop && u >= len)) return;
    const loops = p.loop && env.spec.meta.duration - p.start > len + 1e-3;
    const m = loops ? u % (p.pingpong ? 2 * len : len) : Math.min(u, len - 1e-6);
    const free = m >= len ? Math.max(0, 2 * len - m - 1e-6) : m;
    const local = p.hold ? Math.floor(free * p.hold) / p.hold : free;
    const frame = (s: number) => getImage(frameUrl(p.frames, Math.min(p.count - 1, Math.max(0, Math.floor((p.trimIn + s) * p.fps)))));
    const a = frame(local);
    if (!a) {
      ctx.fillStyle = "#15121c";
      ctx.fillRect(0, 0, env.width, env.height);
      return;
    }
    cover(ctx, a, env.width, env.height);
    // near the end of the clip, fade in its beginning so the loop has no jump
    const x = Math.min(p.crossfade, len / 2);
    if (loops && !p.pingpong && x > 0 && local > len - x) {
      const b = frame(local - (len - x));
      if (b) cover(ctx, b, env.width, env.height, (local - (len - x)) / x);
    }
  },
});
