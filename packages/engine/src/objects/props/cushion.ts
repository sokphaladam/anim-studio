import { defineObject, z, num, color, TAU } from "../common";

export const cushion = defineObject({
  type: "cushion",
  category: "props",
  description: "Large round floor cushion with buttons and a soft shadow, a bed for a sleeping animal; x/y is its center.",
  params: z.object({ x: num, y: num, color: color.default("#7b3f4c") }),
  draw(ctx, p) {
    ctx.translate(p.x, p.y);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.beginPath(); ctx.ellipse(0, 30, 215, 22, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#5e2f3a";
    ctx.beginPath(); ctx.ellipse(0, 10, 205, 40, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, 0, 200, 36, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#4c2530";
    for (const x of [-110, 0, 110]) { ctx.beginPath(); ctx.arc(x, 2, 4, 0, TAU); ctx.fill(); }
  },
});
