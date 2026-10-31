import { defineObject, z, num, color, TAU } from "../common";
import type { Ctx2D } from "../../registry";

const limb = (ctx: Ctx2D, pts: [number, number][], width: number, fill: string) => {
  ctx.strokeStyle = fill;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.stroke();
};

export const studier = defineObject({
  type: "studier",
  category: "characters",
  description:
    "A person in headphones sitting on a chair at a desk in profile, nodding to music and writing; x, y = floor under the chair, facing 1 = desk on the right, -1 = left; deskHeight must match the desk's height so the hand rests on it.",
  params: z.object({
    x: num,
    y: num,
    scale: num.default(1),
    facing: z.number().default(1),
    deskHeight: num.default(150),
    /** How far in front of the chair the writing hand rests. */
    reach: num.default(105),
    bpm: num.default(80),
    writing: num.default(1),
    skin: color.default("#e8b796"),
    hair: color.default("#2f5d62"),
    top: color.default("#d9a441"),
    pants: color.default("#3b3552"),
    headphones: color.default("#ece8f3"),
    chair: color.default("#2a1d26"),
  }),
  draw(ctx, p, t) {
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale * (p.facing < 0 ? -1 : 1), p.scale);
    // nod on every beat; 80 bpm = 0.75 s, which divides whole-second loops of 3, 6, 12 s
    const nod = 0.5 - 0.5 * Math.cos((t * TAU * p.bpm) / 60);
    const breath = Math.sin((t * TAU) / 4);
    const lean = 0.16 + 0.01 * breath;
    // chair (behind the body)
    ctx.fillStyle = p.chair;
    ctx.fillRect(-48, -104, 86, 10);
    ctx.fillRect(-44, -96, 6, 96);
    ctx.fillRect(30, -96, 6, 96);
    ctx.fillRect(-52, -210, 9, 112);
    ctx.fillRect(-56, -205, 14, 62);
    // legs: thigh forward, shin down to the floor
    limb(ctx, [[-12, -112], [58, -114], [64, -12]], 28, p.pants);
    ctx.fillStyle = "#e6e1ea";
    ctx.beginPath(); ctx.ellipse(74, -7, 19, 8, 0, 0, TAU); ctx.fill();
    // upper body leans toward the desk, pivoting at the hip
    const hip: [number, number] = [-8, -112];
    const rot = ([x, y]: [number, number]): [number, number] => [hip[0] + x * Math.cos(lean) - y * Math.sin(lean), hip[1] + x * Math.sin(lean) + y * Math.cos(lean)];
    const shoulder = rot([16, -92]);
    const hand: [number, number] = [p.reach + p.writing * Math.sin(t * TAU * 2) * 3, -p.deskHeight - 7 - p.writing * Math.abs(Math.sin(t * TAU)) * 2];
    const elbow: [number, number] = [(shoulder[0] + hand[0]) / 2 - 4, Math.max(shoulder[1], hand[1]) + 22];
    // far arm resting on the desk, a little darker
    limb(ctx, [rot([10, -88]), [elbow[0] + 14, elbow[1] - 4], [hand[0] + 22, hand[1] + 2]], 16, p.top);
    limb(ctx, [rot([10, -88]), [elbow[0] + 14, elbow[1] - 4], [hand[0] + 22, hand[1] + 2]], 16, "rgba(0,0,0,.25)");
    ctx.save();
    ctx.translate(...hip);
    ctx.rotate(lean);
    ctx.fillStyle = p.top;
    ctx.beginPath();
    ctx.moveTo(-26, 6); ctx.quadraticCurveTo(-38 - breath, -52, -18, -100); ctx.lineTo(26, -104); ctx.quadraticCurveTo(36 + breath, -56, 26, 6);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.12)";
    ctx.beginPath(); ctx.ellipse(-16, -96, 20, 12, 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = p.skin;
    ctx.fillRect(0, -116, 14, 18);
    // head
    ctx.translate(10, -138 + nod * 2);
    ctx.rotate(0.05 + nod * 0.07 - lean * 0.6);
    ctx.fillStyle = p.hair;
    ctx.beginPath(); ctx.arc(-4, -4, 31, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-34, -4); ctx.lineTo(-30, 24); ctx.quadraticCurveTo(-14, 30, 0, 22); ctx.lineTo(0, 0); ctx.fill();
    ctx.fillStyle = p.skin;
    ctx.beginPath(); ctx.ellipse(10, 6, 21, 23, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(31, 6, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = p.hair;
    ctx.beginPath(); ctx.moveTo(-16, -24); ctx.quadraticCurveTo(14, -36, 32, -8); ctx.quadraticCurveTo(18, -16, 4, -10); ctx.quadraticCurveTo(-6, -12, -16, -4); ctx.fill();
    ctx.fillStyle = "rgba(240,130,130,.35)";
    ctx.beginPath(); ctx.ellipse(16, 14, 6, 3.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#2a1c22";
    ctx.beginPath(); ctx.ellipse(21, 3, 1.8, 2.6 - nod, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#2a1c22"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(22, 3, 8, 0, TAU); ctx.moveTo(14, 2); ctx.lineTo(-2, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(22, 18); ctx.lineTo(27, 17); ctx.stroke();
    // headphones
    ctx.strokeStyle = p.headphones; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-7, -8); ctx.quadraticCurveTo(-14, -36, 2, -37); ctx.stroke();
    ctx.fillStyle = p.headphones;
    ctx.beginPath(); ctx.ellipse(-6, 4, 12, 16, -0.15, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.beginPath(); ctx.ellipse(-4, 4, 6, 10, -0.15, 0, TAU); ctx.fill();
    ctx.restore();
    // near arm: shoulder → elbow → hand holding a pencil
    limb(ctx, [shoulder, elbow, hand], 18, p.top);
    ctx.fillStyle = p.skin;
    ctx.beginPath(); ctx.arc(hand[0] + 4, hand[1], 8, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#d9a43c"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(hand[0] + 6, hand[1] + 4); ctx.lineTo(hand[0] + 14, hand[1] - 14); ctx.stroke();
  },
});
