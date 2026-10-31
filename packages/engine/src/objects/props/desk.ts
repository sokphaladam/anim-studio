import { defineObject, z, num, color } from "../common";

export const desk = defineObject({
  type: "desk",
  category: "props",
  description: "Wooden desk seen from the front with a notebook, pencil and a stack of books; x is the left edge, y the top surface, legs reach the floor at y + height. Stand laptop/candle objects on y.",
  params: z.object({
    x: num,
    y: num,
    width: num.default(300),
    height: num.default(150),
    wood: color.default("#4d3036"),
    books: z.boolean().default(true),
  }),
  draw(ctx, p) {
    ctx.translate(p.x, p.y);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(4, p.height - 4, p.width - 8, 8);
    ctx.fillStyle = p.wood;
    ctx.fillRect(10, 10, 14, p.height - 10);
    ctx.fillRect(p.width - 24, 10, 14, p.height - 10);
    ctx.fillRect(10, 10, p.width - 20, 34);
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.fillRect(10, 10, p.width - 20, 34);
    ctx.fillStyle = p.wood;
    ctx.fillRect(-6, -2, p.width + 12, 14);
    ctx.fillStyle = "rgba(255,230,210,.12)";
    ctx.fillRect(-6, -2, p.width + 12, 3);
    if (p.books) {
      ctx.fillStyle = "#e9e2d4";
      ctx.save(); ctx.translate(p.width * 0.72, -3); ctx.rotate(-0.05); ctx.fillRect(-30, -2, 60, 4); ctx.restore();
      ctx.strokeStyle = "#d9a43c"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(p.width * 0.72 + 18, -7); ctx.lineTo(p.width * 0.72 + 42, -12); ctx.stroke();
      ["#7a4b6b", "#3f5f7a", "#a8643a"].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(14 + i * 3, -14 - i * 12, 64 - i * 6, 12);
      });
    }
  },
});
