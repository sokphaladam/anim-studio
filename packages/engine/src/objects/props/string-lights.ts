import { defineObject, z, num, color, TAU, withAlpha } from "../common";

export const stringLights = defineObject({
  type: "string-lights",
  category: "props",
  description: "Fairy lights on a wire sagging from (x0, y0) to (x1, y1); bulbs glow and gently flicker; light 0 = off, 1 = on.",
  params: z.object({
    x0: num.default(780),
    y0: num.default(60),
    x1: num.default(1300),
    y1: num.default(70),
    sag: num.default(50),
    bulbs: z.number().int().min(1).max(60).default(12),
    color: color.default("#ffd38a"),
    light: num.default(1),
  }),
  draw(ctx, p, t) {
    const at = (u: number): [number, number] => [p.x0 + (p.x1 - p.x0) * u, p.y0 + (p.y1 - p.y0) * u + p.sag * 4 * u * (1 - u)];
    ctx.strokeStyle = "#1a1218";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) ctx.lineTo(...at(i / 40));
    ctx.stroke();
    for (let i = 0; i < p.bulbs; i++) {
      const [x, y0] = at((i + 0.5) / p.bulbs), y = y0 + 9;
      const L = p.light * (0.82 + 0.18 * Math.sin((t * TAU) / [2, 3, 4][i % 3] + i * 1.7));
      ctx.fillStyle = "#1a1218";
      ctx.fillRect(x - 2, y0, 4, 6);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(x, y, 0, x, y, 30);
      g.addColorStop(0, withAlpha(p.color, 0.55 * L));
      g.addColorStop(1, withAlpha(p.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 30, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = withAlpha(p.color, 0.35 + 0.65 * L);
      ctx.beginPath(); ctx.ellipse(x, y, 4, 6, 0, 0, TAU); ctx.fill();
    }
  },
});
