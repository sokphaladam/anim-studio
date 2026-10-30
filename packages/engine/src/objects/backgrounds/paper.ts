import { defineObject, z, color } from "../common";

export const paper = defineObject({
  type: "paper",
  category: "backgrounds",
  description: "Plain solid-color background filling the whole frame.",
  params: z.object({ color: color.default("#ffffff") }),
  draw(ctx, p, _t, env) {
    ctx.fillStyle = p.color;
    ctx.fillRect(-env.width, -env.height, env.width * 3, env.height * 3);
  },
});
