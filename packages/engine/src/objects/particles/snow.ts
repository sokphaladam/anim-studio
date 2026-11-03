import { rng } from "../../rng";
import { defineObject, z, num, color, withAlpha, mod, TAU } from "../common";

export const snow = defineObject({
  type: "snow",
  category: "particles",
  description: "Falling snowflakes that drift side to side in the box x0..x1, y0..y1 (default whole frame); intensity 0..2 scales how many; every flake repeats exactly every `period` seconds (use a divisor of the scene length to loop).",
  params: z.object({
    x0: num.default(0),
    y0: num.default(0),
    x1: num.default(1280),
    y1: num.default(720),
    intensity: num.default(1),
    size: num.default(3),
    color: color.default("#f4f7ff"),
    period: z.number().positive().default(6),
    seed: z.number().int().default(17),
  }),
  draw(ctx, p, t) {
    const w = p.x1 - p.x0, h = p.y1 - p.y0;
    if (w <= 0 || h <= 0 || p.intensity <= 0) return;
    const r = rng(p.seed);
    // whole falls and sways per period, so every flake is back where it started at t + period
    const all = Array.from({ length: 300 }, () => ({ x: r(), y: r(), falls: 1 + Math.floor(r() * 2), sways: 1 + Math.floor(r() * 3), ph: r(), depth: r() }));
    const n = Math.min(all.length, Math.round(120 * p.intensity));
    const m = p.size * 4, H = h + 2 * m;
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x0, p.y0, w, h); ctx.clip();
    for (let i = 0; i < n; i++) {
      const f = all[i];
      const u = t / p.period;
      const y = p.y0 - m + mod(f.y * H + f.falls * H * u, H);
      const x = p.x0 + f.x * w + Math.sin(TAU * (f.sways * u + f.ph)) * (6 + 14 * f.depth);
      ctx.fillStyle = withAlpha(p.color, 0.45 + 0.55 * f.depth);
      ctx.beginPath(); ctx.arc(x, y, p.size * (0.5 + 0.7 * f.depth), 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
});
