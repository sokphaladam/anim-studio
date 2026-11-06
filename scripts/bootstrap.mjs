// One-command setup: `npm run bootstrap` (or `pnpm bootstrap`). Safe to re-run.
// Installs packages (fetching pnpm via npx when it's missing), creates .env, builds, sets up Ollama and the painter,
// installs Playwright's Chromium for the e2e/screenshot scripts, then boots the API once to prove it works.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const win = process.platform === "win32";
const log = (m) => console.log(`\n[bootstrap] ${m}`);
const ok = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: win }).status === 0;
const must = (cmd, args) => {
  if (!ok(cmd, args)) {
    console.error(`\n[bootstrap] failed: ${cmd} ${args.join(" ")}`);
    process.exit(1);
  }
};

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`[bootstrap] Node 20+ required, found ${process.version}. Run \`nvm install 22\` first.`);
  process.exit(1);
}

const hasPnpm = spawnSync("pnpm", ["--version"], { stdio: "ignore", shell: win }).status === 0;
const [pnpm, pre] = hasPnpm ? ["pnpm", []] : ["npx", ["-y", "pnpm@9.15.9"]];
const p = (...args) => [pnpm, [...pre, ...args]];

log("installing packages");
must(...p("install"));

if (!existsSync(`${root}.env`)) {
  copyFileSync(`${root}.env.example`, `${root}.env`);
  log("created .env from .env.example");
}

log("building");
must(...p("build"));

log("setting up Ollama + model");
must("node", ["scripts/setup-ai.mjs"]);

log("setting up the image painter (ComfyUI: portable NVIDIA build on Windows, git + venv on macOS/Linux)");
must("node", ["scripts/setup-painter.mjs", "--layered"]);

// e2e/screenshot scripts fall back to a local Chrome, so a failed download isn't fatal
log("installing Playwright Chromium");
if (!ok("npx", ["playwright", "install", "chromium"])) log("Chromium download failed; browser scripts will use local Chrome/Edge or CHROME_PATH.");

log("smoke test: starting the API server");
const port = "8799";
const server = spawn(pnpm, [...pre, "--filter", "@anim/server", "start"], { cwd: root, env: { ...process.env, API_PORT: port }, stdio: "ignore", shell: win, detached: !win });
let healthy = false;
for (let i = 0; i < 60 && !healthy; i++) {
  await new Promise((r) => setTimeout(r, 500));
  healthy = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.ok, () => false);
}
if (win) spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
else process.kill(-server.pid);
if (!healthy) {
  console.error(`[bootstrap] API server did not answer on :${port}. Run \`${hasPnpm ? "pnpm" : "npx pnpm"} --filter @anim/server start\` to see why.`);
  process.exit(1);
}

log(`all set. Start the app with \`${hasPnpm ? "pnpm" : "npx pnpm"} dev\` → http://localhost:5173`);
