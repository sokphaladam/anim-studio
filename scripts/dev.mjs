// npm has no `--parallel`: runs `npm run dev` in each given workspace at once; Ctrl+C or any one exiting stops them all.
// Usage: node scripts/dev.mjs @anim/web @anim/server [...]
import { spawn } from "node:child_process";

const procs = process.argv.slice(2).map((w) => spawn("npm", ["run", "dev", "-w", w], { stdio: "inherit", shell: process.platform === "win32" }));
const stop = (code) => {
  procs.forEach((p) => p.exitCode === null && p.kill());
  process.exit(code ?? 0);
};
procs.forEach((p) => p.on("exit", stop));
process.on("SIGINT", () => stop(130));
