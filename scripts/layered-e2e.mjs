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

  // Part check docker: the head's stages and checklist, a re-cut that keeps it in place, then undone
  await row("girl_head").click();
  await page.locator(".dv-tab", { hasText: "Part check" }).click();
  const stages = page.getByRole("list", { name: "Stages" });
  await stages.waitFor();
  check((await stages.getByRole("img").count()) >= 3, "part check shows original, mask and cut-out");
  check(await page.getByRole("list", { name: "Checks" }).getByText("edges").isVisible(), "part check lists the head's checks");
  const part = await state(() => ({ ...window.studio.getState().spec.assets.girl_head }));
  const grow = page.getByRole("textbox", { name: "Grow / shrink" });
  await grow.fill("-2");
  await grow.press("Enter");
  await page.getByRole("button", { name: "Re-cut from original" }).click();
  await page.waitForFunction((src) => window.studio.getState().spec.assets.girl_head.src !== src, part.src, { timeout: 15000 });
  const recut = await state(() => window.studio.getState().spec.assets.girl_head);
  check(recut.crop[0] > part.crop[0] && recut.cleanup.grow === -2, `re-cut shrinks the head crop (${part.crop} → ${recut.crop})`);
  await page.screenshot({ path: `${out}/layered-part-check.png` });
  await page.evaluate(() => window.studio.getState().undo());
  check((await state(() => window.studio.getState().spec.assets.girl_head.src)) === part.src, "re-cut is one undoable step");
  await page.locator(".dv-tab", { hasText: "Layers" }).click();
  check(await page.evaluate(() => !!window.studio.getState().spec.characters?.girl), "the girl's character profile is saved with the scene");

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

  // Rig docker: a skeleton on the girl, her body bent by the arm bones, IK on the forearm, then the target dragged
  // Layers and Rig share a tab group: pick the layer in Layers, then show Rig
  const rigOn = async (id) => {
    await page.locator(".dv-tab", { hasText: "Layers" }).click();
    await row(id).click();
    await page.locator(".dv-tab", { hasText: "Rig" }).click();
  };
  await rigOn("girl");
  await page.getByRole("button", { name: "Person", exact: true }).click();
  await page.getByRole("button", { name: "Add skeleton" }).click();
  await page.screenshot({ path: `${out}/layered-skeleton.png` });
  const bones = await state(() => window.studio.getState().spec.layers.filter((l) => l.type === "bone").map((l) => l.id));
  check(bones.includes("girl_bone_lower_arm_l") && bones.includes("girl_bone_foot_r"), `a person skeleton is added (${bones.length} bones)`);
  await rigOn("girl_body");
  for (const b of ["girl_bone_upper_arm_l", "girl_bone_lower_arm_l"]) await page.getByRole("list", { name: "Bones" }).getByLabel(b).check();
  check((await state(() => window.studio.getState().spec.layers.find((l) => l.id === "girl_body").mesh?.bones.length)) === 2, "the body is bent by the two arm bones");
  await rigOn("girl_bone_lower_arm_l");
  await page.getByRole("button", { name: "Add IK target at the end of this limb" }).click();
  const ik = await state(() => window.studio.getState().spec.ik?.[0]);
  check(ik?.upper === "girl_bone_upper_arm_l", `IK added on the arm (target ${ik?.target})`);
  const still = await frame(5);
  await page.keyboard.press("t");
  const tgt = await state(() => {
    const s = window.studio.getState().spec;
    const p = s.layers.find((l) => l.id === s.ik[0].target).pivot;
    return { x: p[0] / s.meta.width, y: p[1] / s.meta.height };
  });
  await page.mouse.move(canvas.x + canvas.width * tgt.x, canvas.y + canvas.height * tgt.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * tgt.x + 30, canvas.y + canvas.height * tgt.y - 40, { steps: 6 });
  await page.mouse.up();
  const bent = await frame(5);
  const dragged = await state(() => {
    const s = window.studio.getState();
    const l = s.spec.layers.find((x) => x.id === s.spec.ik[0].target);
    return JSON.stringify({ pivot: l.pivot, transform: l.transform, selected: s.selected, tool: s.tool, t: s.t });
  });
  check(bent !== still, `dragging the IK target bends the arm in the render (${dragged})`);
  await page.screenshot({ path: `${out}/layered-rig.png` });
  check(!(await page.getByRole("region", { name: "Rig check" }).count()) || (await page.getByRole("region", { name: "Rig check" }).getByLabel("error").count()) === 0, "rig check shows no errors");
  await page.locator(".dv-tab", { hasText: "Layers" }).click();

  // Face & pose docker: a pose preset, the turn warning, a painted side view, and a view key that answers the warning
  const faceOn = async (id) => {
    await page.locator(".dv-tab", { hasText: "Layers" }).click();
    await row(id).click();
    await page.locator(".dv-tab", { hasText: "Face & pose" }).click();
  };
  await page.evaluate(() => window.studio.getState().set({ t: 1, playing: false }));
  await faceOn("girl");
  await page.getByRole("button", { name: "sipping", exact: true }).click();
  const sip = await state(() => {
    const s = window.studio.getState().spec;
    const r = s.layers.find((l) => l.id === "girl_bone_lower_arm_l").transform?.rotation;
    return typeof r === "string" ? s.tracks[r.slice(1)].keys : null;
  });
  check(!!sip && sip.some(([, v]) => Math.abs(v + 1.6) < 1e-6), `the sipping pose keys the forearm (${JSON.stringify(sip)})`);
  const notes = page.getByRole("region", { name: "Notes" });
  check(await notes.getByText(/a flat head can turn/).isVisible(), "the head turn toward the clock is flagged");
  await page.getByRole("button", { name: "Profile, facing left" }).click();
  await page.waitForFunction(() => window.studio.getState().spec.switches?.some((w) => w.kind === "view"), null, { timeout: 60000 });
  check(await notes.getByText(/needs a side view/).isVisible(), "with a side view painted, the warning asks for it to be keyed");
  await page.evaluate(() => window.studio.getState().set({ t: 3, playing: false }));
  await page.getByRole("combobox", { name: "girl_view option to add" }).selectOption("profile_left");
  await page.getByRole("button", { name: "Key at playhead" }).click();
  const viewKeys = await state(() => window.studio.getState().spec.switches.find((w) => w.kind === "view").keys);
  check(JSON.stringify(viewKeys) === JSON.stringify([[0, "front"], [3, "profile_left"]]), `the profile is keyed from 3s (${JSON.stringify(viewKeys)})`);
  check(!(await notes.getByText(/a flat head can turn|needs a side view/).count()), "the side view answers the turn warning");
  const [frontAt2, profileAt4] = [await frame(2), await frame(4)];
  check(frontAt2 !== profileAt4, "the head switches to the profile view on screen");
  await page.screenshot({ path: `${out}/layered-face.png` });
  await page.locator(".dv-tab", { hasText: "Layers" }).click();

  // Motion docker: a clip from the library, the Motion Director's plan applied as one step, and a key's curve
  const motionOn = async (id) => {
    await page.locator(".dv-tab", { hasText: "Layers" }).click();
    await row(id).click();
    await page.locator(".dv-tab", { hasText: "Motion" }).click();
  };
  await page.evaluate(() => window.studio.getState().set({ t: 0, playing: false }));
  await motionOn("girl");
  await page.getByRole("combobox", { name: "Clip", exact: true }).selectOption("breathing");
  await page.getByRole("button", { name: "Add clip" }).click();
  check(await state(() => window.studio.getState().spec.actions.some((a) => a.clip === "girl_breathing_1")), "a breathing clip is added from the library");
  await page.getByRole("combobox", { name: "Clip", exact: true }).selectOption("tail_sway");
  await page.getByRole("button", { name: "Add clip" }).click();
  check(await page.getByRole("alert").filter({ hasText: /no tail bones/ }).isVisible(), "a clip the rig can't do says why");
  const stepsBefore = await state(() => window.studio.getState().past.length);
  await page.getByRole("textbox", { name: "What should happen" }).fill("she glances at the clock and listens");
  await page.getByRole("button", { name: "Plan the motion" }).click();
  const planBox = page.getByRole("group", { name: "Motion plan" });
  await planBox.waitFor({ timeout: 30000 });
  check(await planBox.getByText(/the clock catches her eye/).isVisible(), "the director's plan is shown for review before it changes anything");
  check((await state(() => window.studio.getState().past.length)) === stepsBefore, "planning alone doesn't change the scene");
  await planBox.getByRole("button", { name: "Apply (one undo step)" }).click();
  const applied = await state(() => ({ steps: window.studio.getState().past.length, clips: [...new Set(window.studio.getState().spec.actions.map((a) => a.clip).filter(Boolean))] }));
  check(applied.steps === stepsBefore + 1 && applied.clips.length >= 4, `the plan is applied as one undoable step (${applied.clips.join(", ")})`);
  await motionOn("girl_head");
  const curves = page.getByRole("region", { name: "Curves" });
  await curves.getByRole("button").first().click();
  await curves.getByRole("combobox", { name: "Ease" }).selectOption("custom");
  const eased = await state(() => {
    const s = window.studio.getState().spec;
    return Object.values(s.tracks).some((tr) => tr.keys.some((k) => Array.isArray(k[2])));
  });
  check(eased, "a key gets its own Bézier curve in the curve editor");
  check(await curves.getByRole("img", { name: "Ease curve" }).isVisible(), "the curve and its handles are drawn");
  await page.screenshot({ path: `${out}/layered-motion.png` });
  await page.locator(".dv-tab", { hasText: "Layers" }).click();

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
  const sorted = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  check(sorted(reopened.assets) === sorted(saved.assets), "assets survive save and reopen");
  // key order isn't meaningful (the server returns schema order), so compare with sorted keys
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  check(canon([reopened.layers, reopened.tracks, reopened.actions, reopened.ik, reopened.switches]) === canon([saved.layers, saved.tracks, saved.actions, saved.ik, saved.switches]), "rig (bones, mesh, IK), switches, keyframes and actions survive save and reopen");
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
