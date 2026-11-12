// Renders reference/autumn-window.html and our engine (/render/autumn-window) at the same times and reports pixel differences.
// Usage: npm run dev (in another terminal), then: node scripts/compare-reference.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./browser.mjs";

const BASE = process.env.APP_URL ?? "http://localhost:5173";
const out = resolve(process.argv[2] ?? "screenshots/compare");
mkdirSync(out, { recursive: true });
const TIMES = [0.6, 2.3, 4.0, 5.5, 7.0, 8.3, 9.2, 10.6, 11.5];

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

const ref = await ctx.newPage();
await ref.addInitScript(() => (window.requestAnimationFrame = () => 0)); // stop its own clock; we call render(t)
await ref.goto("file://" + resolve("reference/autumn-window.html"));
await ref.evaluate(() => document.fonts.ready);

const eng = await ctx.newPage();
await eng.goto(`${BASE}/render/autumn-window?w=1920&h=1080`);
await eng.waitForFunction(() => window.renderReady === true);

const grab = (page, fn, t) => page.evaluate(([fn, t]) => { window[fn](t); return document.querySelector("canvas").toDataURL("image/png"); }, [fn, t]);
const diffPage = await ctx.newPage();
let worst = 0;
for (const t of TIMES) {
  const a = await grab(ref, "render", t);
  const b = await grab(eng, "renderFrame", t);
  writeFileSync(`${out}/ref-${t}.png`, Buffer.from(a.split(",")[1], "base64"));
  writeFileSync(`${out}/engine-${t}.png`, Buffer.from(b.split(",")[1], "base64"));
  const r = await diffPage.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = new OffscreenCanvas(ia.width, ia.height), g = c.getContext("2d");
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
    g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, off = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      sum += d; if (d > 24) off++;
    }
    return { mean: sum / (da.length / 4), offPct: (off / (da.length / 4)) * 100 };
  }, [a, b]);
  worst = Math.max(worst, r.offPct);
  console.log(`t=${t.toFixed(1)}s  mean diff ${r.mean.toFixed(3)}/255  pixels off >24: ${r.offPct.toFixed(3)}%`);
}
await browser.close();
console.log(`frames saved to ${out}`);
process.exit(worst > 0.5 ? 1 : 0);
