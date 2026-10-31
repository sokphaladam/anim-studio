// Installs Ollama if missing, starts it, and pulls the model from .env (OLLAMA_MODEL). Safe to re-run.
// Usage: pnpm setup:ai [--no-pull]. Runs before `pnpm dev` with --no-pull (the server pulls the model in the background).
// Skipped in CI, when AI_PROVIDER=openai-compatible, or with OLLAMA_AUTO_SETUP=0.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const URL_ = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:14b";
const pull = !process.argv.includes("--no-pull");
const log = (m) => console.log(`[setup:ai] ${m}`);

if (process.env.CI || process.env.OLLAMA_AUTO_SETUP === "0" || process.env.AI_PROVIDER === "openai-compatible") process.exit(0);

const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(URL_);

async function tags() {
  try {
    const res = await fetch(`${URL_}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return ((await res.json()).models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

/** Path of the ollama binary, or null. Checks PATH first, then the default install locations (PATH may be stale right after installing). */
function findOllama() {
  if (spawnSync("ollama", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0) return "ollama";
  const candidates = {
    win32: [join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe")],
    darwin: ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"],
    linux: ["/usr/local/bin/ollama", "/usr/bin/ollama"],
  }[process.platform] ?? [];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function run(cmd, args) {
  log(`$ ${cmd} ${args.join(" ")}`);
  return spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" }).status === 0;
}

function install() {
  log("Ollama is not installed, installing it…");
  if (process.platform === "win32") return run("winget", ["install", "--id", "Ollama.Ollama", "-e", "--silent", "--accept-source-agreements", "--accept-package-agreements"]);
  if (process.platform === "darwin") {
    if (spawnSync("brew", ["--version"], { stdio: "ignore" }).status === 0) return run("brew", ["install", "ollama"]);
    return false;
  }
  return run("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"]);
}

async function waitForServer(ms) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500))) {
    const t = await tags();
    if (t) return t;
  }
  return null;
}

let models = await tags();
if (!models) {
  if (!isLocal) {
    log(`Ollama at ${URL_} is not reachable; it is not local, so nothing to install. Check OLLAMA_URL.`);
    process.exit(0);
  }
  let bin = findOllama();
  if (!bin) {
    if (!install() || !(bin = findOllama())) {
      log("Could not install Ollama automatically. Install it from https://ollama.com/download, then run pnpm setup:ai.");
      process.exit(0); // don't block `pnpm dev`; the app explains what is missing
    }
  }
  models = await waitForServer(3000); // the Windows/macOS app starts the server itself after installing
  if (!models) {
    log("Starting the Ollama server…");
    spawn(bin, ["serve"], { detached: true, stdio: "ignore", shell: process.platform === "win32", windowsHide: true }).unref();
    models = await waitForServer(20000);
  }
  if (!models) {
    log(`Ollama did not start at ${URL_}. Start the Ollama app (or \`ollama serve\`) and refresh.`);
    process.exit(0);
  }
}
log(`Ollama is running at ${URL_}`);

if (models.includes(MODEL) || models.includes(`${MODEL}:latest`)) log(`Model ${MODEL} is ready.`);
else if (pull) {
  const bin = findOllama();
  if (!bin || !run(bin, ["pull", MODEL])) log(`Pull failed. Run \`ollama pull ${MODEL}\` yourself.`);
} else log(`Model ${MODEL} is not pulled yet; the server will download it in the background.`);
