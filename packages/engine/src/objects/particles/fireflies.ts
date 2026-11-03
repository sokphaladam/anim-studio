import { rng } from "../../rng";
import { defineObject, z, num, color, withAlpha, TAU } from "../common";

export const fireflies = defineObject({
  type: "fireflies",
  category: "particles",
  description: "Glowing fireflies wandering and pulsing in the box x0..x1, y0..y1 (transparent: draw over a dusk or night scene); repeats exactly every `period` seconds.",
  params: z.object({
    x0: num.default(0),
    y0: num.default(360),
    x1: num.default(1280),
    y1: num.default(720),
    count: z.number().int().min(1).max(120).default(24),
    size: num.default(3),
    color: color.default("#e9ff8a"),
    period: z.number().positive().default(6),
    seed: z.number().int().default(23),
  }),
  draw(ctx, p, t) {
    const r = rng(p.seed);
    const w = p.x1 - p.x0, h = p.y1 - p.y0;
    const u = t / p.period;
    for (let i = 0; i < p.count; i++) {
      // whole cycles per period on every path and pulse, so the swarm loops exactly
      const f = { x: r(), y: r(), kx: 1 + Math.floor(r() * 2), ky: 1 + Math.floor(r() * 3), kp: 1 + Math.floor(r() * 3), a: r(), b: r(), c: r() };
      const x = p.x0 + w * (0.08 + 0.84 * f.x) + Math.sin(TAU * (f.kx * u + f.a)) * w * 0.06;
      const y = p.y0 + h * (0.1 + 0.8 * f.y) + Math.sin(TAU * (f.ky * u + f.b)) * h * 0.08;
      const glow = Math.max(0, Math.sin(TAU * (f.kp * u + f.c)));
      if (glow < 0.02) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, p.size * 5);
      g.addColorStop(0, withAlpha(p.color, 0.8 * glow));
      g.addColorStop(1, withAlpha(p.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, p.size * 5, 0, TAU); ctx.fill();
      ctx.fillStyle = withAlpha(p.color, glow);
      ctx.beginPath(); ctx.arc(x, y, p.size, 0, TAU); ctx.fill();
    }
  },
});
