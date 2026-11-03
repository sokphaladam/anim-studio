import { chromium } from "playwright";
import { existsSync } from "node:fs";

// Use Playwright's Chromium if installed, otherwise a local Chromium-based browser (CHROME_PATH overrides).
const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

export async function launch() {
  try {
    return await chromium.launch();
  } catch {
    const executablePath = CANDIDATES.find((p) => existsSync(p));
    if (!executablePath) throw new Error("No Chromium found: run `npx playwright install chromium` or set CHROME_PATH");
    return chromium.launch({ executablePath });
  }
}
