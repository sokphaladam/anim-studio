import { defineObject, z, num, color, TAU, mod } from "../common";

export const owl = defineObject({
  type: "owl",
  category: "characters",
  description: "A small owl perched on a branch (x, y = where its feet grip) that breathes, tilts its head now and then and blinks; `blinkEvery` and `tiltEvery` are seconds (use divisors of the scene length to loop).",
  params: z.object({
    x: num,
    y: num,
    scale: num.default(1),
    color: color.default("#8a6a4f"),
    belly: color.default("#d8c3a0"),
    eyes: color.default("#ffcf4d"),
    branch: color.default("#4a3426"),
    blinkEvery: z.number().positive().default(4),
    tiltEvery: z.number().positive().default(6),
  }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);
    // branch
    ctx.strokeStyle = p.branch;
    ctx.lineCap = "round";
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(-70, 4); ctx.quadraticCurveTo(0, -2, 80, 8); ctx.stroke();
    // body, breathing
    const breath = 1 + 0.03 * Math.sin((t * TAU) / 3);
    ctx.save();
    ctx.scale(1, breath);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, -34, 26, 34, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.belly;
    ctx.beginPath(); ctx.ellipse(0, -28, 17, 24, 0, 0, TAU); ctx.fill();
    ctx.restore();
    // feet
    ctx.fillStyle = "#e0a640";
    for (const fx of [-8, 8]) { ctx.beginPath(); ctx.ellipse(fx, 0, 5, 3, 0, 0, TAU); ctx.fill(); }
    // head: a quick tilt and back once every tiltEvery seconds
    const k = mod(t, p.tiltEvery) / p.tiltEvery;
    const tilt = k > 0.6 && k < 0.85 ? Math.sin(((k - 0.6) / 0.25) * Math.PI) * 0.35 : 0;
    ctx.save();
    ctx.translate(0, -64 * breath);
    ctx.rotate(tilt);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, -10, 24, 21, 0, 0, TAU); ctx.fill();
    // ear tufts
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(s * 12, -26); ctx.lineTo(s * 22, -40); ctx.lineTo(s * 22, -22); ctx.fill();
    }
    // face disc, eyes and beak
    ctx.fillStyle = p.belly;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 10, -10, 10, 0, TAU); ctx.fill(); }
    const blink = mod(t, p.blinkEvery) < 0.15;
    for (const s of [-1, 1]) {
      if (blink) {
        ctx.strokeStyle = "#2a1f1c"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s * 10 - 6, -10); ctx.lineTo(s * 10 + 6, -10); ctx.stroke();
      } else {
        ctx.fillStyle = p.eyes; ctx.beginPath(); ctx.arc(s * 10, -10, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = "#1c1412"; ctx.beginPath(); ctx.arc(s * 10, -10, 3.5, 0, TAU); ctx.fill();
      }
    }
    ctx.fillStyle = "#e0a640";
    ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(4, -2); ctx.lineTo(0, 6); ctx.fill();
    ctx.restore();
  },
});
