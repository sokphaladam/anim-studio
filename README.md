# Anim Studio

A local, Krita-style 2D animation studio in the browser. The AI plans a layered lofi scene, paints each layer and sets it moving in a seamless loop; a deterministic TypeScript engine renders it. See `BRIEF.md` for the full plan.

**Status: Milestone 7**: workspace and playback (M1), drawing (M2), AI scene generation with Ollama (M3), AI chat edits plus saved projects (M4), layered generation with rigged characters (M5), MP4 export (M6), and library growth: snow, fireflies, clouds, wall clock, bookshelf, an owl, two more brush presets and an optional cloud fallback (M7).

## Setup

**One command:** install Node 20+, run `npm run bootstrap` (or `pnpm bootstrap`), then `pnpm dev`. It fetches pnpm if missing, installs packages, creates `.env` from `.env.example`, builds everything, installs Ollama and pulls the model, installs the ComfyUI image painter (~14 GB, see below), installs Playwright's Chromium, and boots the API once to check it works. It's safe to re-run. The steps below are what it does, if you'd rather do them by hand.

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
| `pnpm storybook` | Component gallery at http://localhost:6006 |
| `pnpm test` | Schema, track, reference and determinism tests |
| `pnpm typecheck` / `pnpm lint` | TypeScript strict check / ESLint (blocks hex colors outside `tokens.css`) |
| `pnpm compare` | With `pnpm dev` running: renders `reference/autumn-window.html` and the engine at the same times and reports pixel differences |
| `pnpm e2e:flipbook` | With `pnpm dev` running: draws a 12-frame flipbook in the real app, checks onion skin, 12 fps playback and undo/redo |
| `pnpm generate:layered ["prompt"] [seconds]` | Generates a scene for real (model + ComfyUI) without the app; writes the scene, every part/mask/source image, check frames and `preview.mp4` (the loop played twice) to `data/layered/<time>/` |
| `pnpm e2e:layered` | No GPU or `pnpm dev` needed: starts its own API (canned plan + a fake painter) and Vite, then checks layered mode, stage progress, the Layers docker (select, hide, reorder, transform, pivot), look_at keyframes, scrub phases, deterministic frames, save/reopen and MP4 export |
| `pnpm e2e:lofi` | No GPU or `pnpm dev` needed: draws a 6-second lofi loop by hand in the real editor (night fill, a dozing girl, eyes that close and open frame by frame, a 24-drawing steam flipbook, twinkling stars), checks playback and scrubbing, and exports it to `screenshots/lofi/lofi.mp4` |
| `pnpm screenshots` | With `pnpm dev` running: screenshots every screen at 1366×768, 1366×768 at 125% scaling, 1920×1080, 1920×1080 at 150% and 2560×1440 into `screenshots/` |

The two browser scripts use Playwright's Chromium if installed (`npx playwright install chromium`), otherwise a local Chrome/Brave/Edge, or set `CHROME_PATH`.

## Export MP4

**Export › Export MP4…** (Ctrl+E) renders what the editor shows, saved or not, on the API server with the same engine as the preview, then encodes it with the bundled ffmpeg. Frame *i* is the scene at *t = i / fps*, so an export has `duration × fps` frames and matches the preview frame for frame.

| Preset | Size | FPS |
| --- | --- | --- |
| YouTube | 1920×1080 | 30 |
| Shorts / Reels / TikTok | 1080×1920 | 30 |
| Square | 1080×1080 | 30 |
| Draft (fast) | 960×540 | 24 |

A scene of another shape is letterboxed with black bars, never stretched. Progress is shown per frame; closing the dialog cancels. Files go to `data/exports/` (`EXPORTS_DIR`). From a script: `POST /api/export {spec, preset}` returns a `jobId`; follow `/api/jobs/<id>/events` for `progress` and `done` (with the file's `url`).

## Layout

- `packages/spec`: Zod schema for `SceneSpec`, inferred types, JSON schema, and `examples/`.
- `packages/engine`: `createRenderer(canvas, spec) → { render(t), setSpec, dispose }`, tracks, seeded RNG, reference resolution, and an object registry. `catalog()` and `validateScene()` are built from the registry, so adding a file in `src/objects/` (and importing it in `objects/index.ts`) makes the object available everywhere.
- `packages/ui`: `tokens.css`, the Tailwind theme mapped to tokens, components and Storybook stories.
- `apps/web`: welcome screen, editor workspace (dockview), dockers, render-only page.
- `apps/server`: Fastify API. `src/db/` holds projects and spec versions in SQLite (`data/anim-studio.db`, or `DB_PATH`) via Drizzle.

## AI generation: layered lofi loops

Every AI scene is a layered lofi loop: one calm painted scene where a few things move gently and the video repeats seamlessly. There is one built-in look (soft lofi anime illustration, `LOOK` in `packages/ai/src/generate.ts`); the art-tradition picker and the Vector / Painted / Video generation modes are gone. Older scenes made with them still open, play and edit (their `meta.style` is kept but ignored), and **AI › Make the painting move / Turn the painting into video** still work on old painted scenes.

`.env` picks the language model (copy `.env.example`): local Ollama (`OLLAMA_MODEL=qwen2.5-coder:14b` on the RTX 3060 PC) or an OpenAI-compatible cloud model (`AI_PROVIDER=openai-compatible`). With `AI_FALLBACK=1` and the `FALLBACK_*` settings filled in, Ollama stays first and the cloud model answers only while Ollama isn't running or the model is missing; the AI status pill says "Cloud AI standing in" then. It is off by default, so prompts never leave the PC unless you turn it on. The image side needs `pnpm setup:painter --layered`: ComfyUI v0.43 (Windows: the portable NVIDIA build; macOS and Linux: a git checkout in `data/comfyui/ComfyUI` with its own `.venv`, needs Python 3.10–3.13, uses Apple's GPU via PyTorch MPS on Apple Silicon or CUDA on Linux; Apple Silicon with 16 GB+ memory recommended, Intel Macs and GPU-less Linux paint on the CPU, very slowly) with the with the Animagine XL 4.0 checkpoint (~9 GB) plus the two segmentation models ComfyUI v0.43 has nodes for (~2.2 GB): SAM 3.1 (`sam3.1_multiplex_fp16`, SAM License) finds a part from a few words ("head", "arm holding the mug"), BiRefNet (MIT) cuts a subject from its background. Generating is disabled on the welcome screen until they are installed. The server starts ComfyUI when needed and unloads the language model first, since a 12 GB GPU can't hold both.

