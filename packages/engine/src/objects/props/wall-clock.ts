import { defineObject, z, num, color, TAU } from "../common";

export const wallClock = defineObject({
  type: "wall-clock",
  category: "props",
  description: "Round wall clock (x, y = its center) whose hands show `time` hours (e.g. 3.25 = 3:15) and advance `speed` clock-minutes per scene second (0 = stopped, 1 = real time ×60).",
  params: z.object({
    x: num,
    y: num,
    radius: num.default(40),
    time: num.default(10.1),
    speed: num.default(1),
    rim: color.default("#3b2a24"),
    face: color.default("#f3ead8"),
    hands: color.default("#2a1f1c"),
  }),
  draw(ctx, p, t) {
    const R = p.radius;
    const hours = p.time + (p.speed * t) / 60;
    ctx.translate(p.x, p.y);
    ctx.fillStyle = p.rim;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.fillStyle = p.face;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, TAU); ctx.fill();
    // hour ticks
    ctx.strokeStyle = p.hands;
    ctx.lineCap = "round";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, long = i % 3 === 0;
      ctx.lineWidth = Math.max(1, R * (long ? 0.06 : 0.035));
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * R * (long ? 0.62 : 0.7), -Math.cos(a) * R * (long ? 0.62 : 0.7));
      ctx.lineTo(Math.sin(a) * R * 0.78, -Math.cos(a) * R * 0.78);
      ctx.stroke();
    }
    const hand = (turns: number, len: number, width: number) => {
      const a = turns * TAU;
      ctx.lineWidth = Math.max(1, R * width);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * R * len, -Math.cos(a) * R * len); ctx.stroke();
    };
    hand((hours % 12) / 12, 0.45, 0.08);
    hand(hours % 1, 0.68, 0.05);
    ctx.fillStyle = p.hands;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.07, 0, TAU); ctx.fill();
  },
});
