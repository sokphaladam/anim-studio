// Video model benchmark (M12): the same first frames and motion prompts through each model, with time, cost, the
// app's own clip checks, and a contact sheet per clip for judging identity, anatomy and motion by eye.
//
//   cd apps/server && npx tsx ../../scripts/bench-video.mts --models seedance2_5,kling_4,local [--cases night,autumn,owl] [--max-usd 6]
//
// Cloud models are paid (the total is quoted and checked against --max-usd before anything starts). "local" is Wan 2.2
// through ComfyUI (npm run setup:painter --video), free but several minutes a clip. Results go to docs/benchmarks/.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clipChecks, comfyui, generateVideo, runway, VIDEO_SIZE, worst, type VideoProvider } from "../packages/ai/src/index.ts";
import { validateScene } from "../packages/engine/src/index.ts";
import { renderPng } from "../apps/server/src/export.ts";
import { ffmpegBin, imageStore } from "../apps/server/src/images.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k: string, d: string) => process.argv.find((a, i) => process.argv[i - 1] === `--${k}`) ?? d;
const SECONDS = 4;
const FPS = 24;
const SEED = 7;

// first frame from an example scene, and what should move (shot-specific, as the app sends it)
const CASES = {
  night: { scene: "night-study", t: 2, prompt: "Rain streaks down the window, the person in headphones nods gently while writing, the candle flame flickers, slow subtle camera push in, soft lofi anime illustration" },
  autumn: { scene: "autumn-window", t: 2, prompt: "Autumn leaves drift past the window, the sleeping cat breathes slowly, warm light flickers softly, static camera, soft lofi anime illustration" },
  owl: { scene: "snowy-owl", t: 2, prompt: "Snow falls steadily, the owl blinks and turns its head slightly, branches sway in the wind, static camera, soft lofi anime illustration" },
} as const;

const env = Object.fromEntries(
  (existsSync(join(ROOT, ".env")) ? readFileSync(join(ROOT, ".env"), "utf8") : "")
    .split(/\r?\n/)
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const models = arg("models", "seedance2_5,kling_4,local").split(",");
const cases = arg("cases", Object.keys(CASES).join(",")).split(",") as (keyof typeof CASES)[];
const maxUsd = Number(arg("max-usd", "6"));
const date = new Date().toISOString().slice(0, 10);
const out = join(ROOT, "docs", "benchmarks", `video-${date}`);
const imagesDir = join(ROOT, "data", "bench-images");
mkdirSync(join(out, "sheets"), { recursive: true });
const store = imageStore(imagesDir);

const cloud = (m: string): VideoProvider => {
  if (!env.RUNWAY_API_KEY) throw new Error("RUNWAY_API_KEY is not set in .env");
  return runway({ apiKey: env.RUNWAY_API_KEY, model: m });
};

// taskId is saved as soon as a paid task exists, so a clip lost after it was paid for can still be fetched from Runway
type Row = { model: string; case: string; taskId?: string; ok: boolean; seconds: number; costUsd?: number; frames?: number; size?: string; status?: string; checks?: string; error?: string; sheet?: string };
// one file per model list, so a local run and a cloud run can go at the same time
const resultsFile = join(out, `results-${models.join("+")}.json`);
const rows: Row[] = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, "utf8")) : [];
const save = () => writeFileSync(resultsFile, JSON.stringify(rows, null, 1));

// price what is still to make first (clips already made are kept): nothing paid starts unless it all fits --max-usd
const todo = models.filter((m) => m !== "local").flatMap((m) => cases.filter((c) => !rows.some((r) => r.model === m && r.case === c && r.ok)).map(() => m));
const quote = todo.reduce((s, m) => s + (cloud(m).estimateUsd?.({ durationSeconds: SECONDS, resolution: "720p" }) ?? Infinity), 0);
console.log(`Quote: $${quote.toFixed(2)} for ${todo.length} cloud clip(s) to make, limit $${maxUsd.toFixed(2)}`);
if (quote > maxUsd) throw new Error(`The run would cost about $${quote.toFixed(2)}, over --max-usd ${maxUsd}`);

