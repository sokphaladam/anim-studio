// Layered generation check, GPU-free: welcome screen → stage progress → Layers docker (select, hide, reorder, transform, pivot)
// → look_at keyframes on the timeline → scrub phases → deterministic frames → save and reopen → export MP4.
// Starts its own API (canned plan + fake painter, temp data) and Vite on spare ports. Usage: node scripts/layered-e2e.mjs [outDir]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./browser.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const API_PORT = "8799", WEB_PORT = "5179", BASE = `http://localhost:${WEB_PORT}`;
const out = resolve(process.argv[2] ?? "screenshots");
mkdirSync(out, { recursive: true });

const procs = [];
const start = (args, cwd) => {
  const p = spawn("pnpm", args, { cwd, env: { ...process.env, API_PORT }, stdio: "ignore", shell: true });
  procs.push(p);
};
// wait for taskkill: process.exit right after would leave the servers holding the ports for the next run
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

start(["exec", "tsx", "test/fake-layered-server.ts"], resolve(root, "apps/server"));
start(["exec", "vite", "--port", WEB_PORT, "--strictPort"], resolve(root, "apps/web"));
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
  const state = (fn) => page.evaluate(fn);

  // new project: Layered animation is offered beside the other modes
  await page.getByLabel("Describe an animation").fill("A girl is sleeping on a balcony at night. Create a 6-second animation. At 3 seconds, she wakes up and looks at the clock.");
  const duration = page.getByRole("textbox", { name: "Duration" });
  await duration.fill("6");
  await duration.press("Enter");
  check(!(await page.getByText("Art tradition").count()), "no art tradition picker");
  check(!(await page.getByRole("radio", { name: /Vector|Painted|Animated video/ }).count()), "no generation mode choice: every AI scene is layered");
  await page.getByRole("button", { name: "Generate with AI" }).click();

  // progress: stages and per-asset status, while the scene stays unchanged
  await page.getByRole("list", { name: "Assets" }).waitFor({ timeout: 30000 });
  check(await page.getByRole("list", { name: "Layered generation stages" }).isVisible(), "stage progress is shown");
  await page.screenshot({ path: `${out}/layered-progress.png` });
  check((await state(() => window.studio.getState().spec.layers.length)) === 0, "scene is untouched until the layers are done");
  await page.waitForFunction(() => ["done", "error"].includes(window.studio.getState().generation?.status), null, { timeout: 120000 });
  check((await state(() => window.studio.getState().generation.status)) === "done", "generation finished");
  await page.evaluate(() => window.studio.getState().set({ playing: false, t: 0 }));

  // Layers docker: rig hierarchy
  const ids = await state(() => window.studio.getState().spec.layers.map((l) => l.id));
  check(JSON.stringify(ids) === JSON.stringify(["balcony_background", "clock", "girl", "girl_body", "girl_head"]), `separate background, clock and character-part layers (${ids.join(", ")})`);
  const layersList = page.getByRole("listbox", { name: "Layers" });
  const row = (id) => layersList.getByRole("option").filter({ has: page.locator(`span[title^="${id} ("]`) });
  check(await row("girl_head").isVisible(), "girl_head appears in the Layers docker");
  await page.screenshot({ path: `${out}/layered-editor.png` });

  // select the head: pivot fields; nudge the pivot
  await row("girl_head").click();
  const pivotX = page.getByLabel("Pivot X");
  check(await pivotX.isVisible(), "pivot adjustment is offered for the rigged head");
  const before = await state(() => window.studio.getState().spec.layers.find((l) => l.id === "girl_head").pivot[0]);
  await pivotX.fill(String(Math.round(before) + 4));
  await pivotX.press("Enter");
  const after = await state(() => window.studio.getState().spec.layers.find((l) => l.id === "girl_head").pivot[0]);
  check(Math.round(after) === Math.round(before) + 4, `pivot moved (${before} → ${after})`);

  // timeline: the look_at became keyframes on the head row
  const keys = await state(() => {
    const s = window.studio.getState().spec;
    const look = s.actions.find((a) => a.type === "look_at" && a.part === "girl_head");
    return look ? s.tracks[look.tracks.rotation].keys.map((k) => k[0]) : [];
  });
  check(keys.includes(3) && keys.includes(5), `look_at keyframes at 3s and 5s (${keys.join(", ")})`);
  check((await page.locator(".rotate-45.bg-accent").count()) >= 2, "keyframe diamonds are drawn on the timeline");

  // scrub phases: same before 3s, turning 3–5s, held after 5s; and the same t always gives the same pixels
  const frame = (t) =>
    page.evaluate(async (t) => {
      window.studio.getState().set({ t, playing: false });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector('canvas[role="img"]').toDataURL();
    }, t);
  const [f29, f30, f40, f50, f59] = [await frame(2.9), await frame(3), await frame(4), await frame(5), await frame(5.9)];
  check(f29 === f30, "2.9s and 3.0s: still asleep");
  check(f40 !== f30 && f40 !== f50, "4.0s: turning toward the clock");
  check(f50 === f59, "5.0s and 5.9s: final pose held, no loop");
  check((await frame(4)) === f40 && (await frame(2.9)) === f29, "same t renders identical pixels after scrubbing around");
  await frame(5);
  await page.screenshot({ path: `${out}/layered-turned.png` });

  // hide, reorder and transform generated layers
  await row("clock").getByRole("button", { name: "Hide layer" }).click();
  check(await state(() => window.studio.getState().hidden.clock === true), "a generated layer can be hidden");
  await row("clock").getByRole("button", { name: "Show layer" }).click();
  // reorder with the keyboard (Layer › Move layer up); drag-to-reorder is the same moveLayer edit
  await row("clock").click();
  await page.keyboard.press("Control+BracketRight");
  await page.keyboard.press("Control+BracketRight");
  const order = await state(() => window.studio.getState().spec.layers.map((l) => l.id));
  check(order.indexOf("clock") > order.indexOf("girl_body"), `a generated layer can be reordered (${order.join(", ")})`);
  await row("clock").click();
  await page.keyboard.press("t");
  const canvas = await page.getByRole("img", { name: /Scene canvas/ }).boundingBox();
  const clock = await state(() => {
    const s = window.studio.getState().spec;
    const p = s.layers.find((l) => l.id === "clock").params;
    return { x: (p.x + p.w / 2) / s.meta.width, y: (p.y + p.h * 0.75) / s.meta.height };
  });
  await page.mouse.move(canvas.x + canvas.width * clock.x, canvas.y + canvas.height * clock.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * clock.x + 40, canvas.y + canvas.height * clock.y + 10, { steps: 5 });
  await page.mouse.up();
  const moved = await state(() => window.studio.getState().spec.layers.find((l) => l.id === "clock").transform);
  check(!!moved, `a generated layer can be transformed (${JSON.stringify(moved)})`);

  // save, reopen: assets, rig and keyframes intact
  const saved = await state(async () => {
    const { saveProject } = await import("/src/store/projects.ts");
    await saveProject("e2e");
    return window.studio.getState().spec;
  });
  await page.reload();
  await page.getByText(saved.meta.title).first().click();
  await page.waitForFunction(() => window.studio.getState().screen === "editor");
  const reopened = await state(() => window.studio.getState().spec);
  check(JSON.stringify(reopened.assets) === JSON.stringify(saved.assets), "assets survive save and reopen");
  check(JSON.stringify(reopened.layers) === JSON.stringify(saved.layers) && JSON.stringify(reopened.tracks) === JSON.stringify(saved.tracks) && JSON.stringify(reopened.actions) === JSON.stringify(saved.actions), "rig, keyframes and actions survive save and reopen");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/layered-reopened.png` });

  // export: File › Export MP4 (Ctrl+E), Draft preset, frame progress, then a playable MP4 to download
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+e");
  const dialog = page.getByRole("dialog", { name: "Export MP4" });
  await dialog.waitFor();
  await dialog.getByRole("radio", { name: /Draft/ }).click();
  check(await dialog.getByText("144 frames (6 s).").isVisible(), "export shows the frame count for the preset");
  await dialog.getByRole("button", { name: "Export" }).click();
  await dialog.getByRole("progressbar").waitFor({ timeout: 10000 }).catch(() => {});
  await page.screenshot({ path: `${out}/export-progress.png` });
  const link = dialog.getByRole("link", { name: "Download" });
  await link.waitFor({ timeout: 120000 });
  check(await dialog.getByText(/Done: 144 frames/).isVisible(), "export finished with every frame");
  const res = await page.request.get(`${BASE}${await link.getAttribute("href")}`);
  const mp4 = await res.body();
  check(res.ok() && res.headers()["content-type"] === "video/mp4" && mp4.subarray(4, 8).toString() === "ftyp", `the download is an MP4 (${mp4.length} bytes)`);
  await page.screenshot({ path: `${out}/export-done.png` });
  check(!errors.length, errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
} finally {
  await browser?.close();
  stop();
}
console.log(failed ? `${failed} check(s) failed` : "all checks passed");
process.exit(failed ? 1 : 0);
