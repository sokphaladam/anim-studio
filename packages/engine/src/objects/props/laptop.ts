import { defineObject, z, num, color, TAU, withAlpha, rrect } from "../common";

export const laptop = defineObject({
  type: "laptop",
  category: "props",
  description: "Open laptop standing on a surface (x, y = center of its base) whose screen glows and shows slowly scrolling lines of text; light 0 = screen off.",
  params: z.object({
    x: num,
    y: num,
    scale: num.default(1),
    body: color.default("#b9b3c9"),
    screen: color.default("#8ec5ff"),
    light: num.default(1),
  }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);
    const L = p.light;
    // glow spilling onto the desk and the room
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(0, -40, 10, 0, -40, 190);
    g.addColorStop(0, withAlpha(p.screen, 0.28 * L));
    g.addColorStop(1, withAlpha(p.screen, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-190, -230, 380, 300);
    ctx.globalCompositeOperation = "source-over";
    // lid and screen
    ctx.fillStyle = p.body;
    rrect(ctx, -52, -76, 104, 70, 5); ctx.fill();
    ctx.fillStyle = L > 0.02 ? "#16213a" : "#0c0c14";
    ctx.fillRect(-46, -70, 92, 58);
    if (L > 0.02) {
      ctx.save();
      ctx.beginPath(); ctx.rect(-46, -70, 92, 58); ctx.clip();
      // one line every 1.5 s: whole 12 s scenes scroll exactly 8 lines, so they loop
      const scroll = t / 1.5;
      const first = Math.floor(scroll);
      for (let i = -1; i < 9; i++) {
        const n = i + first;
        ctx.fillStyle = withAlpha(p.screen, 0.85 * L);
        ctx.fillRect(-40 + (((n % 3) + 3) % 3) * 6, -64 + (i - (scroll - first)) * 7.5, 20 + (((n * 37) % 55) + 55) % 55, 3);
      }
      ctx.fillStyle = withAlpha(p.screen, 0.18 * L);
      ctx.fillRect(-46, -70, 92, 58);
      ctx.restore();
    }
    // base
    ctx.fillStyle = p.body;
    ctx.beginPath(); ctx.moveTo(-58, -6); ctx.lineTo(58, -6); ctx.lineTo(64, 0); ctx.lineTo(-64, 0); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(-64, -1, 128, 2);
    ctx.fillStyle = `rgba(160,255,190,${0.6 * L})`;
    ctx.beginPath(); ctx.arc(46, -3, 1.2, 0, TAU); ctx.fill();
  },
});