Pipeline (`packages/ai/src/layered.ts`, prompt `prompts/layered.md`), one GPU model at a time, cancellable between stages:
1. **plan**: the language model returns a layer plan: the empty setting, 1–3 characters (look, pose, place, idle loops, up to 2 moving parts), props that need their own layer, ambient effects and timed actions. It is validated with Zod and sent back with its problems up to twice.
2. **background**: the empty setting, painted with the characters and props excluded.
3. **character**: each character alone on white, kept as a `source` asset.
4. **segment**: BiRefNet mask of the character, then SAM 3.1 masks of the head (when something moves it) and of each moving part; the body is what is left. Masks are stored as `mask` assets. A part that can't be found stays on the body and the rest still works.
5. **reconstruct**: what a moving part uncovers (its pixels next to the body) is filled by spreading the body's own colors inward. A diffusion repaint was tried first and dropped: behind a head it kept painting a new face.
6. **eyes**: an overlay of the head with the other eye state, inpainted: eyes open for a character who wakes up, eyes closed for one who blinks.
7. **props**: each prop alone on a plain background (grey for light things like clouds), cut out with BiRefNet.
8. **rig / validate**: parts are cropped, defringed and checked (not empty, not an opaque frame, not a rectangle), placed in scene units and grouped: `girl` (group) → `girl_body` → `girl_head` / `girl_arm`, each part pivoting where it joins the body. Doubtful results (a guessed pivot, white edge halos) get a warning icon in the Layers docker.
9. **animate**: motions become actions, compiled into tracks before playback.

Motions (`actions` in the scene, compiled by `compileActions` in the engine; each action's tracks are added on top of the part's own transform, so hand-made keys and AI motions combine):

| Action | What it does |
| --- | --- |
| `breathe` | the body grows ~1% and back, from where it rests |
| `bob` | the head nods to the music |
| `blink` | shows the eyes-closed overlay for a moment each cycle (`amount` > 1 = a slow blink) |
| `swing` | a part reaches toward a target and back (an arm lifting a mug to the mouth) |
| `sway` | rocks about its pivot (a tail, a lantern, flowers) |
| `drift` | glides sideways and back (clouds) |
| `look_at` | one-shot: turns toward a target (≤20°, over ≤2 s) and holds |
| `path` | one-shot: walks through points and back to rest (an animal along a branch) |

Loops are tracks with `loop: true`; their period is rounded so a whole number of cycles fits the scene, and one-shot motions end where they started, so the last frame flows into the first. Ambient effects are engine objects drawn over the painting, looping the same way: `stars` (twinkling), `falling-leaves`, `birds` (crossing the sky), `steam` (curling up from a prop) and `rain`.

Scene format additions (all optional, so old scenes and saved projects load unchanged; still `version: 1`): `assets` (id → stored image `src`, size, `kind`, `from`, `review`), `actions`, track `loop`, and per-layer `parent` and `pivot` (in the layer's own coordinates). Layers draw in array order; a child's matrix is camera · ancestors (root first) · its own transform, each about its own pivot. Validation rejects unknown assets and parents, circular parents and actions outside the scene. Image bytes stay in `data/images` (content-addressed, never deleted), so undo, version restore and old versions keep their images.

In the editor, generated groups and parts appear in the Layers docker indented under their parent; hiding a group hides its parts. With the transform tool, drag the pivot crosshair to move a part's pivot (or type Pivot X/Y under the layer list). Action keyframes show on the part's timeline row (a loop shows its first cycle). Chat edits (AI assistant) still change any value with a JSON patch.

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
