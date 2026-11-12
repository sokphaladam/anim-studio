# Anim Studio

A local, Krita-style 2D animation studio in the browser. The AI plans a layered lofi scene, paints each layer and sets it moving in a seamless loop; a deterministic TypeScript engine renders it. See `BRIEF.md` for the full plan.

**Status: Milestone 11**: workspace and playback (M1), drawing (M2), AI scene generation with Ollama (M3), AI chat edits plus saved projects (M4), layered generation with rigged characters (M5), MP4 export (M6), library growth and an optional cloud fallback (M7), then the hybrid plan in `docs/ANIM-STUDIO-HYBRID-ANIMATION-ARCHITECTURE.md`: a cloud video provider (Runway) beside the local video model (M8), one prompt making the editable scene plus optional cinematic AI shots (M9), quality checks, retries and a spend limit (M10), and a Results panel with clip-level editing and an AI-cut export (M11).

## Setup

**One command:** install Node 20+, run `npm run bootstrap`, then `npm run dev`. It installs packages, creates `.env` from `.env.example`, builds everything, installs Ollama and pulls the model, installs the ComfyUI image painter (~14 GB, see below), installs Playwright's Chromium, and boots the API once to check it works. It's safe to re-run. The steps below are what it does, if you'd rather do them by hand.

1. Node 20+ (`nvm use 22`).
2. `npm install`. On Windows, `better-sqlite3` may compile from source (a few minutes; needs the Visual Studio C++ build tools if there is no prebuilt binary for your Node version).
3. Ollama (needed from Milestone 3) is set up automatically: `npm run dev` installs it if missing (winget on Windows, Homebrew on macOS, the official script on Linux) and starts it, and the server then downloads `OLLAMA_MODEL` in the background (progress shows in the AI status pill). Run `npm run setup:ai` to do it all up front, including the model download in the terminal. Set `OLLAMA_AUTO_SETUP=0` to manage Ollama yourself (install from ollama.com, then `ollama pull qwen2.5-coder:14b`).
4. Copy `.env.example` to `.env` if you need to change the Ollama URL/model (Milestone 3+).

## Windows app

Anim Studio runs as a desktop app (Electron, `apps/desktop`):

| Command | What it does |
| --- | --- |
| `npm run desktop` | Development: the API server, the Vite dev server and an app window onto it (Alt shows a Dev menu with reload and devtools) |
| `npm run desktop:build` | Builds the installer `apps/desktop/release/Anim Studio Setup <version>.exe` (about 130 MB) |

The installed app starts its own server on `127.0.0.1:8791` (any free port if taken) serving the API and the built web app, keeps projects in `%APPDATA%\Anim Studionim-studio.db`, reads optional settings from `%APPDATA%\Anim Studio\.env` (same variables as `.env.example`), and installs/starts Ollama in the background like `npm run dev`. The installer is unsigned, so Windows SmartScreen asks for confirmation the first time. If `npm install` skipped Electron's download, run `node apps/desktop/node_modules/electron/install.js`.

## Run

| Command | What it does |
| --- | --- |
| `npm run setup:ai` | Installs and starts Ollama if needed, then pulls `OLLAMA_MODEL` |
| `npm run dev` | Web app at http://localhost:5173 and the API server on port 8790 (`API_PORT`) |
| `npm run storybook` | Component gallery at http://localhost:6006 |
| `npm test` | Schema, track, reference and determinism tests |
| `npm run typecheck` / `npm run lint` | TypeScript strict check / ESLint (blocks hex colors outside `tokens.css`) |
| `npm run compare` | With `npm run dev` running: renders `reference/autumn-window.html` and the engine at the same times and reports pixel differences |
| `npm run e2e:flipbook` | With `npm run dev` running: draws a 12-frame flipbook in the real app, checks onion skin, 12 fps playback and undo/redo |
| `npm run generate:layered ["prompt"] [seconds]` | Generates a scene for real (model + ComfyUI) without the app; writes the scene, every part/mask/source image, check frames and `preview.mp4` (the loop played twice) to `data/layered/<time>/` |
| `npm run e2e:layered` | No GPU or `npm run dev` needed: starts its own API (canned plan + a fake painter) and Vite, then checks layered mode, stage progress, the Layers docker (select, hide, reorder, transform, pivot), look_at keyframes, scrub phases, deterministic frames, save/reopen and MP4 export |
| `npm run e2e:lofi` | No GPU or `npm run dev` needed: draws a 6-second lofi loop by hand in the real editor (night fill, a dozing girl, eyes that close and open frame by frame, a 24-drawing steam flipbook, twinkling stars), checks playback and scrubbing, and exports it to `screenshots/lofi/lofi.mp4` |
| `npm run screenshots` | With `npm run dev` running: screenshots every screen at 1366×768, 1366×768 at 125% scaling, 1920×1080, 1920×1080 at 150% and 2560×1440 into `screenshots/` |

The two browser scripts use Playwright's Chromium if installed (`npx playwright install chromium`), otherwise a local Chrome/Brave/Edge, or set `CHROME_PATH`.

