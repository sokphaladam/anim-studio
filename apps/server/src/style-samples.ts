// Paints the art-tradition picker's sample cards into apps/web/public/styles/<id>.jpg with the local painter.
// Usage (painter installed): pnpm style-samples [style ids…]. Same subject for every style, so the cards compare styles.
import { CHECKPOINT, comfyui, paintPrompt } from "@anim/ai";
import { ART_STYLES, STYLE_IDS, type StyleId } from "@anim/spec";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = `${root}apps/web/public/styles`;
const SUBJECT = "1girl, solo, headphones, sitting by a large window, looking outside, cozy room, plants, desk, evening, city in the distance, wide shot";
const painter = comfyui({ url: process.env.COMFY_URL || "http://127.0.0.1:8188", dir: process.env.COMFY_DIR || `${root}data/comfyui` });
const ids = (process.argv.slice(2).length ? process.argv.slice(2) : STYLE_IDS) as StyleId[];

mkdirSync(out, { recursive: true });
console.log(`painting ${ids.length} sample(s) with ${CHECKPOINT}`);
for (const id of ids) {
  const s = ART_STYLES[id];
  const t0 = Date.now();
  const png = await painter.paint({ positive: paintPrompt(SUBJECT, s.paint.positive), negative: s.paint.negative, model: s.paint.model, width: 1344, height: 768, seed: 20261031 });
  // cards are small: 480 px wide JPEGs keep the web app light
  const img = await loadImage(Buffer.from(png));
  const c = createCanvas(480, Math.round((480 * img.height) / img.width));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  writeFileSync(`${out}/${id}.jpg`, c.toBuffer("image/jpeg", 82));
  console.log(`${id}: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
