import { defineObject, z, num, color, TAU, mod } from "../common";

export const cat = defineObject({
  type: "cat",
  category: "characters",
  description: "A cat sitting in profile (x, y = where it sits) that breathes, sways its tail, twitches an ear and blinks; facing 1 = looks right, -1 = left.",
  params: z.object({
    x: num,
    y: num,
    scale: num.default(1),
    color: color.default("#3a3540"),
    belly: color.default("#5a5462"),
    eyes: color.default("#ffd36b"),
    facing: z.number().default(1),
    /** Seconds between blinks; pick a divisor of the duration so it loops. */
    blinkEvery: z.number().positive().default(4),
  }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale * (p.facing < 0 ? -1 : 1), p.scale);
    const breath = 1 + 0.025 * Math.sin((t * TAU) / 3);
    const sway = Math.sin((t * TAU) / 3) * 10;
    // tail curling on the ground, tip swaying
    ctx.lineCap = "round";
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(-24, -6); ctx.quadraticCurveTo(-58, 0, -62 + sway * 0.3, -26); ctx.quadraticCurveTo(-64 + sway, -46, -50 + sway, -50); ctx.stroke();
    // body and haunch
    ctx.save();
    ctx.scale(1, breath);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(-6, -24, 32, 24, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6, -46, 22, 34, 0.25, 0, TAU); ctx.fill();
    ctx.fillStyle = p.belly;
    ctx.beginPath(); ctx.ellipse(18, -42, 9, 22, 0.25, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(20, -4, 10, 5, 0, 0, TAU); ctx.fill();
    // head
    ctx.translate(18, -80 * breath);
    const twitch = mod(t, 6) > 2 && mod(t, 6) < 2.4 ? Math.sin((mod(t, 6) - 2) * 40) * 0.25 : 0;
    for (const [ex, r] of [[-8, -0.15 + twitch], [8, 0.2]]) {
      ctx.save();
      ctx.translate(ex, -12);
      ctx.rotate(r);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.moveTo(-8, 4); ctx.lineTo(-1, -16); ctx.lineTo(8, 4); ctx.fill();
      ctx.fillStyle = "rgba(255,170,190,.35)";
      ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(-1, -9); ctx.lineTo(4, 2); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, 0, 21, 18, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(16, 5, 10, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#e89aa8";
    ctx.beginPath(); ctx.arc(25, 3, 2.2, 0, TAU); ctx.fill();
    const blink = mod(t, p.blinkEvery) < 0.16;
    if (blink) {
      ctx.strokeStyle = "#141018"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(15, -2); ctx.stroke();
    } else {
      ctx.fillStyle = p.eyes;
      ctx.beginPath(); ctx.ellipse(11, -3, 5, 4, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#141018";
      ctx.beginPath(); ctx.ellipse(12, -3, 1.6, 3.6, 0, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(20, 8); ctx.lineTo(36, 6); ctx.moveTo(20, 10); ctx.lineTo(35, 12); ctx.stroke();
  },
});
