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
  }),
  draw(ctx, p, t, env) {
    const len = p.count / p.fps;
    const loops = env.spec.meta.duration > len + 1e-3;
    const local = loops ? t % len : Math.min(t, len - 1e-6);
    const frame = (s: number) => getImage(frameUrl(p.frames, Math.min(p.count - 1, Math.max(0, Math.floor(s * p.fps)))));
    const a = frame(local);
    if (!a) {
      ctx.fillStyle = "#15121c";
      ctx.fillRect(0, 0, env.width, env.height);
      return;
    }
    cover(ctx, a, env.width, env.height);
    // near the end of the clip, fade in its beginning so the loop has no jump
    const x = Math.min(p.crossfade, len / 2);
    if (loops && x > 0 && local > len - x) {
      const b = frame(local - (len - x));
      if (b) cover(ctx, b, env.width, env.height, (local - (len - x)) / x);
    }
  },
});
