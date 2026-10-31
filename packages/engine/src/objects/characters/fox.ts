import { defineObject, z, num, color, TAU } from "../common";

export const fox = defineObject({
  type: "fox",
  category: "characters",
  description: "A fox curled up asleep that breathes, sways its tail, and can wake (awake 0 = asleep, 1 = eyes open, head lifted); x, y is the middle of its body, so y = floor - 45 to lie on the floor.",
  params: z.object({
    x: num,
    y: num,
    scale: num.default(1),
    color: color.default("#e9773c"),
    dark: color.default("#b4512a"),
    cream: color.default("#fbeedd"),
    awake: num.default(0),
    breathSeconds: num.default(3),
    /** Time (s) of a quick ear twitch; negative = never. */
    twitchAt: z.number().default(-1),
  }),
  draw(ctx, p, t) {
    const awake = p.awake;
    const breath = 1 + 0.035 * Math.sin((t * TAU) / p.breathSeconds);
    const lift = awake * 7;
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);
    // body
    ctx.save();
    ctx.scale(1, breath);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(10, 0, 112, 46, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.dark;
    ctx.beginPath(); ctx.ellipse(30, -22, 80, 18, 0.05, Math.PI, TAU); ctx.fill();
    ctx.restore();
    // tail wrapping the front
    const tip = Math.sin((t * TAU) / 3) * 4 + awake * Math.sin(t * 9) * 10;
    const tailPath = () => {
      ctx.beginPath(); ctx.moveTo(110, 4); ctx.quadraticCurveTo(80, 52, -20, 40); ctx.quadraticCurveTo(-70, 36, -92 + tip, 22);
    };
    ctx.lineCap = "round";
    ctx.strokeStyle = p.dark; ctx.lineWidth = 50; tailPath(); ctx.stroke();
    ctx.strokeStyle = p.color; ctx.lineWidth = 42; tailPath(); ctx.stroke();
    ctx.strokeStyle = "rgba(255,220,180,.25)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(80, 30); ctx.quadraticCurveTo(40, 52, -30, 46); ctx.stroke();
    ctx.fillStyle = p.dark;
    ctx.beginPath(); ctx.arc(-96 + tip, 21, 25, 0, TAU); ctx.fill();
    ctx.fillStyle = p.cream;
    ctx.beginPath(); ctx.arc(-98 + tip, 21, 21, 0, TAU); ctx.fill();
    // head
    ctx.translate(-85, -16 - lift);
    const twitch = p.twitchAt >= 0 && t > p.twitchAt && t < p.twitchAt + 0.65 ? Math.sin((t - p.twitchAt) * 40) * 0.25 : 0;
    for (const [ex, ey, r] of [[-16, -26, -0.25 + twitch], [16, -28, 0.2]]) {
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(r);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.moveTo(-13, 6); ctx.lineTo(0, -26); ctx.lineTo(13, 6); ctx.fill();
      ctx.fillStyle = "#2a1a18";
      ctx.beginPath(); ctx.moveTo(-6, -11); ctx.lineTo(0, -26); ctx.lineTo(6, -11); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, 0, 38, 32, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = p.cream;
    ctx.beginPath(); ctx.moveTo(-8, 4); ctx.quadraticCurveTo(-30, 30, -58, 18); ctx.quadraticCurveTo(-30, 2, -8, 4); ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.moveTo(-10, -12); ctx.quadraticCurveTo(-40, -2, -58, 14); ctx.quadraticCurveTo(-30, 8, -8, 6); ctx.fill();
    ctx.fillStyle = "#231615";
    ctx.beginPath(); ctx.arc(-58, 14, 5, 0, TAU); ctx.fill();
    if (awake > 0.06) {
      ctx.fillStyle = "#231615";
      ctx.beginPath(); ctx.ellipse(-14, -6, 5, 6 * awake, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${awake})`;
      ctx.beginPath(); ctx.arc(-12, -8, 1.6, 0, TAU); ctx.fill();
    } else {
      ctx.strokeStyle = "#231615"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(-14, -8, 7, 0.2, Math.PI - 0.2); ctx.stroke();
    }
  },
});