## Export MP4

**Export › Export MP4…** (Ctrl+E) renders what the editor shows, saved or not, on the API server with the same engine as the preview, then encodes it with the bundled ffmpeg. Frame *i* is the scene at *t = i / fps*, so an export has `duration × fps` frames and matches the preview frame for frame.

| Preset | Size | FPS |
| --- | --- | --- |
| YouTube | 1920×1080 | 30 |
| Shorts / Reels / TikTok | 1080×1920 | 30 |
| Square | 1080×1080 | 30 |
| Draft (fast) | 960×540 | 24 |

The dialog offers three outputs: the **editable master** (the scene as the editor shows it), the **package** (below), and the **cinematic AI cut**: the scene's generated shots that weren't marked failed, joined in time order at the scene's size and 24 fps (`POST /api/export/cinematic {spec}`; timeline trims don't apply, each shot is used whole).

A scene of another shape is letterboxed with black bars, never stretched. Progress is shown per frame; closing the dialog cancels. Files go to `data/exports/` (`EXPORTS_DIR`). From a script: `POST /api/export {spec, preset}` returns a `jobId`; follow `/api/jobs/<id>/events` for `progress` and `done` (with the file's `url`).

## Layout

- `packages/spec`: Zod schema for `SceneSpec`, inferred types, JSON schema, and `examples/`.
- `packages/engine`: `createRenderer(canvas, spec) → { render(t), setSpec, dispose }`, tracks, seeded RNG, reference resolution, and an object registry. `catalog()` and `validateScene()` are built from the registry, so adding a file in `src/objects/` (and importing it in `objects/index.ts`) makes the object available everywhere.
- `packages/ui`: `tokens.css`, the Tailwind theme mapped to tokens, components and Storybook stories.
- `apps/web`: welcome screen, editor workspace (dockview), dockers, render-only page.
- `apps/server`: Fastify API. `src/db/` holds projects and spec versions in SQLite (`data/anim-studio.db`, or `DB_PATH`) via Drizzle.

## AI generation: layered lofi loops

Every AI scene is a layered lofi loop: one calm painted scene where a few things move gently and the video repeats seamlessly. There is one built-in look (soft lofi anime illustration, `LOOK` in `packages/ai/src/generate.ts`); the art-tradition picker and the Vector / Painted / Video generation modes are gone. Older scenes made with them still open, play and edit (their `meta.style` is kept but ignored), and **AI › Make the painting move / Turn the painting into video** still work on old painted scenes.

`.env` picks the language model (copy `.env.example`): local Ollama (`OLLAMA_MODEL=qwen2.5-coder:14b` on the RTX 3060 PC) or an OpenAI-compatible cloud model (`AI_PROVIDER=openai-compatible`). With `AI_FALLBACK=1` and the `FALLBACK_*` settings filled in, Ollama stays first and the cloud model answers only while Ollama isn't running or the model is missing; the AI status pill says "Cloud AI standing in" then. It is off by default, so prompts never leave the PC unless you turn it on. The image side needs `npm run setup:painter --layered`: ComfyUI v0.43 (Windows: the portable NVIDIA build; macOS and Linux: a git checkout in `data/comfyui/ComfyUI` with its own `.venv`, needs Python 3.10–3.13, uses Apple's GPU via PyTorch MPS on Apple Silicon or CUDA on Linux; Apple Silicon with 16 GB+ memory recommended, Intel Macs and GPU-less Linux paint on the CPU, very slowly) with the with the Animagine XL 4.0 checkpoint (~9 GB) plus the two segmentation models ComfyUI v0.43 has nodes for (~2.2 GB): SAM 3.1 (`sam3.1_multiplex_fp16`, SAM License) finds a part from a few words ("head", "arm holding the mug"), BiRefNet (MIT) cuts a subject from its background. Generating is disabled on the welcome screen until they are installed. The server starts ComfyUI when needed and unloads the language model first, since a 12 GB GPU can't hold both.

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

## Natural motion (video AI loop)

Cut-out layers can only slide, turn and scale, so a walking cat or a person shifting their weight never looks natural. Tick **Natural motion (video AI loop)** on the welcome screen.

- **What happens:** after the editable scene is made, the video model (Runway when cloud video is on, else local Wan 2.2) animates its first frame with a still camera. The prompt names what moves, from the plan.
- **Length:** the clip divides the scene evenly, at most 8 s (two 6 s loops in a 12 s scene). It plays as a `video_loop` footage layer over the painted layers with a crossfade at its seam, so the scene still loops seamlessly.
- **Editing:** the painted layers stay underneath. Hide or delete `video_loop` to edit them, and **AI › Redo cinematic shots** for another take.
- **Cost:** about $1.80 for a 6 s seedance loop, or about 3 minutes of local GPU time per second of video.

## Cinematic AI video (optional, paid when cloud)

