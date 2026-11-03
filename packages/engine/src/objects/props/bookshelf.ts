import { rng } from "../../rng";
import { defineObject, z, num, color, rrect } from "../common";

const SPINES = ["#8c3b3b", "#c98a3d", "#3f6b5c", "#4a5f8c", "#7a4f7d", "#d8c39a", "#5b4636", "#a35d3b"];

export const bookshelf = defineObject({
  type: "bookshelf",
  category: "props",
  description: "Wooden bookshelf standing on the floor (x, y = bottom-left corner) with `shelves` rows of books; `seed` picks the books.",
  params: z.object({
    x: num,
    y: num,
    width: num.default(200),
    height: num.default(260),
    shelves: z.number().int().min(1).max(8).default(4),
    wood: color.default("#5a3a28"),
    seed: z.number().int().default(3),
  }),
  draw(ctx, p) {
    const r = rng(p.seed);
    const { width: W, height: H } = p;
    const side = Math.max(6, W * 0.05), row = (H - side) / p.shelves;
    ctx.translate(p.x, p.y - H);
    ctx.fillStyle = p.wood;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(side, side, W - 2 * side, H - 2 * side);
    for (let s = 0; s < p.shelves; s++) {
      const floor = side + row * (s + 1);
      let bx = side + 2;
      while (bx < W - side - 6) {
        const bw = Math.min(W - side - 2 - bx, 7 + r() * 12);
        const bh = row * (0.55 + r() * 0.35);
        const lean = r() < 0.08 && bw > 10;
        ctx.save();
        ctx.translate(bx, floor - side * 0.5);
        if (lean) ctx.rotate(-0.15);
        ctx.fillStyle = SPINES[Math.floor(r() * SPINES.length)];
        rrect(ctx, 0, -bh, bw - 1, bh, 1.5);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.18)";
        ctx.fillRect(1, -bh * 0.8, bw - 3, 2);
        ctx.restore();
        bx += bw + (lean ? 4 : 0);
        if (r() < 0.06) bx += 14;
      }
      ctx.fillStyle = p.wood;
      ctx.fillRect(0, floor - side * 0.5, W, side * 0.6);
    }
  },
});
