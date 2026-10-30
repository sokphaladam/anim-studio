import type { Ctx2D } from "../registry";
export { num, color } from "@anim/spec";
export { z } from "zod";
export { defineObject } from "../registry";

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const mod = (a: number, n: number) => ((a % n) + n) % n;

export function rrect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function leafShape(ctx: Ctx2D, x: number, y: number, s: number, rot: number, fill: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.2);
  ctx.quadraticCurveTo(s * 1.1, -s * 0.6, s * 0.9, s * 0.2);
  ctx.quadraticCurveTo(s * 0.5, s * 0.3, 0, s);
  ctx.quadraticCurveTo(-s * 0.5, s * 0.3, -s * 0.9, s * 0.2);
  ctx.quadraticCurveTo(-s * 1.1, -s * 0.6, 0, -s * 1.2);
  ctx.fill();
  ctx.strokeStyle = "rgba(80,30,10,.45)";
  ctx.lineWidth = Math.max(1, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.9);
  ctx.lineTo(0, s * 1.5);
  ctx.stroke();
  ctx.restore();
}

/** "#rgb" / "#rrggbb" / "#rrggbbaa" → "rgba(r,g,b,a)" with the given alpha multiplied in. */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const a = h.length === 8 ? n(6) / 255 : 1;
  return `rgba(${n(0)},${n(2)},${n(4)},${a * alpha})`;
}
