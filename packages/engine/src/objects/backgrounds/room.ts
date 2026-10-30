import { defineObject, z, num, color } from "../common";

export const room = defineObject({
  type: "room",
  category: "backgrounds",
  description: "Cozy interior wall with vertical paneling, a baseboard and a plank floor.",
  params: z.object({
    top: color.default("#2b2030"),
    bottom: color.default("#3a2a2e"),
    floor: color.default("#231a1e"),
    floorY: num.default(560),
    panelSpacing: num.default(78),
  }),
  draw(ctx, p, _t, env) {
    const W = env.width + 200;
    const g = ctx.createLinearGradient(0, 0, 0, p.floorY);
    g.addColorStop(0, p.top);
    g.addColorStop(1, p.bottom);
    ctx.fillStyle = g;
    ctx.fillRect(-100, -100, W, p.floorY + 120);
    ctx.strokeStyle = "rgba(0,0,0,.18)";
    ctx.lineWidth = 2;
    for (let x = 0; x < env.width + 20; x += p.panelSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, -100);
      ctx.lineTo(x, p.floorY);
      ctx.stroke();
    }
    ctx.fillStyle = p.floor;
    ctx.fillRect(-100, p.floorY, W, env.height - p.floorY + 100);
    ctx.fillStyle = "#2c2024";
    ctx.fillRect(-100, p.floorY - 8, W, 12);
    ctx.strokeStyle = "rgba(255,255,255,.04)";
    for (let y = p.floorY + 30; y < env.height + 40; y += 34) {
      ctx.beginPath();
      ctx.moveTo(-100, y);
      ctx.lineTo(env.width + 100, y);
      ctx.stroke();
    }
  },
});
