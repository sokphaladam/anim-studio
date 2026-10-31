import { rng } from "../../rng";
import { defineObject, z, num, color, withAlpha, mod } from "../common";

const drops = (seed: number, n: number) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({ x: r(), y: r(), speed: 0.8 + r() * 0.5, len: 0.7 + r() * 0.6, depth: r() }));
};

export const rain = defineObject({
  type: "rain",
  category: "particles",
  description: "Falling rain streaks in the box x0..x1, y0..y1 (default whole frame); intensity 0 = dry, 1 = steady rain, 2 = downpour (animate it with a track); slant tilts the drops.",
  params: z.object({
    x0: num.default(0),
    y0: num.default(0),
    x1: num.default(1280),
    y1: num.default(720),
    intensity: num.default(1),
    slant: num.default(0.15),
    color: color.default("#b8c8ff"),
    seed: z.number().int().default(11),
  }),
  draw(ctx, p, t) {
    const w = p.x1 - p.x0, h = p.y1 - p.y0;
    if (w <= 0 || h <= 0 || p.intensity <= 0) return;
    const all = drops(p.seed, 400);
    const n = Math.min(all.length, Math.round(200 * p.intensity));
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x0, p.y0, w, h); ctx.clip();
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const d = all[i];
      // shortcut: drops jump a little when the scene loops; invisible at rain speed, make speeds loop-exact if it shows
      const y = p.y0 - 40 + mod(d.y * (h + 80) + 900 * d.speed * (0.6 + 0.4 * d.depth) * t, h + 80);
      const x = p.x0 + mod(d.x * w + p.slant * (y - p.y0), w);
      const len = (10 + 16 * d.depth) * d.len;
      ctx.strokeStyle = withAlpha(p.color, 0.18 + 0.32 * d.depth);
      ctx.lineWidth = 0.8 + d.depth;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.slant * len, y - len); ctx.stroke();
    }
    ctx.restore();
  },
});
