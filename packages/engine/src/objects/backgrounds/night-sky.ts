import { rng } from "../../rng";
import { defineObject, z, num, color, TAU } from "../common";

// twinkle periods divide 12 s, so 6/12/24 s scenes loop seamlessly
const PERIODS = [2, 3, 4, 6];
const stars = (seed: number, count: number) => {
  const r = rng(seed);
  return Array.from({ length: count }, () => ({ x: r(), y: r(), size: 0.6 + r() * 1.5, period: PERIODS[Math.floor(r() * 4)], ph: r() * TAU }));
};

export const nightSky = defineObject({
  type: "night-sky",
  category: "backgrounds",
  description: "Night sky filling the frame: a deep gradient with twinkling stars and an optional glowing moon (moonSize 0 = no moon).",
  params: z.object({
    top: color.default("#0e0b28"),
    bottom: color.default("#43305e"),
    horizon: num.default(560),
    starCount: z.number().int().min(0).max(400).default(140),
    seed: z.number().int().default(3),
    moonX: num.default(1060),
    moonY: num.default(110),
    moonSize: num.default(30),
    moon: color.default("#f6ecd0"),
  }),
  draw(ctx, p, t, env) {
    const g = ctx.createLinearGradient(0, 0, 0, p.horizon);
    g.addColorStop(0, p.top);
    g.addColorStop(1, p.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(-100, -100, env.width + 200, env.height + 200);
    for (const s of stars(p.seed, p.starCount)) {
      const tw = 0.5 + 0.5 * Math.sin((t * TAU) / s.period + s.ph);
      ctx.fillStyle = `rgba(255,248,230,${(0.25 + 0.75 * tw) * (1 - s.y * 0.6)})`;
      ctx.beginPath(); ctx.arc(s.x * env.width, s.y * p.horizon * 0.85, s.size * (0.8 + 0.3 * tw), 0, TAU); ctx.fill();
    }
    if (p.moonSize > 0) {
      const h = ctx.createRadialGradient(p.moonX, p.moonY, p.moonSize * 0.8, p.moonX, p.moonY, p.moonSize * 4);
      h.addColorStop(0, "rgba(255,240,210,.28)");
      h.addColorStop(1, "rgba(255,240,210,0)");
      ctx.fillStyle = h;
      ctx.fillRect(p.moonX - p.moonSize * 4, p.moonY - p.moonSize * 4, p.moonSize * 8, p.moonSize * 8);
      ctx.fillStyle = p.moon;
      ctx.beginPath(); ctx.arc(p.moonX, p.moonY, p.moonSize, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(180,160,140,.18)";
      ctx.beginPath(); ctx.arc(p.moonX - p.moonSize * 0.3, p.moonY + p.moonSize * 0.2, p.moonSize * 0.22, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(p.moonX + p.moonSize * 0.35, p.moonY - p.moonSize * 0.3, p.moonSize * 0.14, 0, TAU); ctx.fill();
    }
  },
});
