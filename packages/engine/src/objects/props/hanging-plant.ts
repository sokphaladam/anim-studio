import { defineObject, z, num, color, TAU, leafShape } from "../common";

export const hangingPlant = defineObject({
  type: "hanging-plant",
  category: "props",
  description: "Pot hanging on a cord from (x, y) with trailing vines that sway gently.",
  params: z.object({ x: num, y: num.default(0), length: num.default(90), vines: z.number().int().min(1).max(9).default(5), leaf: color.default("#5f8a4e"), pot: color.default("#b5613d") }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin((t * TAU) / 4) * 0.035);
    ctx.strokeStyle = "#1a1218"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-22, p.length); ctx.moveTo(0, 0); ctx.lineTo(22, p.length); ctx.stroke();
    ctx.translate(0, p.length);
    for (let i = 0; i < p.vines; i++) {
      const vx = -20 + (40 * i) / Math.max(1, p.vines - 1), len = 60 + ((i * 37) % 70);
      const sway = Math.sin((t * TAU) / 3 + i) * 6;
      ctx.strokeStyle = p.leaf; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(vx, 10); ctx.quadraticCurveTo(vx + sway * 0.5, 10 + len * 0.5, vx + sway, 10 + len); ctx.stroke();
      for (let k = 1; k <= 5; k++) {
        const u = k / 5;
        leafShape(ctx, vx + sway * u * u, 10 + len * u, 6, (k % 2 ? 0.9 : -0.9) + sway * 0.02, k % 2 ? p.leaf : "#4c7340");
      }
    }
    for (let i = 0; i < 6; i++) leafShape(ctx, -24 + i * 10, -2 - (i % 2) * 6, 8, -0.6 + i * 0.25, i % 2 ? p.leaf : "#4c7340");
    ctx.fillStyle = p.pot;
    ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(26, 0); ctx.lineTo(19, 30); ctx.lineTo(-19, 30); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.fillRect(-26, 0, 52, 5);
  },
});
