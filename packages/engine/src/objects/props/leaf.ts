import { defineObject, z, num, color, leafShape } from "../common";

export const leaf = defineObject({
  type: "leaf",
  category: "props",
  description: "A single autumn leaf; pair with path-mover to make it drift along a path.",
  params: z.object({ x: num.default(0), y: num.default(0), size: num.default(13), rotation: num.default(0), color: color.default("#e8572a") }),
  draw(ctx, p) {
    leafShape(ctx, p.x, p.y, p.size, p.rotation, p.color);
  },
});
