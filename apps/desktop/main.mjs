// Electron main process. Dev (`npm run desktop`): a window onto the Vite dev server, with the API run by npm as usual.
// Packaged: runs the API + built web app in-process (dist/server.mjs) and opens a window onto it.
import { app, BrowserWindow, Menu, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEV_URL = process.env.ANIM_DEV_URL ?? "http://localhost:5173";
const PORT = 8791; // fixed so localStorage (window layout, backups) survives restarts; differs from npm run dev's 8790

if (!app.requestSingleInstanceLock()) app.quit();

async function waitFor(url, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 500)))
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // not up yet
    }
  return false;
}

/** Packaged only: settings, database and Ollama setup live outside the read-only app folder. */
async function startBundledServer() {
  const userData = app.getPath("userData");
  const envFile = join(userData, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  process.env.ANIM_ENV_FILE = envFile; // the Settings dialog saves the user's model choices here
  process.env.DB_PATH ||= join(userData, "anim-studio.db");
  // the image painter (npm run setup:painter with COMFY_DIR pointing here, or set COMFY_DIR in .env to an existing install)
  process.env.COMFY_DIR ||= join(userData, "comfyui");
  process.env.LOG_LEVEL ||= "warn";
  // Settings > Install buttons run these copies
  process.env.ANIM_PAINTER_SCRIPT = join(process.resourcesPath, "setup-painter.mjs");
  process.env.ANIM_AI_SCRIPT = join(process.resourcesPath, "setup-ai.mjs");
  process.env.ANIM_PROMPTS_DIR = join(app.getAppPath(), "prompts");
  process.env.ANIM_EXAMPLES_DIR = join(app.getAppPath(), "examples");
  // install/start Ollama in the background (same script as npm run dev); the server then downloads the model
  spawn(process.execPath, [join(process.resourcesPath, "setup-ai.mjs"), "--no-pull"], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, stdio: "ignore", windowsHide: true }).on("error", () => {});
  const { start } = await import("./dist/server.mjs");
  return start(join(app.getAppPath(), "web"), PORT);
}

async function createWindow() {
  const win = new BrowserWindow({ width: 1600, height: 960, minWidth: 1024, minHeight: 640, show: false, backgroundColor: "#141217", title: "Anim Studio", autoHideMenuBar: true });
  win.once("ready-to-show", () => win.maximize());
  win.once("ready-to-show", () => win.show());
  // links to other sites open in the user's browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  let url = DEV_URL;
  if (app.isPackaged) url = await startBundledServer();
  else if (!(await waitFor(DEV_URL, 60_000))) throw new Error(`The web dev server did not start at ${DEV_URL}`);
  await win.loadURL(url);
}

// the app has its own File/Edit/... menus; keep F12 / Ctrl+Shift+I for devtools in dev
// editMenu stays even when packaged: without it macOS has no Cmd+C/V/X/A in text fields
Menu.setApplicationMenu(Menu.buildFromTemplate([...(process.platform === "darwin" ? [{ role: "appMenu" }] : []), { role: "editMenu" }, ...(app.isPackaged ? [] : [{ label: "Dev", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] }])]));
app.on("second-instance", () => BrowserWindow.getAllWindows()[0]?.focus());
app.on("window-all-closed", () => app.quit());
app.whenReady().then(createWindow).catch((e) => {
  console.error(e);
  app.quit();
});
