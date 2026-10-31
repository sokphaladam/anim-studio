import { rng } from "../../rng";
import { defineObject, z, num, color, TAU, withAlpha } from "../common";

type Building = { x: number; w: number; h: number; lit: { dx: number; dy: number; blink: number; ph: number }[] };

function skyline(seed: number, x0: number, x1: number, minH: number, maxH: number, density: number): Building[] {
  const r = rng(seed);
  const out: Building[] = [];
  for (let x = x0 - 20; x < x1; ) {
    const w = 40 + r() * 70, h = minH + r() * (maxH - minH);
    const lit = [];
    for (let dy = 14; dy < h - 10; dy += 16)
      for (let dx = 8; dx < w - 10; dx += 13) if (r() < density) lit.push({ dx, dy, blink: r() < 0.12 ? [4, 6][Math.floor(r() * 2)] : 0, ph: r() * TAU });
    out.push({ x, w, h, lit });
    x += w + r() * 6;
  }
  return out;
}

export const cityLights = defineObject({
  type: "city-lights",
  category: "backgrounds",
  description: "Distant night city between x0 and x1: two rows of skyline silhouettes with lit windows and soft blurred bokeh lights that slowly pulse; base is the ground line.",
  params: z.object({
    x0: num.default(0),
    x1: num.default(1280),
    base: num.default(560),
    seed: z.number().int().default(5),
    far: color.default("#2c2450"),
    near: color.default("#181331"),
    window: color.default("#ffcf7a"),
    bokeh: z.array(color).min(1).default(["#ffb86b", "#ff7aa8", "#8fd3ff", "#ffe08a"]),
    bokehCount: z.number().int().min(0).max(150).default(36),
  }),
  draw(ctx, p, t) {
    const rows = [skyline(p.seed, p.x0, p.x1, 60, 170, 0.18), skyline(p.seed + 1, p.x0, p.x1, 30, 120, 0.32)];
    rows.forEach((row, i) => {
      for (const b of row) {
        ctx.fillStyle = i ? p.near : p.far;
        ctx.fillRect(b.x, p.base - b.h - (i ? 0 : 30), b.w, b.h + 40);
        for (const L of b.lit) {
          const on = L.blink ? (Math.sin((t * TAU) / L.blink + L.ph) > -0.6 ? 1 : 0.15) : 1;
          ctx.fillStyle = withAlpha(p.window, (i ? 0.85 : 0.45) * on);
          ctx.fillRect(b.x + L.dx, p.base - b.h - (i ? 0 : 30) + L.dy, 5, 7);
        }
      }
    });
    const r = rng(p.seed + 2);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < p.bokehCount; i++) {
      const x = p.x0 + r() * (p.x1 - p.x0), y = p.base - 10 - r() * 170, rad = 5 + r() * 16;
      const c = p.bokeh[Math.floor(r() * p.bokeh.length)];
      const a = 0.35 + 0.25 * Math.sin((t * TAU) / [4, 6][i % 2] + r() * TAU);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, withAlpha(c, a));
      g.addColorStop(0.6, withAlpha(c, a * 0.5));
      g.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  },
});
