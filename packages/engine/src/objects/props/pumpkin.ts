import { defineObject, z, num, TAU } from "../common";

export const pumpkin = defineObject({
  type: "pumpkin",
  category: "props",
  description: "Small orange pumpkin sitting on the floor; x/y is its center.",
  params: z.object({ x: num, y: num, scale: num.default(1) }),
  draw(ctx, p) {
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);
    ["#c85a1f", "#e2752a", "#d8661f"].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.ellipse((i - 1) * 16, 0, 22, 26, 0, 0, TAU); ctx.fill();
    });
    ctx.fillStyle = "#4e6b35";
    ctx.fillRect(-3, -34, 6, 12);
  },
});
