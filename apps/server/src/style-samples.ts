// Paints the sample picture each style card on the start page shows: the same scene and seed in every style.
// Usage: npm run samples:styles [style ...]. Writes apps/web/public/styles/<style>.webp (needs ComfyUI, ~30 s a style).
import { comfyui, paintingPrompts, PAINT_SIZE, STYLES, type StyleId } from "@anim/ai";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
if (existsSync(root + ".env")) process.loadEnvFile(root + ".env");
const SCENE = "Golden sunset, a girl with headphones sitting by a big open window in her room, looking out at the city and the sky";
const SEED = 7;
const out = join(root, "apps", "web", "public", "styles");
mkdirSync(out, { recursive: true });
const painter = comfyui({ url: process.env.COMFY_URL || "http://127.0.0.1:8188", dir: process.env.COMFY_DIR || join(root, "data", "comfyui") });
const [width, height] = PAINT_SIZE["16:9"];
const wanted = process.argv.slice(2) as StyleId[];

for (const style of wanted.length ? wanted : (Object.keys(STYLES) as StyleId[])) {
  if (!(style in STYLES)) throw new Error(`Unknown style "${style}"; known: ${Object.keys(STYLES).join(", ")}`);
  const { paint } = paintingPrompts(SCENE, style);
  const png = await painter.paint({ ...paint, width, height, seed: SEED });
  // a card is ~300 px wide: 480x274 keeps it sharp on high-DPI screens at ~20 KB
  const c = createCanvas(480, 274);
  c.getContext("2d").drawImage(await loadImage(Buffer.from(png)), 0, 0, 480, 274);
  writeFileSync(join(out, `${style}.webp`), c.toBuffer("image/webp", 82));
  console.log(`${style} → apps/web/public/styles/${style}.webp`);
}