for (const c of cases) {
  const v = validateScene(JSON.parse(readFileSync(join(ROOT, "packages/spec/examples", `${CASES[c].scene}.json`), "utf8")));
  if (!v.ok) throw new Error(v.errors[0]);
  const image = await renderPng({ ...v.spec, overlays: v.spec.overlays.filter((o) => o.type !== "fade" && o.type !== "title") }, CASES[c].t, imagesDir);
  // a small JPG of the first frame beside the sheets (the PNG stays out of the repo)
  writeFileSync(join(imagesDir, `${c}-first-frame.png`), image);
  execFileSync(ffmpegBin, ["-v", "error", "-y", "-i", join(imagesDir, `${c}-first-frame.png`), "-vf", "scale=320:-1", "-q:v", "3", join(out, "sheets", `${c}-first-frame.jpg`)]);
  for (const m of models) {
    if (rows.some((r) => r.model === m && r.case === c && r.ok)) continue; // resumable: done cases are kept
    const t0 = Date.now();
    const row: Row = { model: m, case: c, ok: false, seconds: 0 };
    try {
      let cost: number | undefined;
      const [w, h] = m === "local" ? VIDEO_SIZE["16:9"] : [1280, 720];
      const animate =
        m === "local"
          ? comfyui({ url: env.COMFY_URL || "http://127.0.0.1:8188", dir: env.COMFY_DIR || join(ROOT, "data", "comfyui") }).animate!
          : async (a: { image: Uint8Array; positive: string; frames: number; fps: number; seed: number }) => {
              const r = await generateVideo(cloud(m), { prompt: a.positive, firstFrame: a.image, durationSeconds: a.frames / a.fps, aspect: "16:9", resolution: "720p", seed: a.seed, audio: "none" }, { maxCostUsd: maxUsd, onTask: (t) => void ((row.taskId = t.providerTaskId), save()) });
              cost = r.task.estimatedCostUsd;
              return r.bytes;
            };
      const footage = await store.animateWith(animate as never)!({ image, positive: CASES[c].prompt, negative: "static image, blurry, distorted face, deformed hands, morphing, flickering, watermark, text", width: w, height: h, frames: SECONDS * FPS, fps: FPS, seed: SEED });
      const stats = await store.clipStats(footage);
      const checks = clipChecks(stats, { seconds: SECONDS, aspect: 16 / 9 });
      const folder = join(imagesDir, footage.frames.split("/")[3]);
      const sheet = `${c}-${m}.jpg`;
      // 8 frames across the clip, for judging by eye
      const pick = Array.from({ length: 8 }, (_, i) => Math.round((i / 7) * (footage.count - 1)));
      execFileSync(ffmpegBin, ["-v", "error", "-y", "-i", join(folder, "%03d.jpg"), "-vf", `select='${pick.map((n) => `eq(n\\,${n})`).join("+")}',scale=320:-1,tile=4x2`, "-frames:v", "1", join(out, "sheets", sheet)]);
      Object.assign(row, { ok: true, costUsd: cost, frames: stats.count, size: `${stats.width}×${stats.height}`, status: worst(checks), checks: checks.map((k) => k.note).join("; ") || "pass", sheet });
    } catch (e) {
      row.error = (e as Error).message;
    }
    row.seconds = Math.round((Date.now() - t0) / 1000);
    console.log(JSON.stringify(row));
    const i = rows.findIndex((r) => r.model === m && r.case === c);
    if (i >= 0) rows[i] = row;
    else rows.push(row);
    save();
  }
}
const spent = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
console.log(`Done: ${rows.filter((r) => r.ok).length}/${rows.length} clips, about $${spent.toFixed(2)} spent. ${resultsFile}`);
