import { defineObject, z, num, color, TAU } from "../common";

export const plant = defineObject({
  type: "plant",
  category: "props",
  description: "Small potted plant whose leaves sway gently; x/y is the bottom of the pot.",
  params: z.object({ x: num, y: num, leaf: color.default("#5f8a4e"), pot: color.default("#b5613d") }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = p.leaf;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.35 + Math.sin((t * TAU) / 4 + i) * 0.03;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.quadraticCurveTo(Math.cos(a) * 18, -18 + Math.sin(a) * 22, Math.cos(a) * 30, -18 + Math.sin(a) * 40);
      ctx.stroke();
    }
    ctx.fillStyle = p.pot;
    ctx.beginPath(); ctx.moveTo(-16, -20); ctx.lineTo(16, -20); ctx.lineTo(12, 0); ctx.lineTo(-12, 0); ctx.fill();
  },
});
