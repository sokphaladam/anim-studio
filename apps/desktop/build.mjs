// Builds the Windows installer: npm run desktop:build → apps/desktop/release/Anim Studio Setup <version>.exe
// The app is staged in .stage/ with a plain npm node_modules holding only better-sqlite3, so electron-builder can rebuild
// it for Electron there without touching the workspace copy that npm run dev and the tests use.
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { build } from "electron-builder";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const stage = join(here, ".stage");
const pkg = (p) => JSON.parse(readFileSync(join(root, p, "package.json"), "utf8"));
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

run("npm run build -w @anim/web");
await bundle({
  entryPoints: [join(here, "src/server.ts")],
  outfile: join(stage, "dist/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // native module / bundled binary: installed into the staged app instead
  external: ["better-sqlite3", "ffmpeg-static", "@napi-rs/canvas"],
  // CommonJS dependencies inside an ES module bundle still call require()
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
cpSync(join(here, "main.mjs"), join(stage, "main.mjs"));
cpSync(join(root, "apps/web/dist"), join(stage, "web"), { recursive: true });
cpSync(join(root, "packages/ai/prompts"), join(stage, "prompts"), { recursive: true });
cpSync(join(root, "packages/spec/examples"), join(stage, "examples"), { recursive: true });
cpSync(join(root, "scripts/setup-ai.mjs"), join(stage, "setup-ai.mjs"));
cpSync(join(root, "scripts/setup-painter.mjs"), join(stage, "setup-painter.mjs"));

const deps = pkg("apps/server").dependencies;
const version = pkg("apps/desktop").version;
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify({ name: "anim-studio", productName: "Anim Studio", version, description: "Local 2D animation studio", author: "sokphaladam", type: "module", main: "main.mjs", dependencies: { "better-sqlite3": deps["better-sqlite3"], "ffmpeg-static": deps["ffmpeg-static"], "@napi-rs/canvas": deps["@napi-rs/canvas"], "@fontsource/figtree": deps["@fontsource/figtree"], "@fontsource-variable/fraunces": deps["@fontsource-variable/fraunces"] } }, null, 2),
);
run("npm install --omit=dev --no-audit --no-fund", stage);

await build({
  projectDir: stage,
  win: ["nsis"],
  config: {
    appId: "com.animstudio.app",
    productName: "Anim Studio",
    electronVersion: JSON.parse(readFileSync(join(here, "node_modules/electron/package.json"), "utf8")).version,
    directories: { output: join(here, "release") },
    files: ["main.mjs", "dist/**", "web/**", "prompts/**", "examples/**", "node_modules/**", "package.json"],
    extraResources: [{ from: "setup-ai.mjs", to: "setup-ai.mjs" }, { from: "setup-painter.mjs", to: "setup-painter.mjs" }],
    npmRebuild: true,
    // ffmpeg.exe must be a real file on disk to run
    asarUnpack: ["node_modules/ffmpeg-static/**"],
    nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true },
  },
});
console.log(`\nInstaller: ${join(here, "release")}`);
