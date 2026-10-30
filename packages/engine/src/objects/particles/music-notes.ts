import { defineObject, z, num, color, mod, withAlpha } from "../common";

export const musicNotes = defineObject({
  type: "music-notes",
  category: "particles",
  description: "Music notes that rise and fade in a 3-second loop, e.g. above a record player.",
  params: z.object({ x: num, y: num, count: z.number().int().min(1).max(20).default(5), color: color.default("#fbeedd") }),
  draw(ctx, p, t) {
    ctx.font = "600 26px Georgia, serif";
    ctx.textAlign = "center";
    for (let i = 0; i < p.count; i++) {
      const ph = mod(t + i * 0.6, 3) / 3;
      ctx.fillStyle = withAlpha(p.color, Math.sin(ph * Math.PI) * 0.8);
      ctx.fillText(i % 2 ? "♫" : "♪", p.x + ph * 90 + Math.sin(ph * 6 + i) * 14, p.y - ph * 170);
    }
  },
});
