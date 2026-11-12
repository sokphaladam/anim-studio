import { CHECKPOINT, comfyHealth, comfyInstall, ollamaPull, paintCheckpoint, paintCheckpoints, type AIConfig } from "@anim/ai";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";

/** Local language models the user can pick from; sizeGb is the download and roughly the memory it needs. */
export const MODELS = [
  { id: "qwen2.5-coder:3b", label: "Small: fast, plainer plans", sizeGb: 1.9 },
  { id: "qwen2.5-coder:7b", label: "Medium: good balance", sizeGb: 4.7 },
  { id: "qwen2.5-coder:14b", label: "Large: best plans (default)", sizeGb: 9 },
  { id: "qwen2.5-coder:32b", label: "Extra large: needs a big GPU", sizeGb: 20 },
];
/** A setup script in the repo's scripts/ (the packaged app points ANIM_AI_SCRIPT / ANIM_PAINTER_SCRIPT at its copies). */
const script = (name: string) => fileURLToPath(new URL(`../../../../scripts/${name}`, import.meta.url));
export type InstallState = { status: "running" | "done" | "error"; step: string; percent: number | null };

export const VIDEO_MODELS = ["local", "seedance2_5", "kling_4"] as const;
export const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/** The Gemini models this key can list (ids like "gemini-3.8-flash"), or an error message. */
export async function geminiModels(apiKey: string): Promise<{ ids: string[] } | { error: string }> {
  const r = await fetch(`${GEMINI_URL}models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r) return { error: "Can't reach Gemini. Check the internet connection." };
  if (r.status === 400 || r.status === 401 || r.status === 403) return { error: "Gemini didn't accept this key." };
  if (!r.ok) return { error: `Gemini answered ${r.status}. Try again in a minute.` };
  const data = ((await r.json().catch(() => ({}))) as { data?: { id: string }[] }).data ?? [];
  // only text models; embedding, image and audio models can't plan scenes
  return { ids: data.map((m) => m.id.replace(/^models\//, "")).filter((id) => id.startsWith("gemini") && !/embed|image|tts|audio|live|robotics|computer-use/.test(id)) };
}

/** The newest plain "flash" model in the list (fast and cheap), else the first. */
export const defaultGemini = (ids: string[]) =>
  ids
    .filter((id) => /^gemini-[\d.]+-flash$/.test(id))
    .sort((a, b) => parseFloat(b.slice(7)) - parseFloat(a.slice(7)))[0] ?? ids[0];

/** A one-word request: a listed model can still be closed to new users, so only a real answer proves it works. */
async function tryGemini(apiKey: string, model: string): Promise<string | null> {
  const r = await fetch(`${GEMINI_URL}chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "Say ok" }] }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!r) return "Can't reach Gemini. Check the internet connection.";
  if (r.ok) return null;
  const msg = (await r.text()).match(/"message":\s*"([^"]{0,200})/)?.[1];
  return `${model} can't be used${msg ? `: ${msg}` : ` (error ${r.status})`}`;
}

export interface SystemInfo {
  os: string;
  cpu: string;
  cores: number;
  ramGb: number;
  gpu: string | null;
  /** memory the model can use: NVIDIA VRAM, Apple shared memory, or a share of RAM */
  aiMemoryGb: number;
}

const gb = (b: number) => Math.round((b / 1024 ** 3) * 10) / 10;

/** Reads this computer's hardware once; nvidia-smi is optional and skipped when missing. */
export function systemInfo(): SystemInfo {
  const ramGb = gb(os.totalmem());
  const cpu = os.cpus()[0]?.model.trim() ?? os.arch();
  const osName = { darwin: "macOS", win32: "Windows", linux: "Linux" }[process.platform as string] ?? process.platform;
  if (process.platform === "darwin" && os.arch() === "arm64") return { os: `${osName} ${os.release()}`, cpu, cores: os.cpus().length, ramGb, gpu: `${cpu} GPU (shared memory)`, aiMemoryGb: Math.round(ramGb * 0.65) };
  let gpu: string | null = null;
  let vram = 0;
  try {
    const [name, mib] = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { timeout: 3000, encoding: "utf8", windowsHide: true }).split("\n")[0].split(",");
    gpu = name.trim();
    vram = Math.round(Number(mib) / 1024);
  } catch {
    // no NVIDIA GPU or driver: the model runs on the CPU from RAM
  }
  return { os: `${osName} ${os.release()}`, cpu, cores: os.cpus().length, ramGb, gpu, aiMemoryGb: vram || Math.round(ramGb * 0.5) };
}

