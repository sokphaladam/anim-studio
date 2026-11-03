import { rng } from "../../rng";
import { defineObject, z, num, color, withAlpha, mod, TAU } from "../common";

export const clouds = defineObject({
  type: "clouds",
  category: "backgrounds",
  description: "Soft clouds drifting sideways through the band y0..y1 (transparent: draw over a sky); each crosses the frame a whole number of times every `period` seconds, so it loops; direction 1 = right, -1 = left.",
  params: z.object({
    y0: num.default(40),
    y1: num.default(260),
    width: num.default(1280),
    count: z.number().int().min(1).max(20).default(5),
    size: num.default(90),
    color: color.default("#ffffff"),
    opacity: num.default(0.8),
    direction: z.number().default(1),
    period: z.number().positive().default(12),
    seed: z.number().int().default(31),
  }),
  draw(ctx, p, t) {
    const r = rng(p.seed);
    const span = p.width + p.size * 4;
    for (let i = 0; i < p.count; i++) {
      const c = { x: r(), y: r(), s: 0.6 + r() * 0.8, puffs: 3 + Math.floor(r() * 3), laps: 1 + Math.floor(r() * 2) };
      const x = mod(c.x * span + Math.sign(p.direction || 1) * c.laps * span * (t / p.period), span) - p.size * 2;
      const y = p.y0 + c.y * (p.y1 - p.y0);
      const s = p.size * c.s;
      ctx.fillStyle = withAlpha(p.color, p.opacity);
      ctx.beginPath();
      for (let k = 0; k < c.puffs; k++) {
        const px = x + (k - (c.puffs - 1) / 2) * s * 0.55;
        const pr = s * (0.32 + 0.18 * Math.sin((k / (c.puffs - 1)) * Math.PI));
        ctx.moveTo(px + pr, y);
        ctx.arc(px, y - pr * 0.3, pr, 0, TAU);
      }
      // flat base in the same path, so overlaps don't double the opacity
      ctx.rect(x - s * 0.7, y - s * 0.05, s * 1.4, s * 0.12);
      ctx.fill();
    }
  },
});
