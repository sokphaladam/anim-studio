import { defineObject, z, num, TAU, rrect } from "../common";

export const lantern = defineObject({
  type: "lantern",
  category: "props",
  description: "Hanging lantern on a cord that swings slightly and flickers; light 0 = off, 1 = fully lit. Feeds the glow object.",
  params: z.object({ x: num, length: num.default(140), light: num.default(1) }),
  draw(ctx, p, t, env) {
    const light = p.light * (0.93 + 0.07 * Math.sin(t * 23) * Math.sin(t * 7.3));
    const ang = Math.sin((t * TAU) / 4) * 0.05;
    ctx.translate(p.x, -20);
    ctx.rotate(ang);
    ctx.strokeStyle = "#1a1216";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, p.length + 20); ctx.stroke();
    const y = p.length + 20;
    ctx.fillStyle = "#241a1d";
    ctx.beginPath(); ctx.moveTo(-14, y); ctx.lineTo(14, y); ctx.lineTo(26, y + 16); ctx.lineTo(-26, y + 16); ctx.fill();
    ctx.fillStyle = `rgba(255,${170 + 50 * light},${90 + 40 * light},${0.25 + 0.75 * light})`;
    rrect(ctx, -20, y + 16, 40, 58, 6); ctx.fill();
    ctx.fillStyle = `rgba(255,245,210,${light})`;
    ctx.beginPath(); ctx.ellipse(0, y + 48, 6, 11, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#241a1d";
    ctx.lineWidth = 4;
    rrect(ctx, -20, y + 16, 40, 58, 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y + 16); ctx.lineTo(0, y + 74); ctx.stroke();
    ctx.fillStyle = "#241a1d";
    ctx.fillRect(-24, y + 74, 48, 8);
    env.shared.light = light;
    env.shared.lampPos = [p.x + Math.sin(ang) * (p.length + 70), p.length + 50];
  },
});
