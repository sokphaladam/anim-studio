import type { Ctx2D } from "../../registry";
import { rng } from "../../rng";
import { defineObject, z, num, color, TAU, mod, leafShape } from "../common";

// Art is authored around a 400-wide arch whose sill center sits at (910, 520); x/y/scale move it.
const CX = 910, ARCH_Y = 270, R = 200, BOTTOM = 520;

function windowPath(ctx: Ctx2D) {
  ctx.beginPath();
  ctx.moveTo(CX - R, BOTTOM);
  ctx.lineTo(CX - R, ARCH_Y);
  ctx.arc(CX, ARCH_Y, R, Math.PI, 0);
  ctx.lineTo(CX + R, BOTTOM);
  ctx.closePath();
}

type Leaf = { x0: number; y0: number; speed: number; sway: number; freq: number; spin: number; size: number; color: number; drift: number; ph: number };
const leafCache = new Map<string, Leaf[]>();
function leaves(seed: number, count: number, colors: number): Leaf[] {
  const key = `${seed}:${count}:${colors}`;
  let L = leafCache.get(key);
  if (!L) {
    const r = rng(seed);
    L = Array.from({ length: count }, () => ({
      x0: 690 + r() * 460, y0: r() * 560, speed: 32 + r() * 48, sway: 8 + r() * 22, freq: 0.6 + r() * 1.2,
      spin: (r() - 0.5) * 4, size: 5 + r() * 7, color: Math.floor(r() * colors), drift: 0.6 + r() * 0.8, ph: r() * TAU,
    }));
    leafCache.set(key, L);
  }
  return L;
}

export const windowObj = defineObject({
  type: "window",
  category: "backgrounds",
  description: "Arched window with a dusk sky, sun, hills and a maple tree outside, leaves blowing in the wind, and a wooden sill.",
  params: z.object({
    x: num.default(CX),
    y: num.default(BOTTOM),
    scale: num.default(1),
    wind: num.default(0.35),
    leafCount: z.number().int().min(0).max(200).default(34),
    seed: z.number().int().default(7),
    skyTop: color.default("#4d3f7d"),
    skyMid: color.default("#e5836a"),
    skyLow: color.default("#f8c98a"),
    sun: color.default("#ffe2a8"),
    hillFar: color.default("#9c5f7a"),
    hillNear: color.default("#6a3d5a"),
    frame: color.default("#1c1419"),
    leafColors: z.array(color).min(1).default(["#e8742f", "#d9482b", "#f2b03c", "#c9612d", "#a83a2a"]),
  }),
  draw(ctx, p, t, env) {
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);
    ctx.translate(-CX, -BOTTOM);

    ctx.save();
    windowPath(ctx);
    ctx.clip();
    const g = ctx.createLinearGradient(0, 70, 0, 520);
    g.addColorStop(0, p.skyTop);
    g.addColorStop(0.55, p.skyMid);
    g.addColorStop(1, p.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(680, 50, 470, 480);
    const sg = ctx.createRadialGradient(840, 430, 10, 840, 430, 170);
    sg.addColorStop(0, "rgba(255,226,168,.95)");
    sg.addColorStop(0.25, "rgba(255,200,140,.5)");
    sg.addColorStop(1, "rgba(255,190,130,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(680, 250, 470, 280);
    ctx.fillStyle = p.sun;
    ctx.beginPath(); ctx.arc(840, 430, 34, 0, TAU); ctx.fill();
    ctx.fillStyle = p.hillFar;
    ctx.beginPath(); ctx.moveTo(680, 460); ctx.quadraticCurveTo(780, 400, 880, 450); ctx.quadraticCurveTo(990, 380, 1150, 440); ctx.lineTo(1150, 530); ctx.lineTo(680, 530); ctx.fill();
    ctx.fillStyle = p.hillNear;
    ctx.beginPath(); ctx.moveTo(680, 500); ctx.quadraticCurveTo(860, 450, 1150, 490); ctx.lineTo(1150, 530); ctx.lineTo(680, 530); ctx.fill();

    // maple tree
    const sway = Math.sin((t * TAU) / 4) * 3 * p.wind;
    ctx.strokeStyle = "#3a2228";
    ctx.lineCap = "round";
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(1050, 530); ctx.quadraticCurveTo(1045, 420, 1035 + sway, 320); ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(1042, 400); ctx.lineTo(990 + sway, 330); ctx.moveTo(1040, 370); ctx.lineTo(1095 + sway, 310); ctx.stroke();
    for (const [x, y, r, c] of [[1035, 265, 62, "#c9482a"], [985, 300, 48, "#e2702f"], [1092, 290, 52, "#d95a2c"], [1040, 220, 44, "#f0a03a"], [960, 250, 36, "#e8862f"], [1110, 240, 38, "#b83c29"]] as const) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x + sway * 1.4, y, r, 0, TAU); ctx.fill();
    }

    // falling leaves: position is a function of t and the wind integral, never of the previous frame
    const wi = env.integrate(env.raw.wind);
    for (const L of leaves(p.seed, p.leafCount, p.leafColors.length)) {
      const y = 40 + mod(L.y0 + L.speed * t * (0.8 + p.wind * 0.25), 520);
      const x = 680 + mod(L.x0 - 680 - wi * 34 * L.drift, 480) + Math.sin((t * L.freq * TAU) / 2 + L.ph) * L.sway;
      leafShape(ctx, x, y, L.size, t * L.spin + L.ph, p.leafColors[L.color]);
    }
    ctx.restore();

    // frame and sill
    ctx.strokeStyle = p.frame; ctx.lineWidth = 22; windowPath(ctx); ctx.stroke();
    ctx.strokeStyle = "#4a3029"; ctx.lineWidth = 6; windowPath(ctx); ctx.stroke();
    ctx.strokeStyle = p.frame; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(CX, ARCH_Y - R); ctx.lineTo(CX, BOTTOM); ctx.moveTo(CX - R, 310); ctx.lineTo(CX + R, 310); ctx.stroke();
    ctx.fillStyle = "#6b4634"; ctx.fillRect(686, 514, 448, 24);
    ctx.fillStyle = "#8a5c43"; ctx.fillRect(686, 514, 448, 5);
    ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.fillRect(696, 538, 428, 8);
  },
});
