import { defineObject, z, num } from "../common";

export const glow = defineObject({
  type: "glow",
  category: "fx",
  description: "Warm room light around a lamp that also darkens the room when the light is low; follows the lantern automatically when there is one.",
  params: z.object({ x: num.default(520), y: num.default(210), light: num.optional(), radius: num.default(620), dim: num.default(0.38) }),
  draw(ctx, p, _t, env) {
    const L = p.light ?? (env.shared.light as number | undefined) ?? 0;
    const [lx, ly] = (env.shared.lampPos as [number, number] | undefined) ?? [p.x, p.y];
    const W = env.width + 200, H = env.height + 200;
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(lx, ly, 10, lx, ly, p.radius);
    g.addColorStop(0, `rgba(255,180,100,${0.38 * L})`);
    g.addColorStop(0.35, `rgba(255,140,80,${0.12 * L})`);
    g.addColorStop(1, "rgba(255,120,60,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-100, -100, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(12,6,16,${p.dim * (1 - L)})`;
    ctx.fillRect(-100, -100, W, H);
  },
});
