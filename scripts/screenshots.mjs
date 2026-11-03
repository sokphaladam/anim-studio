// Screenshots of every screen at the sizes the polish checklist names. Usage: pnpm dev, then: node scripts/screenshots.mjs [outDir]
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://localhost:5173";
const out = resolve(process.argv[2] ?? "screenshots");
mkdirSync(out, { recursive: true });
// Windows display scaling shrinks the CSS viewport: a 1920×1080 screen at 150% gives the app 1280×720 CSS pixels
const SIZES = [
  { name: "1366x768", width: 1366, height: 768, scale: 1 },
  { name: "1366x768@125", width: 1093, height: 614, scale: 1.25 },
  { name: "1920x1080", width: 1920, height: 1080, scale: 1 },
  { name: "1920x1080@150", width: 1280, height: 720, scale: 1.5 },
  { name: "2560x1440", width: 2560, height: 1440, scale: 1 },
];

const browser = await launch();
const errors = [];
for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.scale });
  page.on("pageerror", (e) => errors.push(`${s.name}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${s.name}: ${m.text()}`));
  const shot = (n) => page.screenshot({ path: `${out}/${n}-${s.name}.png` });
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(600);
  await shot("welcome");

  await page.getByRole("button", { name: /Autumn window/ }).click();
  await page.waitForTimeout(500);
  for (let i = 0; i < 249; i++) await page.keyboard.press("Period"); // frame 249 at 30 fps = 8.3s
  await page.waitForTimeout(300);
  await shot("editor");

  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(200);
  await shot("palette");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await page.keyboard.press("Shift+?");
  await page.waitForTimeout(200);
  await shot("shortcuts");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  await page.getByRole("menuitem", { name: "File" }).click();
  await page.waitForTimeout(150);
  await shot("menu");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  await page.keyboard.press("ControlOrMeta+e");
  await page.waitForTimeout(250);
  await shot("export");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);

  await page.getByRole("menuitem", { name: "File" }).click();
  await page.getByRole("menuitem", { name: "New blank scene" }).click();
  await page.waitForTimeout(400);
  await shot("editor-empty");
  await page.close();
}
await browser.close();
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
console.log(`saved to ${out}`);
