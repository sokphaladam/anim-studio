# Anim Studio

A local, Krita-style 2D animation studio in the browser. The AI writes a JSON **scene spec**; a deterministic TypeScript engine renders it. See `BRIEF.md` for the full plan.

**Status: Milestone 4**: workspace and playback (M1), drawing (M2), AI scene generation with Ollama (M3), and AI chat edits plus saved projects (M4).

## Setup

1. Node 20+ (`nvm use 22`) and pnpm 9 (`npm i -g pnpm@9`).
2. `pnpm install`. On Windows, `better-sqlite3` may compile from source (a few minutes; needs the Visual Studio C++ build tools if there is no prebuilt binary for your Node version).
3. Ollama (needed from Milestone 3) is set up automatically: `pnpm dev` installs it if missing (winget on Windows, Homebrew on macOS, the official script on Linux) and starts it, and the server then downloads `OLLAMA_MODEL` in the background (progress shows in the AI status pill). Run `pnpm setup:ai` to do it all up front, including the model download in the terminal. Set `OLLAMA_AUTO_SETUP=0` to manage Ollama yourself (install from ollama.com, then `ollama pull qwen2.5-coder:14b`).
4. Copy `.env.example` to `.env` if you need to change the Ollama URL/model (Milestone 3+).

## Windows app

Anim Studio runs as a desktop app (Electron, `apps/desktop`):

| Command | What it does |
| --- | --- |
| `pnpm desktop` | Development: the API server, the Vite dev server and an app window onto it (Alt shows a Dev menu with reload and devtools) |
| `pnpm desktop:build` | Builds the installer `apps/desktop/release/Anim Studio Setup <version>.exe` (about 130 MB) |

The installed app starts its own server on `127.0.0.1:8791` (any free port if taken) serving the API and the built web app, keeps projects in `%APPDATA%\Anim Studionim-studio.db`, reads optional settings from `%APPDATA%\Anim Studio\.env` (same variables as `.env.example`), and installs/starts Ollama in the background like `pnpm dev`. The installer is unsigned, so Windows SmartScreen asks for confirmation the first time. If `pnpm install` skipped Electron's download, run `node apps/desktop/node_modules/electron/install.js`.

## Run

| Command | What it does |
| --- | --- |
| `pnpm setup:ai` | Installs and starts Ollama if needed, then pulls `OLLAMA_MODEL` |
| `pnpm dev` | Web app at http://localhost:5173 and the API server on port 8790 (`API_PORT`) |
| `pnpm generate "idea" [seconds] [aspect]` | Runs the real AI pipeline in the terminal and saves `data/last-generated.json` |
| `pnpm e2e:generate` | With `pnpm dev` running: generates a scene from the welcome screen through the real model |
| `pnpm storybook` | Component gallery at http://localhost:6006 |
| `pnpm test` | Schema, track, reference and determinism tests |
| `pnpm typecheck` / `pnpm lint` | TypeScript strict check / ESLint (blocks hex colors outside `tokens.css`) |
| `pnpm compare` | With `pnpm dev` running: renders `reference/autumn-window.html` and the engine at the same times and reports pixel differences |
| `pnpm e2e:flipbook` | With `pnpm dev` running: draws a 12-frame flipbook in the real app, checks onion skin, 12 fps playback and undo/redo |
| `pnpm screenshots` | With `pnpm dev` running: screenshots every screen at 1366×768, 1366×768@150%, 1920×1080 and 2560×1440 into `screenshots/` |

The two browser scripts use Playwright's Chromium if installed (`npx playwright install chromium`), otherwise a local Chrome/Brave/Edge, or set `CHROME_PATH`.

Export to MP4 arrives in Milestone 5. `/render/autumn-window?w=1920&h=1080` already exposes `window.renderFrame(t)` for it.

## Layout

- `packages/spec`: Zod schema for `SceneSpec`, inferred types, JSON schema, and `examples/`.
- `packages/engine`: `createRenderer(canvas, spec) → { render(t), setSpec, dispose }`, tracks, seeded RNG, reference resolution, and an object registry. `catalog()` and `validateScene()` are built from the registry, so adding a file in `src/objects/` (and importing it in `objects/index.ts`) makes the object available everywhere.
- `packages/ui`: `tokens.css`, the Tailwind theme mapped to tokens, components and Storybook stories.
- `apps/web`: welcome screen, editor workspace (dockview), dockers, render-only page.
- `apps/server`: Fastify API. `src/db/` holds projects and spec versions in SQLite (`data/anim-studio.db`, or `DB_PATH`) via Drizzle.

## AI generation

`.env` picks the model (copy `.env.example`). On the RTX 3060 PC use `OLLAMA_MODEL=qwen2.5-coder:14b`; a laptop with 8 GB RAM can test with `qwen2.5-coder:3b` (lower quality).

