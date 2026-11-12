// Draws a short lofi loop by hand in the real editor, the way a user would: a girl dozing at a table at night,
// eyes that close and open (frame by frame), a steam flipbook and twinkling stars; then plays, scrubs and exports it.
// GPU-free: starts its own API (temp data) and Vite. Usage: node scripts/lofi-draw-e2e.mjs [outDir]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const API_PORT = "8797", WEB_PORT = "5177", BASE = `http://localhost:${WEB_PORT}`;
const out = resolve(process.argv[2] ?? "screenshots/lofi");
mkdirSync(out, { recursive: true });

const procs = [];
const start = (args, cwd) => procs.push(spawn("npm", args, { cwd, env: { ...process.env, API_PORT }, stdio: "ignore", shell: true }));
const stop = () => procs.forEach((p) => (process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"]) : p.kill()));
async function up(url) {
  for (let i = 0; i < 120; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't start`);
}
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};

// palette: two tones, like a screen-printed lofi frame
const NIGHT = "#121018", TAN = "#c99a66", CREAM = "#ead8b8", INK = "#0b0a0f";
const FPS = 12, SECONDS = 6;

start(["exec", "--", "tsx", "test/fake-layered-server.ts"], resolve(root, "apps/server"));
start(["exec", "--", "vite", "--port", WEB_PORT, "--strictPort"], resolve(root, "apps/web"));
let browser;
try {
  browser = await launch();
  await up(`http://127.0.0.1:${API_PORT}/api/health/painter`);
  await up(BASE);
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const state = (fn, arg) => page.evaluate(fn, arg);
  await page.getByRole("button", { name: "Create blank scene" }).click();
  await page.waitForTimeout(400);

  // 12 fps, 6 seconds
  await page.getByRole("menuitem", { name: "Animation" }).click();
  await page.getByRole("menuitem", { name: `${FPS} fps` }).click();
  const len = page.getByRole("textbox", { name: "Length" });
  await len.fill(String(SECONDS));
  await len.press("Enter");
  await len.evaluate((e) => e.blur());

  const box = await page.getByRole("img", { name: /Scene canvas/ }).boundingBox();
  const W = 1280, H = 720;
  const P = (x, y) => [box.x + (x / W) * box.width, box.y + (y / H) * box.height];
  const color = async (hex) => {
    const f = page.getByLabel("Hex color");
    await f.fill(hex.slice(1));
    await f.press("Enter");
    // leave the field, or the next shortcut (b, f, ., Home) is typed into it
    await f.evaluate((e) => e.blur());
  };
  const size = async (px) => {
    const f = page.getByRole("textbox", { name: "Size" });
    await f.fill(String(px));
    await f.press("Enter");
    await f.evaluate((e) => e.blur());
  };
  /** One pen stroke through scene points, with varying pressure-free mouse input. */
  const stroke = async (pts) => {
    await page.mouse.move(...P(...pts[0]));
    await page.mouse.down();
    // move like a hand does: many small steps, not jumps between corners (the brush smooths sparse input into curves)
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = P(...pts[i - 1]), [x1, y1] = P(...pts[i]);
      await page.mouse.move(x1, y1, { steps: Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4)) });
    }
    await page.mouse.up();
  };
  const dot = async (x, y) => stroke([[x, y], [x + 0.5, y]]);
  const ellipse = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 40) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
  const poly = (pts, closed = true) => (closed ? [...pts, pts[0]] : pts);
  // a smooth curve through control points (Catmull-Rom), sampled finely so the brush follows it
  const curve = (pts, n = 10) => {
    const outPts = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        outPts.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
      }
    }
    outPts.push(pts.at(-1));
    return outPts;
  };
  const fill = async (hex, x, y) => {
    await page.keyboard.press("f");
    await color(hex);
    await page.mouse.click(...P(x, y));
    await page.keyboard.press("b");
  };
  const toFrame = async (f) => {
    await page.keyboard.press("Home");
    for (let i = 0; i < f; i++) await page.keyboard.press("Period");
  };
  const newLayer = async () => {
    await page.keyboard.press("Home");
    await page.keyboard.press("ControlOrMeta+Shift+n");
    await page.waitForTimeout(100);
  };

  // ── background layer: night fill, a crescent moon
  await page.keyboard.press("b");
  await fill(NIGHT, 640, 360);
  await color(CREAM);
  await size(6);
  await stroke(curve([[178, 92], [160, 110], [162, 136], [184, 150], [168, 128], [170, 106], [178, 92]], 8));
  await fill(CREAM, 168, 122);

  // ── stars: 12 drawings, one every half second, half of them twinkling on and off
  await newLayer();
  const starsLayer = await state(() => window.studio.getState().selected);
  const stars = [[90, 210], [260, 60], [330, 180], [420, 110], [700, 70], [760, 200], [960, 90], [1040, 240], [1150, 130], [1210, 300], [880, 330], [120, 380], [990, 400], [610, 150]];
  await color(CREAM);
  for (let k = 0; k < 12; k++) {
    await toFrame(k * (FPS / 2));
    for (const [i, [x, y]] of stars.entries()) {
      // even stars stay; odd ones are on in every other drawing (bigger, so the twinkle shows)
      if (i % 2 === 0 || (i + k) % 2 === 0) {
        await size(i % 2 === 0 ? 4 : 7);
        await dot(x, y);
      }
    }
  }

  // ── the girl and the table, one drawing held for the whole scene
  await newLayer();
  const girl = await state(() => window.studio.getState().selected);
  await toFrame(0);
  await color(TAN);
  await size(4);
  // hair (outline, filled ink later), falling to the shoulders
  const hair = curve([[520, 168], [452, 190], [420, 260], [414, 360], [402, 460], [378, 560], [440, 560], [452, 470], [470, 400], [520, 412], [570, 400], [588, 470], [600, 560], [662, 560], [638, 460], [626, 360], [620, 260], [588, 190], [520, 168]], 8);
  await stroke(hair);
  // face
  await stroke(curve([[462, 262], [460, 320], [480, 372], [520, 394], [560, 372], [580, 320], [578, 262]], 8));
  // straight fringe with a jagged edge
  await stroke(poly([[462, 262], [474, 290], [490, 270], [504, 294], [520, 272], [536, 296], [552, 270], [566, 292], [578, 262]], false));
  // neck and shoulders down to the table
  await stroke([[500, 392], [500, 420], [440, 446], [400, 500], [380, 620]]);
  await stroke([[540, 392], [540, 420], [600, 446], [640, 500], [660, 620]]);
  // dress neckline
  await stroke(curve([[452, 470], [490, 500], [520, 520], [550, 500], [588, 470]], 8));
  // table
  await size(36);
  await stroke([[0, 640], [1280, 640]]);
  // fills: face and skin tan, hair and dress ink
  await fill(TAN, 520, 330);
  await fill(TAN, 520, 450);
  await fill(INK, 436, 330);
  await fill(INK, 604, 330);
  await fill(INK, 520, 220);
  await fill(INK, 520, 580);
  // arm lying on the table and the arm propping her cheek
  await color(TAN);
  await size(34);
  await stroke(curve([[330, 610], [420, 606], [520, 612], [600, 614]], 8));
  await stroke(curve([[640, 612], [626, 520], [600, 430], [580, 372]], 8));
  await size(30);
  await stroke(ellipse(574, 356, 14, 18, 0, Math.PI * 2, 16));
  // mouth, blush line, collar
  await color(INK);
  await size(3);
  await stroke(curve([[508, 366], [520, 370], [532, 366]], 6));
  await size(6);
  await stroke(curve([[496, 404], [520, 410], [544, 404]], 6));
  // the coffee cup
  await color(CREAM);
  await size(4);
  await stroke(poly([[790, 540], [870, 540], [862, 622], [798, 622]]));
  await fill(CREAM, 830, 580);
  await color(TAN);
  await size(8);
  await stroke([[784, 538], [876, 538]]);

  // ── eyes, frame by frame: open, half, closed (dozing), half, open
  await newLayer();
  const eyes = await state(() => window.studio.getState().selected);
  const L = [494, 318], R = [548, 318];
  const openEyes = async () => {
    for (const [x, y] of [L, R]) {
      await color(INK); await size(10);
      await stroke(ellipse(x, y, 11, 7, 0, Math.PI * 2, 20));
      await color(CREAM); await size(4);
      await dot(x + 3, y - 2);
      await color(INK); await size(3);
      await stroke(curve([[x - 15, y - 9], [x, y - 13], [x + 15, y - 9]], 6));
    }
  };
  const halfEyes = async () => {
    for (const [x, y] of [L, R]) {
      await color(INK); await size(6);
      await stroke(ellipse(x, y + 2, 11, 3, 0, Math.PI * 2, 16));
      await size(3);
      await stroke(curve([[x - 14, y - 2], [x, y - 6], [x + 14, y - 2]], 6));
    }
  };
  const closedEyes = async () => {
    await color(INK);
    await size(3);
    for (const [x, y] of [L, R]) await stroke(curve([[x - 13, y], [x, y + 6], [x + 13, y]], 6));
  };
  const EYES = [[0, openEyes], [24, halfEyes], [27, closedEyes], [54, halfEyes], [57, openEyes]];
  for (const [f, draw] of EYES) {
    await toFrame(f);
    await draw();
  }

  // ── steam: a hand-drawn flipbook, a new drawing every 3 frames; the wave climbs two full cycles per loop
  await newLayer();
  const steam = await state(() => window.studio.getState().selected);
  await page.locator(".dv-tab", { hasText: "Brush presets" }).click();
  await page.getByRole("radio", { name: "Wash" }).click();
  await page.locator(".dv-tab", { hasText: "Color" }).click();
  await color(CREAM);
  await size(14);
  const STEPS = (SECONDS * FPS) / 3;
  for (let k = 0; k < STEPS; k++) {
    await toFrame(k * 3);
    const ph = (2 * Math.PI * 2 * k) / STEPS;
    for (const [dx, amp, top, w] of [[0, 18, 300, 14], [16, 12, 380, 8]]) {
      await size(w);
      const pts = [];
      for (let y = 532; y >= top; y -= 12) {
        const u = (532 - y) / (532 - top);
        pts.push([830 + dx + Math.sin(u * 7 - ph) * amp * (0.4 + u), y]);
      }
      await stroke(pts);
    }
  }

  // ── checks
  const keys = (id) => state((id) => window.studio.getState().spec.layers.find((l) => l.id === id)?.frames?.map((f) => +f.start.toFixed(3)) ?? [], id);
  check((await keys(starsLayer)).length === 12, `stars: 12 twinkle drawings (${(await keys(starsLayer)).join(", ")})`);
  check((await keys(girl)).length === 1, "girl and table: one held drawing");
  check(JSON.stringify(await keys(eyes)) === JSON.stringify(EYES.map(([f]) => +(f / FPS).toFixed(3))), `eyes: open → closed → open at ${(await keys(eyes)).join(", ")} s`);
  check((await keys(steam)).length === STEPS, `steam: ${STEPS}-drawing flipbook`);
  const strokes = await state(() => window.studio.getState().spec.layers.reduce((n, l) => n + (l.frames ?? []).reduce((m, f) => m + f.strokes.length, 0), 0));
  check(strokes > 150, `${strokes} strokes drawn`);

  // play and scrub: the canvas changes as it plays, and each time shows the same picture whenever you come back to it
  const frame = (t) =>
    page.evaluate(async (t) => {
      window.studio.getState().set({ t, playing: false });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector('canvas[role="img"]').toDataURL();
    }, t);
  const times = [0.5, 2.1, 3.2, 4.6, 5.5];
  const shots = [];
  for (const t of times) {
    shots.push(await frame(t));
    await page.getByRole("img", { name: /Scene canvas/ }).screenshot({ path: `${out}/lofi-${t}s.png` });
  }
  check(new Set(shots).size === shots.length, "every sampled moment looks different (steam, stars, eyes)");
  check((await frame(3.2)) === shots[2] && (await frame(0.5)) === shots[0], "scrubbing back gives identical pixels");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const playedTo = await state(() => window.studio.getState().t);
  await page.keyboard.press("Enter");
  check(playedTo > 1, `plays in real time (${playedTo.toFixed(2)} s after 1.5 s)`);

  // export the drawn animation
  await page.keyboard.press("ControlOrMeta+e");
  const dialog = page.getByRole("dialog", { name: "Export MP4" });
  await dialog.getByRole("radio", { name: /YouTube/ }).click();
  await dialog.getByRole("button", { name: "Export" }).click();
  const link = dialog.getByRole("link", { name: "Download" });
  await link.waitFor({ timeout: 180000 });
  const res = await page.request.get(`${BASE}${await link.getAttribute("href")}`);
  const mp4 = await res.body();
  writeFileSync(`${out}/lofi.mp4`, mp4);
  check(res.ok() && mp4.subarray(4, 8).toString() === "ftyp", `exported ${SECONDS * 30} frames at 1920×1080 (${(mp4.length / 1024).toFixed(0)} KB) → ${out}/lofi.mp4`);
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${out}/lofi-editor.png` });
  check(!errors.length, errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
} finally {
  await browser?.close();
  stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
