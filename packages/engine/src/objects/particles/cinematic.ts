// Atmosphere for a cinematic frame: dust in the light, a flickering lamp, rain running down a window. Every motion makes
// a whole number of cycles over the scene, so the video loops without a jump, and every random choice is seeded.
import { rng } from "../../rng";
import { defineObject, z, num, color, withAlpha, mod, TAU } from "../common";

/** Whole cycles over the scene for something that would naturally repeat every `seconds`. */
const cyclesIn = (duration: number, seconds: number) => Math.max(1, Math.round(duration / seconds));

export const dust = defineObject({
  type: "dust",
  category: "particles",
  description: "Dust motes floating and glinting in the light, in the box x0..x1, y0..y1; intensity 0..2 scales how many.",
  params: z.object({
    x0: num.default(0),
    y0: num.default(0),
    x1: num.default(1280),
    y1: num.default(720),
    intensity: num.default(1),
    size: num.default(1.6),
    color: color.default("#fff3d6"),
    seed: z.number().int().default(23),
  }),
  draw(ctx, p, t, env) {
    const w = p.x1 - p.x0, h = p.y1 - p.y0, D = env.spec.meta.duration;
    if (w <= 0 || h <= 0 || p.intensity <= 0) return;
    const r = rng(p.seed);
    const motes = Array.from({ length: 160 }, () => ({ x: r(), y: r(), a: cyclesIn(D, 6 + r() * 8), b: cyclesIn(D, 5 + r() * 9), glint: cyclesIn(D, 2 + r() * 3), ph: r(), depth: r() }));
    const n = Math.min(motes.length, Math.round(60 * p.intensity));
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x0, p.y0, w, h); ctx.clip();
    for (let i = 0; i < n; i++) {
      const m = motes[i], u = t / D;
      const x = p.x0 + m.x * w + Math.sin(TAU * (m.a * u + m.ph)) * w * 0.04;
      const y = p.y0 + m.y * h + Math.sin(TAU * (m.b * u + m.ph * 2)) * h * 0.05;
      const glint = 0.5 + 0.5 * Math.sin(TAU * (m.glint * u + m.ph));
      ctx.fillStyle = withAlpha(p.color, (0.15 + 0.55 * glint) * (0.4 + 0.6 * m.depth));
      ctx.beginPath(); ctx.arc(x, y, p.size * (0.5 + m.depth), 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
});

export const flicker = defineObject({
  type: "flicker",
  category: "fx",
  description: "A warm light that flickers (a candle, a failing lamp): a glow of `radius` at x, y whose brightness wavers by `amount`; `speed` is how restless it is.",
  params: z.object({
    x: num.default(640),
    y: num.default(360),
    radius: num.default(260),
    color: color.default("#ffb46a"),
    brightness: num.default(0.35),
    amount: num.default(0.4),
    speed: num.default(1),
  }),
  draw(ctx, p, t, env) {
    const D = env.spec.meta.duration;
    // three wobbles at whole cycles per scene: irregular to the eye, exact at the loop
    const k = [3.1, 7.3, 13.7].map((f) => cyclesIn(D, 1 / (f * Math.max(0.1, p.speed))));
    const wobble = (Math.sin(TAU * (k[0] * t) / D) * 0.5 + Math.sin(TAU * (k[1] * t) / D + 1.3) * 0.3 + Math.sin(TAU * (k[2] * t) / D + 2.1) * 0.2) * 0.5 + 0.5;
    const level = Math.max(0, p.brightness * (1 - p.amount + p.amount * wobble));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
    g.addColorStop(0, withAlpha(p.color, level));
    g.addColorStop(1, withAlpha(p.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
    ctx.restore();
  },
});

export const windowRain = defineObject({
  type: "window-rain",
  category: "particles",
  description: "Rain running down a window pane in the box x0..x1, y0..y1: beads of water and drops that slide down leaving a trail. Clip it to a window layer to keep it on the glass.",
  params: z.object({
    x0: num.default(0),
    y0: num.default(0),
    x1: num.default(1280),
    y1: num.default(720),
    intensity: num.default(1),
    color: color.default("#dfe9ff"),
    seed: z.number().int().default(29),
  }),
  draw(ctx, p, t, env) {
    const w = p.x1 - p.x0, h = p.y1 - p.y0, D = env.spec.meta.duration;
    if (w <= 0 || h <= 0 || p.intensity <= 0) return;
    const r = rng(p.seed);
    const beads = Array.from({ length: 140 }, () => ({ x: r(), y: r(), s: 0.6 + r() }));
    const runs = Array.from({ length: 30 }, () => ({ x: r(), ph: r(), runs: cyclesIn(D, 2.5 + r() * 4), s: 0.8 + r() * 0.8, wiggle: r() }));
    const scale = Math.min(w, h) / 300;
    ctx.save();
    ctx.beginPath(); ctx.rect(p.x0, p.y0, w, h); ctx.clip();
    for (const b of beads.slice(0, Math.round(80 * p.intensity))) {
      ctx.fillStyle = withAlpha(p.color, 0.25);
      ctx.beginPath(); ctx.arc(p.x0 + b.x * w, p.y0 + b.y * h, 1.2 * b.s * scale, 0, TAU); ctx.fill();
    }
    for (const d of runs.slice(0, Math.round(14 * p.intensity))) {
      // a drop runs down the pane, waits, and runs again: a whole number of times per scene
      const q = mod((d.runs * t) / D + d.ph, 1), slide = Math.min(1, q / 0.6);
      const x = p.x0 + d.x * w + Math.sin(TAU * slide * 2 + d.wiggle * TAU) * 3 * scale;
      const y = p.y0 - 10 + slide * (h + 20);
      ctx.strokeStyle = withAlpha(p.color, 0.18 * (1 - q));
      ctx.lineWidth = 1.4 * d.s * scale;
      ctx.beginPath(); ctx.moveTo(x, p.y0 - 10 + Math.max(0, slide - 0.25) * (h + 20)); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = withAlpha(p.color, 0.55 * (1 - q * 0.6));
      ctx.beginPath(); ctx.arc(x, y, 2.4 * d.s * scale, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
});