Pipeline (`packages/ai`): storyboard → scene spec (the JSON schema is passed to Ollama's `format`) → validation → up to 3 repair rounds with the exact errors. The object list in the prompt comes from the engine's `catalog()`, so new objects need no prompt edits. Prompts are Markdown in `packages/ai/prompts/` and are re-read on every call.

The model copies the structure of one example scene: whichever of `autumn-window` / `night-study` shares the most words with the idea. After validation, a scene that is only a background gets one repair round, and two common slips are fixed in code: a track nothing uses is wired to the param it's named after (`rainIntensity` → `rain.intensity`), and a fade stuck at a fixed value gets a fade-in/out track.

## Art traditions and painted scenes

Every scene has an art tradition (`meta.style`): Anime, Hand-painted, Luminous skies, Lofi cozy room, 90s cel anime, City pop, Storybook watercolor (`packages/spec/src/styles.ts`). A style brings a curated palette (the AI must use it, so a project's scenes look like one film), a final color grade the engine applies to vector scenes (tint, bloom, film grain), and the words the image painter gets. Pick it on the welcome screen or under **AI → Art tradition**.

Two looks:
- **Painted by AI**: a local image model paints the background only (no people or animals) in the style, then the engine animates rain, light, particles, a slow camera drift and the fade on top (`painting` layer). Each moving subject from the storyboard ("girl studying", "cat") gets its own empty `drawing` layer above the painting to draw frame by frame. Needs the image painter: `pnpm setup:painter` installs ComfyUI (Windows portable, NVIDIA) and the Animagine XL 4.0 checkpoint (~9 GB) into `data/comfyui` (`COMFY_DIR`); the server starts ComfyUI when it paints (`COMFY_URL`, default `http://127.0.0.1:8188`) and unloads the language model first, since a 12 GB GPU can't hold both. Paintings are saved to `data/images` and served at `/api/images/<hash>.png`.
- **Animated video**: frame-by-frame animation. The scene is painted as above, then a local video model (Wan 2.2 TI2V 5B, Apache-2.0) animates the painting into a 5 s clip (121 frames at 24 fps, 1280×704) that the engine plays frame by frame (`footage` layer) and loops with a crossfade. About 5–10 minutes per scene on an RTX 3060. Install with `pnpm setup:painter --video` (~18 GB; `VIDEO_MODELS_DIR` can put the text encoder and VAE on another drive). The clip is split into JPEG frames with ffmpeg (`ffmpeg-static`) under `data/images/<hash>/`. **AI → Turn the painting into video** does the same for an existing painted scene.
- Painted scenes without video still move a little: Gemini looks at the painting (needs a vision model, so a cloud provider) and the engine makes people breathe and nod, animals breathe, plants sway and lights flicker, and keeps rain inside the windows. **AI → Make the painting move** applies it to older scenes.
- **Vector (editable)**: the object library below, fully editable and animatable.

`pnpm style-samples` repaints the picker's sample cards (`apps/web/public/styles/*.jpg`).

**Night study set** (example `night-study`, a rainy-balcony lofi study loop): `night-sky`, `city-lights`, `rain`, `balcony`, `string-lights`, `hanging-plant`, `desk`, `laptop`, `candle`, `studier` (a person in headphones nodding to a bpm and writing) and `cat`. All are original designs.

In the app: type an idea on the welcome screen (or in the AI assistant docker) and press Generate. Beats appear on the timeline first; the scene replaces the current one as an undoable step and starts playing. Layers made by the AI show a spark until you edit them.

## AI editing and projects

With a scene open, the AI assistant docker edits it: "make the leaves fall faster", "make my bird fly left to right". The model returns a JSON Patch (RFC 6902) against the current spec (`packages/ai/src/edit.ts`, prompt `prompts/edit.md`); it's applied, validated, and the reply lists exactly which values changed. A broken patch is retried once with the errors, then the model writes the whole updated spec instead. Hand-drawn strokes are never sent to the model (each drawing is summarized with where it sits), so it animates drawings by adding a layer `transform` driven by new tracks. Each edit is one undo step. Toggle **New scene** to build a fresh scene from the docker instead.

Projects are saved in SQLite: every save is a version row. The editor autosaves every 30 s once you change something, Ctrl+S saves now, and AI edits save themselves. Saved projects are listed on the welcome screen and survive restarts. If the server can't be reached, a backup is kept in the browser and offered on the welcome screen.

API: `GET/POST /api/projects`, `GET/PUT /api/projects/:id`, `POST /api/projects/:id/edit` `{ instruction }` → `{ patch, spec, version }`, `POST /api/projects/:id/undo` (drops the latest version).

## Drawing

- Tools: Brush (B), Eraser (E), Fill (F), Shapes (U), Move/Transform (T), Select (S), Eyedropper (P). Pen pressure works; the pen's eraser end erases; Ctrl+click picks a color; `[` `]` change size.
- Drawings are vector strokes stored in the scene (`type: "drawing"` layers with `frames`), so they render, play and export like everything else.
- **Auto-frame** (timeline, on by default): drawing on a frame with no drawing starts a new one, so stepping with `.` and drawing makes a flipbook. Turn it off to keep editing the held drawing.
- Frames: Shift+N insert blank, Shift+D duplicate, Shift+Delete delete; drag a frame dot in the timeline to retime it. Set In/Out to loop a range.
- Onion skin: O (settings in the dropdown next to it).
- Transform (T): moves/scales/rotates the selection, or the whole layer when nothing is selected. With **Auto-key** on, moving a layer writes keyframes at the current frame.
- Undo/redo: Ctrl+Z / Ctrl+Shift+Z for every action; the History docker jumps to any step. The scene autosaves to the browser every 30 s ("Continue" card on the welcome screen).

## Shortcuts

Press `?` in the editor for the full list, or `Ctrl+K` for the command palette. Space+drag pans, Ctrl+wheel zooms, Shift+Space+drag rotates, `,`/`.` step frames, Enter plays.
