import { defineObject, z, num, color } from "../common";

export const balcony = defineObject({
  type: "balcony",
  category: "backgrounds",
  description: "Balcony: a wooden railing in front of the outdoor view, a plank floor, and a wooden house wall from wallX to the right edge (wallX past the width = no wall). Draw the sky/city before it; things on the floor stand at floorY.",
  params: z.object({
    railY: num.default(440),
    floorY: num.default(600),
    wallX: num.default(780),
    wall: color.default("#4a2f45"),
    wood: color.default("#2d1d2c"),
    floor: color.default("#24182a"),
  }),
  draw(ctx, p, _t, env) {
    const W = env.width + 100;
    // wall with horizontal planks and a darker edge where it meets the opening
    const g = ctx.createLinearGradient(p.wallX, 0, W, 0);
    g.addColorStop(0, p.wall);
    g.addColorStop(1, "rgba(20,10,25,1)");
    ctx.fillStyle = p.wall;
    ctx.fillRect(p.wallX, -100, W - p.wallX, p.floorY + 100);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = g;
    ctx.fillRect(p.wallX, -100, W - p.wallX, p.floorY + 100);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 2;
    for (let y = 20; y < p.floorY; y += 38) {
      ctx.beginPath(); ctx.moveTo(p.wallX, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.fillStyle = p.wood;
    ctx.fillRect(p.wallX - 14, -100, 18, p.floorY + 100);
    // railing across the opening
    const x1 = Math.min(p.wallX, W);
    ctx.fillStyle = p.wood;
    for (let x = -10; x < x1; x += 34) ctx.fillRect(x, p.railY, 7, p.floorY - p.railY);
    ctx.fillRect(-100, p.railY - 10, x1 + 100, 16);
    ctx.fillRect(-100, p.floorY - 24, x1 + 100, 10);
    ctx.fillStyle = "rgba(255,220,200,.08)";
    ctx.fillRect(-100, p.railY - 10, x1 + 100, 3);
    // floor
    ctx.fillStyle = p.floor;
    ctx.fillRect(-100, p.floorY, W + 100, env.height - p.floorY + 100);
    ctx.strokeStyle = "rgba(255,255,255,.035)";
    for (let y = p.floorY + 26; y < env.height + 40; y += 30) {
      ctx.beginPath(); ctx.moveTo(-100, y); ctx.lineTo(W, y); ctx.stroke();
    }
  },
});
