import { defineObject, z, num } from "../common";

export const lightShaft = defineObject({
  type: "light-shaft",
  category: "fx",
  description: "Soft warm beam of window light falling onto the floor; x/y is the top center (under a window sill).",
  params: z.object({ x: num.default(910), y: num.default(546), opacity: num.default(0.1) }),
  draw(ctx, p) {
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(0, p.y - 6, 0, p.y + 174);
    g.addColorStop(0, `rgba(255,170,100,${p.opacity})`);
    g.addColorStop(1, "rgba(255,170,100,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.x - 210, p.y); ctx.lineTo(p.x + 210, p.y); ctx.lineTo(p.x + 110, p.y + 194); ctx.lineTo(p.x - 390, p.y + 194);
    ctx.fill();
  },
});
