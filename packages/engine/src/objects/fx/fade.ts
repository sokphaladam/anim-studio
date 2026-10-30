import { defineObject, z, num } from "../common";

export const fade = defineObject({
  type: "fade",
  category: "fx",
  description: "Fades the whole frame from black; reveal 0 = black, 1 = fully visible.",
  params: z.object({ reveal: num.default(1) }),
  draw(ctx, p, _t, env) {
    ctx.fillStyle = `rgba(10,5,10,${1 - p.reveal})`;
    ctx.fillRect(0, 0, env.width, env.height);
  },
});
