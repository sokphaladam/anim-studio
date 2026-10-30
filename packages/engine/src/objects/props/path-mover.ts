import { EASE } from "../../tracks";
import { getObject } from "../../registry";
import { defineObject, z, num, clamp } from "../common";

const pt = z.tuple([num, num]);

export const pathMover = defineObject({
  type: "path-mover",
  category: "props",
  description: "Moves any small prop (e.g. leaf, pumpkin) along a cubic Bézier from `from` to `to` between `start` and `end` seconds, with optional side wobble and spin; it stays at `to` afterwards.",
  params: z
    .object({
      prop: z.string(),
      propParams: z.record(z.string(), z.unknown()).default({}),
      start: z.number().min(0),
      end: z.number().min(0),
      from: pt,
      c1: pt,
      c2: pt,
      to: pt,
      /** Side-to-side sway in units, shrinking to 0 on arrival. */
      wobble: num.default(0),
      /** Total rotation in radians over the trip. */
      spin: num.default(0),
      /** Extra vertical offset, e.g. to ride along with whatever it landed on. */
      offsetY: num.default(0),
    })
    .superRefine((p, ctx) => {
      const def = getObject(p.prop);
      if (!def) ctx.addIssue({ code: "custom", path: ["prop"], message: `Unknown prop type "${p.prop}"` });
      else {
        const r = def.params.safeParse({ x: 0, y: 0, ...p.propParams });
        if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", path: ["propParams", ...i.path.map(String)], message: i.message });
      }
      if (p.end <= p.start) ctx.addIssue({ code: "custom", path: ["end"], message: "end must be after start" });
    }),
  draw(ctx, p, t, env) {
    if (t < p.start) return;
    const k = clamp((t - p.start) / (p.end - p.start), 0, 1);
    const e = EASE.inOut(k);
    const u = 1 - e;
    const bez = (a: number, b: number, c: number, d: number) => u * u * u * a + 3 * u * u * e * b + 3 * u * e * e * c + e * e * e * d;
    const x = bez(p.from[0], p.c1[0], p.c2[0], p.to[0]) + Math.sin(k * Math.PI * 5) * p.wobble * (1 - k);
    const y = bez(p.from[1], p.c1[1], p.c2[1], p.to[1]) + p.offsetY;
    const rot = k < 1 ? k * p.spin + Math.sin(k * 20) * 0.4 : p.spin + 0.4;
    ctx.translate(x, y);
    ctx.rotate(rot);
    env.drawObject(p.prop, env.raw.propParams as Record<string, unknown>, { x: 0, y: 0 });
  },
});
