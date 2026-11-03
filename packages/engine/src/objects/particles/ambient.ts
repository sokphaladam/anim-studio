// Ambient loops for layered scenes, drawn over the painting. Every motion repeats exactly every `period` seconds
// (set it to a divisor of the scene length and the whole video loops seamlessly).
import { rng } from "../../rng";
import { defineObject, z, num, color, withAlpha, mod, TAU, leafShape } from "../common";

const seeded = <T>(seed: number, n: number, make: (r: () => number) => T) => {
  const r = rng(seed);
  return Array.from({ length: n }, () => make(r));
};
// whole cycles per period, so phases line up again at the period
const cycles = (r: () => number, max: number) => 1 + Math.floor(r() * max);

export const stars = defineObject({
  type: "stars",
  category: "particles",
  description: "Small twinkling stars in the box x0..x1, y0..y1 (transparent: draw over a painted night sky).",
  params: z.object({
    x0: num.default(0),
    y0: num.default(0),
    x1: num.default(1280),
    y1: num.default(360),
    count: z.number().int().min(1).max(300).default(40),
    size: num.default(2),
    color: color.default("#fff6dc"),
    period: z.number().positive().default(6),
    seed: z.number().int().default(5),
  }),
  draw(ctx, p, t) {
    const list = seeded(p.seed, p.count, (r) => ({ x: r(), y: r(), k: cycles(r, 2), ph: r(), s: 0.5 + r() }));
    for (const s of list) {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(TAU * (s.k * t / p.period + s.ph)));
      const x = p.x0 + s.x * (p.x1 - p.x0), y = p.y0 + s.y * (p.y1 - p.y0), r = p.size * s.s;
      ctx.fillStyle = withAlpha(p.color, a);
      ctx.beginPath();
      // a four-pointed sparkle
      ctx.moveTo(x, y - r * 2);
      ctx.quadraticCurveTo(x, y, x + r * 2, y);
      ctx.quadraticCurveTo(x, y, x, y + r * 2);
      ctx.quadraticCurveTo(x, y, x - r * 2, y);
      ctx.quadraticCurveTo(x, y, x, y - r * 2);
      ctx.fill();
    }
  },
});

export const fallingLeaves = defineObject({
  type: "falling-leaves",
  category: "particles",
  description: "Leaves drifting down and swaying through the box x0..x1, y0..y1.",
  params: z.object({
    x0: num.default(0),
    y0: num.default(0),
    x1: num.default(1280),
    y1: num.default(720),
    count: z.number().int().min(1).max(60).default(10),
    size: num.default(9),
    color: color.default("#e8762a"),
    period: z.number().positive().default(6),
    seed: z.number().int().default(7),
  }),
  draw(ctx, p, t) {
    const list = seeded(p.seed, p.count, (r) => ({ x: r(), ph: r(), sway: 0.5 + r(), spin: cycles(r, 2) * (r() < 0.5 ? -1 : 1), s: 0.7 + r() * 0.6, shade: r() }));
    for (const l of list) {
      const q = mod(t / p.period + l.ph, 1);
      const x = p.x0 + l.x * (p.x1 - p.x0) + Math.sin(TAU * q * 2) * 30 * l.sway;
      const y = p.y0 + q * (p.y1 - p.y0);
      // fade in at the top and out at the bottom, so leaves never pop
      ctx.globalAlpha = Math.min(1, q * 8, (1 - q) * 8);
      leafShape(ctx, x, y, p.size * l.s, TAU * q * l.spin, withAlpha(p.color, 0.75 + 0.25 * l.shade));
    }
    ctx.globalAlpha = 1;
  },
});

export const birds = defineObject({
  type: "birds",
  category: "particles",
  description: "A few distant birds flapping across the sky, left to right, between heights y0 and y1.",
  params: z.object({
    y0: num.default(80),
    y1: num.default(220),
    count: z.number().int().min(1).max(12).default(4),
    size: num.default(8),
    color: color.default("#2b2733"),
    period: z.number().positive().default(12),
    seed: z.number().int().default(9),
  }),
  draw(ctx, p, t, env) {
    const list = seeded(p.seed, p.count, (r) => ({ y: r(), ph: r() * 0.25, flap: cycles(r, 3) + 3, s: 0.7 + r() * 0.5 }));
    ctx.strokeStyle = p.color;
    ctx.lineCap = "round";
    for (const b of list) {
      // the flock crosses once per period, a little apart
      const q = mod(t / p.period + b.ph, 1);
      const x = -60 + q * (env.width + 120), y = p.y0 + b.y * (p.y1 - p.y0) + Math.sin(TAU * q * 2) * 6;
      const w = p.size * b.s, lift = Math.sin(TAU * b.flap * t / p.period * 4) * w * 0.6;
      ctx.lineWidth = Math.max(1, w * 0.18);
      ctx.beginPath();
      ctx.moveTo(x - w, y - lift);
      ctx.quadraticCurveTo(x - w * 0.4, y - w * 0.3, x, y);
      ctx.quadraticCurveTo(x + w * 0.4, y - w * 0.3, x + w, y - lift);
      ctx.stroke();
    }
  },
});

export const steam = defineObject({
  type: "steam",
  category: "particles",
  description: "Wisps of steam curling up from (x, y), e.g. above a cup, height tall.",
  params: z.object({
    x: num,
    y: num,
    height: num.default(120),
    width: num.default(14),
    lineWidth: num.default(3),
    color: color.default("#f3e6d2"),
    period: z.number().positive().default(3),
  }),
  draw(ctx, p, t) {
    ctx.lineCap = "round";
    ctx.lineWidth = p.lineWidth;
    for (let w = 0; w < 2; w++) {
      const q = t / p.period + w / 2;
      const grad = ctx.createLinearGradient(0, p.y, 0, p.y - p.height);
      grad.addColorStop(0, withAlpha(p.color, 0));
      grad.addColorStop(0.2, withAlpha(p.color, 0.7));
      grad.addColorStop(1, withAlpha(p.color, 0));
      ctx.strokeStyle = grad;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const s = i / 24;
        // the wave travels upward and widens as it rises
        const x = p.x + (w ? 4 : -4) + Math.sin(TAU * (s * 1.5 - q)) * p.width * (0.3 + s);
        const y = p.y - s * p.height;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  },
});
