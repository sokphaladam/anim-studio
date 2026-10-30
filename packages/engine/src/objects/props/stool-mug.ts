import { defineObject, z, num, TAU, rrect } from "../common";

export const stoolMug = defineObject({
  type: "stool-mug",
  category: "props",
  description: "Wooden stool with a mug of hot drink giving off curling steam; x/y is the seat center.",
  params: z.object({ x: num, y: num, steamSeconds: num.default(3) }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = "#3e2a24";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-38, 80); ctx.moveTo(30, 0); ctx.lineTo(38, 80); ctx.moveTo(0, 4); ctx.lineTo(0, 82); ctx.stroke();
    ctx.fillStyle = "#6b4634";
    ctx.beginPath(); ctx.ellipse(0, 0, 46, 11, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#e9d6bd";
    rrect(ctx, -18, -36, 36, 34, 6); ctx.fill();
    ctx.strokeStyle = "#e9d6bd";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(19, -20, 9, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.fillStyle = "#5a3424";
    ctx.beginPath(); ctx.ellipse(0, -36, 16, 4, 0, 0, TAU); ctx.fill();
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let j = 0; j <= 20; j++) {
        const y = -40 - j * 5.5;
        const x = (i - 1) * 8 + Math.sin(j * 0.35 - (t * TAU) / p.steamSeconds + i * 2) * 7 * (j / 20);
        if (j) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.strokeStyle = "rgba(251,238,221,.22)";
      ctx.stroke();
    }
  },
});
