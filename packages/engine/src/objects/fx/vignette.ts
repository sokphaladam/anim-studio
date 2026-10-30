import { defineObject, z, num } from "../common";

export const vignette = defineObject({
  type: "vignette",
  category: "fx",
  description: "Darkens the frame edges to focus the eye on the center.",
  params: z.object({ strength: num.default(0.6) }),
  draw(ctx, p, _t, env) {
    const { width: W, height: H } = env;
    const d = Math.hypot(W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, d * 0.1907, W / 2, H / 2, d * 0.5584);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${p.strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  },
});
