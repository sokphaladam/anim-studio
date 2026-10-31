import { defineObject, z, num, color, TAU } from "../common";

export const candle = defineObject({
  type: "candle",
  category: "props",
  description: "Small candle in a glass holder (x, y = bottom) with a flickering flame that lights its surroundings; light 0 = blown out.",
  params: z.object({ x: num, y: num, height: num.default(34), wax: color.default("#f1e4cc"), light: num.default(1), glowRadius: num.default(130) }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    const L = p.light * (0.88 + 0.08 * Math.sin(t * 19) * Math.sin(t * 7.1) + 0.04 * Math.sin(t * 31));
    const top = -p.height;
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, top - 12, 2, 0, top - 12, p.glowRadius);
    g.addColorStop(0, `rgba(255,190,110,${0.45 * L})`);
    g.addColorStop(0.4, `rgba(255,150,80,${0.12 * L})`);
    g.addColorStop(1, "rgba(255,120,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, top - 12, p.glowRadius, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = p.wax;
    ctx.fillRect(-11, top, 22, p.height);
    ctx.fillStyle = "rgba(255,170,90,.25)";
    ctx.fillRect(-11, top, 22, 8);
    ctx.fillStyle = "rgba(220,235,255,.18)";
    ctx.fillRect(-15, top - 8, 30, p.height + 8);
    ctx.strokeStyle = "#2a1c22"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(0, top - 5); ctx.stroke();
    if (p.light > 0.02) {
      const sway = Math.sin(t * 5.3) * 1.2;
      ctx.fillStyle = `rgba(255,170,70,${L})`;
      ctx.beginPath(); ctx.moveTo(-4.5, top - 5); ctx.quadraticCurveTo(-5, top - 14, sway, top - 22 * L); ctx.quadraticCurveTo(5, top - 14, 4.5, top - 5); ctx.fill();
      ctx.fillStyle = `rgba(255,245,200,${L})`;
      ctx.beginPath(); ctx.ellipse(0, top - 9, 2, 4.5, 0, 0, TAU); ctx.fill();
    }
  },
});