/** The largest listed model that fits the memory, so a first start works on this machine. */
export const recommendedModel = (s: SystemInfo) => [...MODELS].reverse().find((m) => m.sizeGb + 1 <= s.aiMemoryGb)?.id ?? MODELS[0].id;

/** Sets KEY=value lines in an .env file, keeping every other line (and comments) as they were. */
export function writeEnv(file: string, values: Record<string, string>) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${k}=${v}`);
  }
  writeFileSync(file, lines.join("\n").replace(/\n?$/, "\n"));
  Object.assign(process.env, values);
}

/**
 * Settings the user picks in the app: the language model applies at once; the video model is saved and used from the next start
 * (cloud video is wired when the server starts). Saved to `envFile` (the packaged app's userData/.env, or the repo .env in dev).
 */
export function settingsRoutes(app: FastifyInstance, config: AIConfig, system: SystemInfo, envFile: string | undefined, painter: { url: string; dir: string }) {
  // what each install button runs; one at a time, since the painter parts share one ComfyUI folder
  const COMPONENTS = {
    ollama: { label: "Ollama (runs local language models)", sizeGb: 1, script: () => process.env.ANIM_AI_SCRIPT || script("setup-ai.mjs"), args: ["--no-pull"] },
    painter: { label: "Painter: ComfyUI + Animagine XL", sizeGb: 9, script: () => process.env.ANIM_PAINTER_SCRIPT || script("setup-painter.mjs"), args: [] },
    layered: { label: "Layer models: SAM 3.1 + BiRefNet (cut characters into parts)", sizeGb: 2.2, script: () => process.env.ANIM_PAINTER_SCRIPT || script("setup-painter.mjs"), args: ["--layered"] },
    video: { label: "Video model: Wan 2.2 (moves the painting, free)", sizeGb: 18, script: () => process.env.ANIM_PAINTER_SCRIPT || script("setup-painter.mjs"), args: ["--video"] },
  } as const;
  type Component = keyof typeof COMPONENTS;
  const installs: Partial<Record<Component, InstallState>> = {};
  const pulls: Record<string, InstallState> = {};
  let installer: ReturnType<typeof spawn> | null = null;
  app.addHook("onClose", async () => void installer?.kill());

  app.get("/api/settings", async () => {
    const [installed, comfy] = await Promise.all([
      fetch(`${config.ollamaUrl.replace(/\/$/, "")}/api/tags`, { signal: AbortSignal.timeout(2500) })
        .then((r) => r.json() as Promise<{ models?: { name: string }[] }>)
        .then((d) => d.models?.map((m) => m.name) ?? [], () => null),
      comfyHealth(painter),
    ]);
    const rec = recommendedModel(system);
    const env = process.env;
    const has: Record<Component, boolean> = { ollama: installed !== null, painter: comfy.installed, layered: comfy.layered, video: comfy.video };
    return {
      system,
      model: config.ollamaModel,
      provider: config.provider,
      cloudAI: config.fallback?.model.split(",")[0].trim() ?? null,
      // only the last 4 characters: the key itself never leaves the server
      geminiKey: isGemini() ? `…${config.fallback!.apiKey.slice(-4)}` : null,
      ollamaRunning: installed !== null,
      models: [
        ...MODELS.map((m) => ({ ...m, fits: m.sizeGb + 1 <= system.aiMemoryGb, recommended: m.id === rec, installed: !!installed?.some((n) => n === m.id), pull: pulls[m.id] ?? null })),
        // models the user pulled themselves also show up
        ...(installed ?? []).filter((n) => !MODELS.some((m) => m.id === n)).map((id) => ({ id, label: "Installed in Ollama", sizeGb: null, fits: true, recommended: false, installed: true, pull: null })),
      ],
      // everything the app can download, installed or not, with the progress of a running install
      components: (Object.keys(COMPONENTS) as Component[]).map((id) => ({ id, label: COMPONENTS[id].label, sizeGb: COMPONENTS[id].sizeGb, installed: has[id], install: installs[id] ?? null })),
      painting: {
        current: paintCheckpoint(),
        default: CHECKPOINT,
        installed: await paintCheckpoints(painter),
        folder: join(comfyInstall(painter.dir).comfy, "models", "checkpoints"),
      },
      video: env.CLOUD_VIDEO_ENABLED === "1" ? env.RUNWAY_VIDEO_MODEL || "seedance2_5" : "local",
      cloudVideoKey: !!env.RUNWAY_API_KEY,
      canSave: !!envFile,
    };
  });

  // runs a setup script in the background; its log lines and curl's percent become the progress shown in Settings
  app.post<{ Body: { what?: string } }>("/api/settings/install", async (req, reply) => {
    const what = req.body?.what as Component;
    if (!Object.hasOwn(COMPONENTS, what ?? "")) return reply.code(400).send({ error: "Unknown component" });
    if (Object.values(installs).some((i) => i.status === "running")) return reply.code(409).send({ error: "Another install is running; wait for it to finish" });
    const state: InstallState = (installs[what] = { status: "running", step: "Starting…", percent: null });
    const c = COMPONENTS[what];
    // ELECTRON_RUN_AS_NODE: in the packaged app process.execPath is Electron itself; AI_PROVIDER: setup-ai skips itself while cloud AI is on
    const p = (installer = spawn(process.execPath, [c.script(), ...c.args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", COMFY_DIR: painter.dir, AI_PROVIDER: "ollama", OLLAMA_AUTO_SETUP: "1" }, windowsHide: true }));
    let tail = "";
    // a crash ends with a stack trace and "Node.js v22…": the "Error: …" line is the one that says what went wrong
    let errLine = "";
    const read = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/[\r\n]+/)) {
        const step = line.match(/^\[setup:\w+\] (.+)/)?.[1];
        if (step && !step.startsWith("$ ")) [state.step, state.percent] = [step, null];
        // curl's progress meter: "  42 9500M   42 4000M ..." — the first number is the percent
        const pct = line.match(/^\s*(\d{1,3})\s+\d[\d.]*[kMG]?\s/)?.[1];
        if (pct) state.percent = Number(pct);
        if (line.trim()) tail = line.trim();
        const err = line.match(/^\w*Error: (.+)/)?.[1];
        if (err) errLine = err;
      }
    };
    p.stdout!.on("data", read);
    p.stderr!.on("data", read);
    p.on("error", (e) => Object.assign(state, { status: "error", step: e.message, percent: null }));
    p.on("close", (code) => Object.assign(state, code === 0 ? { status: "done", step: "Installed", percent: 100 } : { status: "error", step: errLine || tail || `Installer stopped (${code})`, percent: null }));
    return { ok: true };
  });

  // downloads a language model through Ollama, reporting progress like the installs
  app.post<{ Body: { model?: string } }>("/api/settings/pull", async (req, reply) => {
    const model = req.body?.model ?? "";
    if (!/^[\w.\-/]+(:[\w.-]+)?$/.test(model)) return reply.code(400).send({ error: "Not a model name" });
    if (pulls[model]?.status === "running") return reply.code(409).send({ error: "Already downloading" });
    const state: InstallState = (pulls[model] = { status: "running", step: `Downloading ${model}…`, percent: 0 });
    void ollamaPull({ url: config.ollamaUrl, model }, (s) =>
      Object.assign(state, s.status === "pulling" ? { percent: s.percent } : s.status === "done" ? { status: "done", step: "Downloaded", percent: 100 } : { status: "error", step: s.error, percent: null }),
    );
    return { ok: true };
  });

  const isGemini = () => !!config.fallback?.baseUrl.includes("generativelanguage");

  // the models the saved Gemini key can use, for the picker
  app.get("/api/settings/gemini-models", async (_req, reply) => {
    if (!isGemini()) return reply.code(400).send({ error: "No Gemini key saved" });
    const list = await geminiModels(config.fallback!.apiKey);
    return "error" in list ? reply.code(502).send(list) : { models: list.ids, current: config.fallback!.model };
  });

  app.put<{ Body: { model?: string; provider?: string; video?: string; gemini?: { apiKey?: string; model?: string } | null; paint?: string } }>("/api/settings", async (req, reply) => {
    const { model, provider, video, gemini, paint } = req.body ?? {};
    const values: Record<string, string> = {};
    if (gemini === null) {
      // remove the key; local models take over
      Object.assign(values, { FALLBACK_BASE_URL: "", FALLBACK_API_KEY: "", FALLBACK_MODEL: "", AI_PROVIDER: "ollama" });
      config.fallback = null;
      config.provider = "ollama";
      config.useFallback = false;
    } else if (gemini !== undefined) {
      // a new key, or only another model for the saved key
      const key = gemini.apiKey?.trim() || (isGemini() ? config.fallback!.apiKey : "");
      // keys and model names are single tokens: also keeps newlines out of the .env file
      if (!/^[\w.-]{20,200}$/.test(key)) return reply.code(400).send({ error: "That doesn't look like a Gemini API key", fix: "Copy the key from aistudio.google.com/apikey" });
      let m = gemini.model?.trim();
      if (m !== undefined && !/^[\w.-]{1,100}$/.test(m)) return reply.code(400).send({ error: "Not a model name" });
      if (!m) {
        const list = await geminiModels(key);
        if ("error" in list) return reply.code(400).send({ error: list.error });
        m = defaultGemini(list.ids);
        if (!m) return reply.code(400).send({ error: "This key can't use any Gemini text model" });
      }
      const bad = await tryGemini(key, m);
      if (bad) return reply.code(400).send({ error: bad, fix: "Pick another Gemini model" });
      Object.assign(values, { FALLBACK_BASE_URL: GEMINI_URL, FALLBACK_API_KEY: key, FALLBACK_MODEL: m, AI_PROVIDER: "openai-compatible" });
      config.fallback = { baseUrl: GEMINI_URL, apiKey: key, model: m };
      config.provider = "openai-compatible";
    }
    // only a checkpoint ComfyUI actually has: the name also goes into the .env file
    if (paint !== undefined && paint !== CHECKPOINT && !(await paintCheckpoints(painter)).includes(paint)) return reply.code(400).send({ error: `${paint} isn't installed` });
    if (paint) values.PAINT_CHECKPOINT = paint;
    if (model !== undefined && !/^[\w.\-/]+(:[\w.-]+)?$/.test(model)) return reply.code(400).send({ error: "Not a model name" });
    if (provider !== undefined && provider !== "ollama" && provider !== "openai-compatible") return reply.code(400).send({ error: "Unknown AI provider" });
    if (provider === "openai-compatible" && !config.fallback) return reply.code(400).send({ error: "Cloud AI is not configured", fix: "Set FALLBACK_BASE_URL, FALLBACK_API_KEY and FALLBACK_MODEL in .env" });
    if (video !== undefined && !(VIDEO_MODELS as readonly string[]).includes(video)) return reply.code(400).send({ error: "Unknown video model" });
    if (video && video !== "local" && !process.env.RUNWAY_API_KEY) return reply.code(400).send({ error: "Cloud video needs a Runway key", fix: "Set RUNWAY_API_KEY in .env" });
    if (model) values.OLLAMA_MODEL = config.ollamaModel = model;
    if (provider) values.AI_PROVIDER = config.provider = provider;
    if (video) Object.assign(values, video === "local" ? { CLOUD_VIDEO_ENABLED: "0" } : { CLOUD_VIDEO_ENABLED: "1", RUNWAY_VIDEO_MODEL: video });
    if (envFile) writeEnv(envFile, values);
    else Object.assign(process.env, values); // no file: still applies until the app closes
    return { ok: true, restartForVideo: !!video };
  });
}
