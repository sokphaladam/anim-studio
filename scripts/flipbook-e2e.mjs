// Milestone 2 check: draw a 12-frame flipbook, onion skin, play at 12 fps, undo. Usage: pnpm dev, then node scripts/flipbook-e2e.mjs [outDir]
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://localhost:5173";
const out = resolve(process.argv[2] ?? "screenshots");
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByRole("button", { name: "Create blank scene" }).click();
await page.waitForTimeout(400);

await page.getByRole("menuitem", { name: "Animation" }).click();
await page.getByRole("menuitem", { name: "12 fps" }).click();

const box = await page.getByRole("img", { name: /Scene canvas/ }).boundingBox();
const clock = () => page.evaluate(() => document.querySelector(".font-mono .text-fg")?.textContent);
for (let f = 0; f < 12; f++) {
  // a ball moving right and bouncing: one closed loop per frame
  const cx = box.x + box.width * (0.15 + f * 0.06), cy = box.y + box.height * (0.7 - Math.abs(Math.sin((f / 12) * Math.PI * 2)) * 0.4), r = box.height * 0.06;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let a = 1; a <= 24; a++) await page.mouse.move(cx + Math.cos((a / 24) * Math.PI * 2) * r, cy + Math.sin((a / 24) * Math.PI * 2) * r);
  await page.mouse.up();
  if (f < 11) await page.keyboard.press("Period");
}
await page.keyboard.press("f");
await page.mouse.click(box.x + box.width * (0.15 + 11 * 0.06), box.y + box.height * (0.7 - Math.abs(Math.sin((11 / 12) * Math.PI * 2)) * 0.4));
await page.keyboard.press("b");
await page.keyboard.press("o");
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/flipbook-onion.png` });

const history = () => page.evaluate(() => window.studio.getState().past.length);
await page.locator(".dv-tab", { hasText: "History" }).click();
console.log("history entries after drawing:", await history());
const drawn = await page.locator("[data-key-frame]").count();
console.log("drawing frames in timeline:", drawn);

await page.keyboard.press("Home");
await page.keyboard.press("Enter");
await page.waitForTimeout(1000);
console.log("clock after ~1s of play at 12 fps:", await clock());
await page.keyboard.press("Enter");

await page.keyboard.press("ControlOrMeta+z");
await page.keyboard.press("ControlOrMeta+z");
await page.waitForTimeout(200);
console.log("drawing frames after 2 undos:", await page.locator("[data-key-frame]").count());
await page.keyboard.press("ControlOrMeta+Shift+z");
console.log("after redo:", await page.locator("[data-key-frame]").count());
await page.screenshot({ path: `${out}/flipbook-after-undo.png` });
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