Tick **Cinematic AI video** on the welcome screen to also get video shots made from the same plan as the editable scene. The editable scene is always made first and stays the source of truth; shots are stored beside it (`spec.cinematic`), never as layers, so a failed or expensive shot can't break the scene. Each shot's first frame is the editable scene rendered at the shot's start (a fade-in is left out, so the clip doesn't start from black). The planner may pick up to two 4–10 s moments; with none, one shot covers the scene's first 10 s.

The video model is the local one (`npm run setup:painter --video`, Wan 2.2) or, opt-in, Runway: set `CLOUD_VIDEO_ENABLED=1` and `RUNWAY_API_KEY` in `.env` (the key stays in the server: never in the browser, projects, logs or job events). `RUNWAY_VIDEO_MODEL` is `seedance2_5` (default) or `kling_4`; clips are 720p and silent.

**Cost.** Runway charges per second of video (seedance2_5 720p: 30 credits = $0.30 a second, 80-credit minimum; a real 4 s clip cost $1.20). The welcome screen quotes the price of a shot before you generate, from the list prices in `packages/ai/src/video.ts`. `RUNWAY_MAX_COST_USD` (default $5) caps a whole job, every shot and retry included: a shot whose quote is over what's left is refused before any task is made, and one whose Runway estimate is over (prices changed) is cancelled before it runs. Every started task counts against the limit, even if it fails.

**Checks and retries.** Every clip is measured at five points (start, quarters, end): wrong length, wrong shape or blank frames fail it; a sudden change between frames (flicker, a jump cut) marks it for review. A failing shot is retried `RUNWAY_MAX_RETRIES` times (default 1); the best attempt is kept. A shot that never passes ends as **needs review** (made, with the reason) or **failed** (no usable clip), never silently as ready. These checks are deterministic: they can't judge identity, anatomy or whether the motion matches the prompt.

**Results panel** (docked with Layers): the shots with status, model, cost, tries and review notes; **Add to timeline** places a shot as a footage layer playing once from its start, with Start / Trim in / Trim out fields and a menu to swap in another shot's clip; **Redo** remakes one shot (or **AI › Redo cinematic shots** all that failed or need review), and placed clips pick up the new video. The **Quality report** tab checks the editable scene (`POST /api/quality`: invalid references or rig fail; flagged parts, pivots far outside their part and mesh weights that don't add up to 1 need review) and lists each shot's own checks.

**When things go wrong.** Losing the connection or a Runway rate limit while a clip renders doesn't fail it: the server keeps asking, waiting longer each time (up to a minute, or as long as Runway's `Retry-After` says), and gives up after 6 misses in a row. A rate-limited create is asked again up to 3 times (no task was made); any other failed create is never repeated, so a dropped request can't pay twice. A clip that isn't a valid video fails that shot with the reason and is retried; the editable scene is never touched. If the server stops while a paid task renders, the task is kept in `data/cloud-tasks.json`; on the next start its clip is collected into the image store and listed at `GET /api/video/recovered` (prompt, cost, frames), so a clip already paid for isn't lost. With `CLOUD_VIDEO_ENABLED` unset or `0`, no request goes to Runway even if a key is set.

API: `POST /api/generate {…, cinematic: true}` adds `quality` and `shot` events after the scene; `POST /api/shots/retry {spec, ids?}` redoes shots without touching the scene; `GET /api/health/painter` reports `cloudVideo` and `cloudQuote`; `GET /api/video/recovered` lists clips collected after a restart.

**Benchmark** (M12): `cd apps/server && npx tsx ../../scripts/bench-video.mts --models seedance2_5,kling_4,local` runs the same first frames and prompts through each model, quotes the total first (`--max-usd`, default 6) and writes timings, cost, clip checks and contact sheets to `docs/benchmarks/`. Results: `docs/benchmarks/VIDEO-BENCHMARK.md`.

## AI editing and projects

With a scene open, the AI assistant docker edits it: "make the leaves fall faster", "make my bird fly left to right". The model returns a JSON Patch (RFC 6902) against the current spec (`packages/ai/src/edit.ts`, prompt `prompts/edit.md`); it's applied, validated, and the reply lists exactly which values changed. A broken patch is retried once with the errors, then the model writes the whole updated spec instead. Hand-drawn strokes are never sent to the model (each drawing is summarized with where it sits), so it animates drawings by adding a layer `transform` driven by new tracks. Each edit is one undo step. Toggle **New scene** to build a fresh scene from the docker instead.

Projects are saved in SQLite: every save is a version row. The editor autosaves every 30 s once you change something, Ctrl+S saves now, and AI edits save themselves. Saved projects are listed on the welcome screen and survive restarts; a card's **⋯ › Delete project…** deletes it and all its versions after a confirmation (stored images stay, since other projects may use them). If the server can't be reached, a backup is kept in the browser and offered on the welcome screen.

API: `GET/POST /api/projects`, `GET/PUT /api/projects/:id`, `POST /api/projects/:id/edit` `{ instruction }` → `{ patch, spec, version }`, `POST /api/projects/:id/undo` (drops the latest version), `DELETE /api/projects/:id`.

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
