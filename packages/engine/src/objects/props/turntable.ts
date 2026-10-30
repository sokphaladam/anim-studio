import { defineObject, z, num, color, TAU, rrect } from "../common";

export const turntable = defineObject({
  type: "turntable",
  category: "props",
  description: "Record player with a spinning vinyl on a wooden cabinet; x/y is the cabinet's top-left corner.",
  params: z.object({ x: num, y: num, spinSeconds: num.default(1.5), wood: color.default("#5a3a2c"), label: color.default("#e0703a") }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.fillStyle = "#2a1d1f";
    ctx.fillRect(14, 150, 10, 30); ctx.fillRect(266, 150, 10, 30);
    ctx.fillStyle = p.wood;
    rrect(ctx, 0, 0, 290, 160, 6); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.3)";
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 60, 262, 40); ctx.strokeRect(14, 108, 262, 40);
    ctx.fillStyle = "#c99a6b";
    ctx.fillRect(135, 77, 20, 5); ctx.fillRect(135, 125, 20, 5);
    ctx.fillStyle = "#1e1517";
    rrect(ctx, 30, -38, 230, 40, 6); ctx.fill();
    ctx.fillStyle = "#0f0b0c";
    ctx.beginPath(); ctx.ellipse(125, -40, 80, 20, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.lineWidth = 1;
    for (let r = 30; r < 78; r += 9) { ctx.beginPath(); ctx.ellipse(125, -40, r, r / 4, 0, 0, TAU); ctx.stroke(); }
    const a = (t / p.spinSeconds) * TAU;
    ctx.strokeStyle = "rgba(255,220,180,.35)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(125, -40, 60, 15, 0, a, a + 0.8); ctx.stroke();
    ctx.fillStyle = p.label;
    ctx.beginPath(); ctx.ellipse(125, -40, 22, 6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#cfc2b0";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(240, -52); ctx.lineTo(232, -30); ctx.lineTo(178, -36); ctx.stroke();
    ctx.fillStyle = "#cfc2b0";
    ctx.beginPath(); ctx.arc(240, -52, 7, 0, TAU); ctx.fill();
  },
});
