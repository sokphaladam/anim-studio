# Anim Studio

A local, Krita-style 2D animation studio in the browser. The AI writes a JSON **scene spec**; a deterministic TypeScript engine renders it. See `BRIEF.md` for the full plan.

**Status: Milestone 3**: workspace and playback (M1), drawing (M2), and AI scene generation with Ollama (M3).

## Setup

1. Node 20+ (`nvm use 22`) and pnpm 9 (`npm i -g pnpm@9`).
2. `pnpm install`
3. Ollama (needed from Milestone 3): install from ollama.com, then `ollama pull qwen2.5-coder:14b`.
4. Copy `.env.example` to `.env` if you need to change the Ollama URL/model (Milestone 3+).

## Run

| Command | What it does |
| --- | --- |
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

## AI generation

`.env` picks the model (copy `.env.example`). On the RTX 3060 PC use `OLLAMA_MODEL=qwen2.5-coder:14b`; a laptop with 8 GB RAM can test with `qwen2.5-coder:3b` (lower quality).

Pipeline (`packages/ai`): storyboard → scene spec (the JSON schema is passed to Ollama's `format`) → validation → up to 3 repair rounds with the exact errors. The object list in the prompt comes from the engine's `catalog()`, so new objects need no prompt edits. Prompts are Markdown in `packages/ai/prompts/` and are re-read on every call.

In the app: type an idea on the welcome screen (or in the AI assistant docker) and press Generate. Beats appear on the timeline first; the scene replaces the current one as an undoable step and starts playing. Layers made by the AI show a spark until you edit them.

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
