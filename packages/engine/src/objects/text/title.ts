import { defineObject, z, num, color } from "../common";

export const title = defineObject({
  type: "title",
  category: "text",
  description: "Lower-left italic serif title with a smaller subtitle that slides in slightly as it fades in.",
  params: z.object({
    text: z.string(),
    subtitle: z.string().default(""),
    opacity: num.default(1),
    x: num.default(64),
    /** Baseline distance from the bottom edge. */
    bottom: num.default(52),
    color: color.default("#fbeedd"),
  }),
  draw(ctx, p, _t, env) {
    const a = p.opacity;
    if (a <= 0) return;
    const y = env.height - p.bottom;
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.font = 'italic 400 46px "Fraunces Variable", Fraunces, Georgia, serif';
    ctx.fillText(p.text, p.x + (1 - a) * 12, y);
    if (p.subtitle) {
      ctx.globalAlpha = a * 0.75;
      ctx.font = "400 19px Figtree, system-ui, sans-serif";
      ctx.fillText(p.subtitle, p.x + 2 + (1 - a) * 12, y + 30);
    }
  },
});
