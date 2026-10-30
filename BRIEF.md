# Prompt-to-Animation Tool — Build Brief for AI

Oct 30, 2026 · @sokphaladam

## How to use this brief

Give this whole document to an AI coding agent (Claude Code, Cursor, or similar) as its build instructions. It defines the goal, stack, folder layout, data contract and milestones, so the agent builds one milestone at a time instead of guessing.

1. Create an empty folder, for example `anim-studio`.
2. Download this doc as Markdown and save it in that folder as `BRIEF.md`.
3. Save `autumn-window.html` (the 12-second demo) as `reference/autumn-window.html`. It shows the renderer style and the first example scene.
4. Make sure Ollama is installed and `qwen2.5-coder:14b` is pulled.
5. Open the agent in that folder and send: **"Read BRIEF.md and reference/autumn-window.html. Build Milestone 1 only, then stop and summarize what you built and how to run it."**
6. Test it yourself, then ask for the next milestone.

Everything below this section is written to the AI agent.

## Project goal

Build **Anim Studio**: a local, Krita-style 2D animation studio that runs in the browser. The user can draw and animate by hand with brushes, layers and a frame timeline, or type a description and let AI build the animation (5–30 seconds), then keep editing either way and export MP4.

The core design rule: **the AI never draws pixels and never writes rendering code.** The AI writes a JSON *scene spec*. A deterministic TypeScript engine renders that spec on a canvas. This keeps output reliable, editable and exportable frame-exact.

User flow:

1. User enters a prompt, e.g. "a cat sleeping on a rainy balcony at night, 12 seconds, lightning at 6s", plus duration and aspect ratio (16:9, 9:16, 1:1).
2. The AI writes a storyboard (timed beats), then a scene spec that uses only objects from the engine's library.
3. The server validates the spec and asks the AI to repair it if invalid.
4. The browser plays the animation with a timeline scrubber.
5. User refines by chat ("make the rain heavier", "move the cat left"). The AI returns a patch, not a whole new scene.
6. User exports MP4 (1920×1080 or 1080×1920 for YouTube Shorts).

The app runs entirely on the user's PC. The default AI is a local Ollama model on an RTX 3060 12GB, with an optional cloud fallback.

## Workspace and drawing tools (Krita-style)

The editor looks and works like a simplified Krita: a dark, dockable workspace with the toolbox on the left, the canvas in the center, dockers on the right and the animation timeline along the bottom. Follow Krita's layout conventions and shortcuts, but design original icons and UI; do not copy Krita's code (it is GPL), artwork or branding.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ File  Edit  View  Layer  Animation  AI  Export                       │
│ Tool options: size | opacity | smoothing | color swatch               │
├────┬───────────────────────────────────────────────┬─────────────────┤
│ ✎  │                                               │ Color selector  │
│ ⌫  │                                               ├─────────────────┤
│ ▣  │                  CANVAS                       │ Brush presets   │
│ ◯  │     zoom, pan, rotate, onion skin overlay     ├─────────────────┤
│ ✥  │                                               │ Layers          │
│ ⬚  │                                               ├─────────────────┤
│ ⌖  │                                               │ AI assistant    │
├────┴───────────────────────────────────────────────┴─────────────────┤
│ Timeline: rows = layers, columns = frames | play | fps | onion skin    │
└──────────────────────────────────────────────────────────────────────┘
```

All panels are resizable, collapsible and can be re-docked; the layout is saved per user. Every color, size and component follows the Visual design system section below.

**Toolbox:**

| Tool | Shortcut | Behavior |
| --- | --- | --- |
| Brush | B | Pressure-sensitive strokes from mouse or pen tablet; size, opacity, smoothing; presets: pencil, ink pen, marker, soft airbrush |
| Eraser | E | Erases strokes on the current frame |
| Fill | F | Fills a closed area on the current frame with the current color |
| Shapes | U | Line, rectangle, ellipse; hold Shift to constrain |
| Move / Transform | T | Move, scale, rotate a layer or selection; with auto-key on, creates transform keyframes |
| Select | S | Rectangle and lasso selection on the current frame |
| Eyedropper | P, or Ctrl while brushing | Picks a color from the canvas |
| View | Space drag, Ctrl+wheel, Shift+Space drag | Pan, zoom, rotate the canvas view |

**Timeline docker:** a grid of layers × frames like Krita's animation timeline. Filled cells mark drawn frames; empty cells hold the previous drawing. Users can insert blank frame, duplicate frame, delete frame, drag frames to retime, set fps (12, 24, 30) and play range, loop, and step with `,` and `.`. Object layers show their keyframes as diamonds. AI storyboard beats appear as markers above the frame numbers.

**Onion skin:** shows up to 3 frames before (tinted red) and after (tinted green) the current frame with adjustable opacity; toggle with a button on the timeline.

**Layers docker:** drawing layers (hand-drawn, frame-by-frame), object layers (library objects, usually created by the AI), and groups. Each has visibility, lock, opacity, blend mode (normal, multiply, screen, add), rename and drag-to-reorder.

**AI assistant docker:** the prompt box and chat history. It can create a whole scene, add object layers, change keyframes, or animate a drawn layer ("make my drawn bird fly from left to right in 3 seconds" adds transform keyframes to that layer).

**History:** undo/redo with Ctrl+Z and Ctrl+Shift+Z across every action, drawing and AI edits alike, plus autosave every 30 seconds.

## Visual design system

The app must look like a finished professional creative tool, on the level of Krita, Blender or Figma: calm graphite surfaces that let the artwork stand out, one warm accent, crisp type, and identical behavior everywhere. Build every screen from one token file and one component library; no screen invents its own styles.

**Color tokens** (`packages/ui/src/tokens.css`, dark theme is the default; a light theme may come later using the same token names):

| Token | Value | Use |
| --- | --- | --- |
| `--bg-app` | `#16151a` | Window background, gaps between panels |
| `--bg-panel` | `#1e1d23` | Docker and toolbar surfaces |
| `--bg-raised` | `#28272e` | Inputs, buttons, timeline rows |
| `--bg-hover` | `#32313a` | Hover state on any surface |
| `--canvas-surround` | `#0e0e11` | Area around the canvas; transparency shows a subtle checkerboard |
| `--border` | `#2d2c33` | 1px dividers between panels and rows |
| `--border-strong` | `#44424c` | Popovers, focused inputs |
| `--text-1` | `#ecebef` | Primary text, active labels |
| `--text-2` | `#a8a5b1` | Secondary text, panel titles |
| `--text-3` | `#72707b` | Hints, disabled text, frame numbers |
| `--accent` | `#f2a93b` | Marigold: active tool, playhead, keyframes, primary button |
| `--accent-hover` | `#ffbd5a` | Primary button hover |
| `--accent-ink` | `#1a1206` | Text and icons on accent |
| `--accent-soft` | `rgba(242,169,59,.16)` | Active tool background, selected frame cell |
| `--select` | `#4c8dff` | Selection outlines and transform handles only |
| `--onion-before` / `--onion-after` | `#ff5d6c` / `#3ccf91` | Onion skin tints |
| `--danger` / `--success` / `--warning` | `#ff5d6c` / `#3ccf91` / `#f2c94c` | Status and toasts |

The accent appears only where it carries meaning: current tool, current frame, playhead, keyframes, the one primary action on screen. Never use it for decoration.

**Typography:** Geist for all UI and Geist Mono for timecode, frame numbers and numeric fields, bundled locally with @fontsource (the app works offline). Always use tabular numbers. Scale: 11px micro (frame numbers), 12px panel text, 13px default, 15px panel and section titles, 20px dialog titles, 28px welcome screen heading. Weights 400 and 600 only. Sentence case everywhere; no all-caps labels.

**Spacing and size:** 4px grid (4, 8, 12, 16, 24, 32). Menu bar 32px, tool options bar 36px, panel header 32px, toolbox buttons 36×36 with 20px icons, panel icons 16px, timeline rows 28px, frame cells 12–24px wide with zoom. Radius: 4px buttons and inputs, 6px panels and cards, 10px menus, popovers and dialogs. Panels are flat and separated by 1px borders; only floating elements (menus, popovers, dialogs, toasts) get a shadow: `0 12px 32px rgba(0,0,0,.5)` plus a 1px `--border-strong` outline.

**Icons:** lucide-react at 1.5 stroke width, one size per context, never mixed icon sets. Every icon button has a tooltip with its name and shortcut, e.g. "Brush (B)".

**Core components** (Radix UI primitives styled with tokens, all shown in Storybook):

- Button: primary (accent), secondary (raised), ghost, icon; sizes 28 and 32px.
- Numeric field with drag-to-scrub label and slider, used for brush size, opacity, fps, transform values.
- Color picker: HSV square with hue strip, hex input, recent colors, eyedropper button.
- Panel: header with title, collapse chevron and overflow menu; scroll area with thin custom scrollbars.
- Menu, context menu, dropdown, tabs, toggle, tooltip, toast, modal dialog.
- Command palette (Ctrl+K) that runs any menu action by name, and a shortcut sheet (press ?).

**States:** every interactive element has default, hover, pressed, focus-visible (2px `--accent` ring with 2px offset), selected and disabled (40% opacity, no pointer). Inputs show validation errors inline in `--danger` with the reason and the fix.

**Motion:** 120ms ease-out for hover and press, 180ms for panels opening and docking, 220ms for dialogs. No decorative or looping UI animation; the artwork is the only thing that moves. With reduced motion enabled, use instant changes.

**Signature element: the timeline.** Spend the polish here. Clean frame grid, marigold keyframe diamonds, a playhead with a timecode bubble (`00:04:12`), drawn-frame dots, AI storyboard beats as small labeled flags above the ruler, smooth zoom with Ctrl+wheel, and layers generated by AI marked with a small spark icon until the user edits them.

**Key screens beyond the workspace:**

- **Welcome:** large prompt field ("Describe an animation…"), size presets as cards (YouTube 16:9, Shorts 9:16, Square), recent projects grid whose thumbnails play on hover, and an AI status pill ("Local AI ready: qwen2.5-coder:14b" or a fix-it message).
- **AI generating:** storyboard beats appear on the timeline first, layers fill in as they arrive, and the AI docker shows progress ("Writing scene: 1,240 tokens") with a Cancel button.
- **Export dialog:** preset cards, live first-frame preview, file name, progress bar with frame count and time left, and "Show in folder" when done.
- **Empty states:** an empty timeline says "Draw on the canvas or ask the AI to start a scene" with both actions as buttons.

**Polish checklist** (every milestone must pass it):

- [ ] No hard-coded colors, sizes or font values outside `tokens.css`.
- [ ] Every icon button has a tooltip with its shortcut; every action is reachable from the menu and the command palette.
- [ ] Keyboard focus is visible and follows a logical order; all text meets WCAG AA contrast.
- [ ] Panels look right at 1366×768 and 2560×1440, and at 100%, 125% and 150% Windows scaling.
- [ ] No layout shift when panels load; long names truncate with an ellipsis and show the full name on hover.
- [ ] Loading, empty and error states exist for every panel.

## Technology stack

Use TypeScript everywhere in a pnpm monorepo. Do not add other major libraries without asking.

| Layer | Technology | Purpose |
| --- | --- | --- |
| Language | TypeScript 5 (strict mode), Node.js 20+ | One language for engine, server and UI |
| Monorepo | pnpm workspaces | Share the spec, engine and UI library between apps |
| Frontend | React 18 + Vite | Workspace, dockers, player |
| Design tokens | CSS custom properties in `packages/ui/src/tokens.css` | Single source for every color, size, radius, shadow |
| UI primitives | Radix UI | Accessible menus, dialogs, tooltips, sliders, tabs |
| UI styling | Tailwind CSS mapped to the tokens | Fast styling that can only use token values |
| Fonts | Geist + Geist Mono via @fontsource | Bundled locally, works offline |
| Component gallery | Storybook | Every component and state shown and checked |
| Dockable panels | dockview | Resizable, re-dockable panels with saved layout |
| Icons | lucide-react | One consistent icon set |
| Command palette | cmdk | Ctrl+K action search |
| Shortcuts | tinykeys | Krita-style keyboard shortcuts |
| UI state | Zustand | Current tool, frame, layers, chat, history |
| Pen input | Pointer Events API | Mouse and pen tablet with pressure |
| Stroke rendering | perfect-freehand | Smooth, pressure-sensitive brush outlines from stored points |
| JSON editor | CodeMirror 6 | Advanced view: hand-edit the scene spec with live validation |
| Renderer | Canvas 2D API (no game engine) | Deterministic drawing of the scene spec |
| Backend | Fastify | REST API + Server-Sent Events for progress |
| Validation | Zod + zod-to-json-schema | One schema: TS types, runtime checks, and the JSON schema sent to the AI |
| Patching | fast-json-patch (RFC 6902) | Apply AI edits as small patches; also used for undo history |
| Database | SQLite via better-sqlite3 + Drizzle ORM | Projects, spec versions, chat history |
| Local AI | Ollama, model `qwen2.5-coder:14b` | Storyboard and spec generation |
| Cloud fallback | Any OpenAI-compatible API (Gemini, Groq) | Optional, configured by `.env` |
| Video export | Puppeteer + ffmpeg (ffmpeg-static) | Render frames headlessly and encode MP4 |
| Testing | Vitest; Playwright for frame and UI screenshots | Schema, engine determinism, visual regressions |
| Lint/format | ESLint (incl. a rule blocking hex colors outside tokens) + Prettier | Consistent code and styling |

## Project structure

Keep the engine and spec in shared packages so the browser player and the headless exporter run exactly the same code.

```text
anim-studio/
├─ BRIEF.md
├─ README.md                  # setup, ollama pull command, how to run
├─ .env.example               # AI_PROVIDER, OLLAMA_URL, OLLAMA_MODEL, FALLBACK_*
├─ pnpm-workspace.yaml
├─ reference/
│  └─ autumn-window.html      # original demo, read-only
├─ packages/
│  ├─ spec/                   # the data contract
│  │  ├─ src/schema.ts        # Zod schema for SceneSpec
│  │  ├─ src/types.ts         # inferred TS types
│  │  ├─ src/json-schema.ts   # exports JSON schema for Ollama `format`
│  │  └─ examples/
│  │     └─ autumn-window.json
│  ├─ engine/                 # deterministic canvas renderer
│  │  ├─ src/index.ts         # createRenderer(canvas, spec) -> { render(t) }
│  │  ├─ src/tracks.ts        # keyframes, easing, integrate()
│  │  ├─ src/rng.ts           # seeded random
│  │  ├─ src/resolve.ts       # "$palette" and "@track" references
│  │  ├─ src/registry.ts      # object registry + catalog for AI prompt
│  │  └─ src/objects/
│  │     ├─ backgrounds/      # room, sky, window, hills, city
│  │     ├─ particles/        # leaves, rain, snow, stars, dust
│  │     ├─ props/            # lantern, mug, turntable, plant, pumpkin
│  │     ├─ characters/       # fox, cat
│  │     ├─ fx/               # glow, lightning, vignette, fade, grain
│  │     └─ text/             # title
│  ├─ ui/                     # design system: tokens + components
│  │  ├─ src/tokens.css
│  │  ├─ src/components/      # Button, NumberField, ColorPicker, Panel, Menu...
│  │  └─ stories/             # Storybook stories for every component state
│  └─ ai/                     # model access and prompts
│     ├─ src/providers/ollama.ts
│     ├─ src/providers/openai-compatible.ts
│     ├─ src/generate.ts      # storyboard -> spec -> validate -> repair
│     ├─ src/edit.ts          # instruction -> JSON Patch
│     └─ prompts/
│        ├─ storyboard.md
│        ├─ spec.md
│        ├─ repair.md
│        └─ edit.md
├─ apps/
│  ├─ server/                 # Fastify API
│  │  ├─ src/routes/          # generate, edit, projects, export, health
│  │  ├─ src/db/              # Drizzle schema + migrations
│  │  └─ src/export/          # puppeteer + ffmpeg pipeline
│  └─ web/                    # React + Vite
│     ├─ src/pages/           # NewProject, Editor, Projects, RenderOnly
│     ├─ src/workspace/       # dockview layout, menu bar, tool options bar
│     ├─ src/tools/           # brush, eraser, fill, shapes, transform, select, eyedropper
│     ├─ src/dockers/         # Timeline, Layers, Color, BrushPresets, AIAssistant, History
│     ├─ src/canvas/          # view (zoom/pan/rotate), onion skin, pointer input
│     ├─ src/components/      # shared UI pieces, SpecEditor
│     └─ src/store/
└─ data/                      # sqlite db + exported mp4 (gitignored)
```

## Scene spec format

The scene spec is the only thing the AI produces. Define it once in `packages/spec/src/schema.ts` with Zod; everything else derives from it.

```json
{
  "version": 1,
  "meta": { "title": "autumn window", "duration": 12, "fps": 30, "width": 1280, "height": 720 },
  "palette": { "fox": "#e9773c", "sky": "#4d3f7d" },
  "tracks": {
    "wind":     { "keys": [[0, 0.35], [4.3, 0.35], [5.2, 1.8], [8.6, 0.45]], "ease": "inOut" },
    "foxAwake": { "keys": [[0, 0], [8.05, 0], [8.6, 1], [10.3, 1], [11, 0]] },
    "lampOn":   { "keys": [[0, 0.1], [2, 0.1], [2.6, 1]], "ease": "step" }
  },
  "camera": { "zoom": "@camZoom", "x": 760, "y": 400 },
  "layers": [
    { "id": "bg",  "type": "room", "params": {} },
    { "id": "fox", "type": "fox",  "params": { "x": 820, "y": 596, "color": "$fox", "awake": "@foxAwake" } }
  ],
  "overlays": [ { "type": "vignette" }, { "type": "title", "params": { "text": "autumn window", "opacity": "@title" } } ],
  "beats": [ { "at": 8, "label": "Leaf lands", "note": "fox wakes" } ]
}
```

Rules:

- **Coordinates** are logical units with origin top-left, sized by `meta.width` × `meta.height`. The engine scales to the real canvas size.
- **References:** a string starting with `$` reads a palette color; a string starting with `@` reads a track's value at the current time. Any numeric param may be a number or an `@track`.
- **Tracks** are keyframes `[time, value]` sorted by time. `ease` is one of `linear`, `inOut`, `in`, `out`, `step`; default `inOut`.
- **Layers** draw in array order (first = back). Each layer `type` must exist in the engine registry, and its `params` are validated against that object's own Zod schema.
- **Time** never exceeds `meta.duration`. Periodic motions should divide evenly into the duration so loops are seamless.
- `beats` are for the UI timeline and for the AI's planning; the engine ignores them.
- Port the reference demo to `examples/autumn-window.json` as the first valid example.

**Hand-drawn layers.** Drawings are stored as vector strokes inside the same spec, so drawn and AI-made layers share one timeline, one renderer and one export path:

```json
{
  "id": "bird",
  "type": "drawing",
  "params": { "opacity": 1, "blend": "normal" },
  "transform": { "x": "@birdX", "y": 300, "rotation": 0, "scale": 1 },
  "frames": [
    { "start": 0,     "strokes": [ { "tool": "brush", "preset": "ink", "color": "#2b2130", "size": 6,
                                    "points": [[412, 300, 0.4], [418, 296, 0.7], [430, 294, 0.8]] } ] },
    { "start": 0.083, "strokes": [ { "tool": "fill", "at": [420, 310], "color": "#f2b03c" } ] }
  ]
}
```

- A drawing frame is shown from its `start` until the next frame's `start` (hold exposure, like Krita).
- Points are `[x, y, pressure]`. The engine renders strokes with perfect-freehand and replays fills and erases in order, so output stays deterministic.
- Times are stored in seconds; the UI converts to frame numbers with `meta.fps`.
- Any layer, drawn or object, may have a `transform` whose values can be `@track` references. This is how the AI animates a user's drawing.

## Renderer engine

The engine is a pure function of time: `render(t)` must produce the identical frame every time for the same spec and `t`. Scrubbing, looping and MP4 export all depend on this.

Requirements:

- **API:** `createRenderer(canvas, spec)` returns `{ render(t: number), setSpec(spec), dispose() }`. No timers inside the engine; the player calls `render(t)` from `requestAnimationFrame`.
- **Determinism:** no `Math.random()`, `Date.now()` or accumulated state between frames. Use the seeded RNG; precompute particles from a seed. For motion driven by a changing value (wind pushing leaves), use the integral of the track up to `t`, as the reference demo does.
- **Object registry:** every object type is one file exporting a definition:

```ts
export const fox = defineObject({
  type: "fox",
  category: "characters",
  description: "A fox curled up asleep; can wake, twitch ears and sway tail.",
  params: z.object({
    x: num, y: num, scale: num.default(1),
    color: color.default("#e9773c"),
    awake: num.default(0)            // 0 asleep .. 1 eyes open
  }),
  draw(ctx, p, t, env) { /* canvas drawing */ }
});
```

- `num` accepts a number or an `@track` string; `color` accepts a hex or a `$palette` string. The engine resolves references before calling `draw`, so `draw` always gets plain values.
- **Catalog for the AI:** `registry.catalog()` returns a compact text list of every type with its description, params and defaults. The AI prompts are built from this automatically, so adding an object file makes it available to the AI with no prompt edits.
- **Starting library (Milestone 1):** port every object from the reference demo (wall/room, window + outside view with falling leaves, window frame, plant, light shaft, lantern, turntable, music notes, pumpkin, stool + mug with steam, cushion, fox, hero leaf on a path, glow, vignette, title, fade). Add a generic `path-mover` that moves any small prop along a Bézier between two times.
- **Original art only:** never add objects that copy a known character, brand or artwork.
- **Performance:** hold 60 fps at 1920×1080 in Chrome on the user's PC; cache gradients and precomputed geometry per spec.

## AI layer

The default model is local: Ollama at `http://localhost:11434` running `qwen2.5-coder:14b` on an RTX 3060 12GB. Expect roughly 25–30 tokens per second, so a full spec takes 1–2 minutes; design the UI around that wait.

**Generation pipeline** (`packages/ai/src/generate.ts`):

1. **Storyboard call.** Input: user prompt, duration, aspect. Output JSON: `{ title, mood, palette, beats: [{ at, label, note }] }`. Small and fast.
2. **Spec call.** Input: storyboard + `registry.catalog()` + one full example spec. Output: a SceneSpec. Pass the JSON schema from `packages/spec` as Ollama's `format` so output is forced into valid JSON shape.
3. **Validate** with Zod, including per-object param schemas and unknown-type checks.
4. **Repair loop.** If invalid, send the spec and the exact Zod error messages to the repair prompt. Maximum 3 attempts, then return the errors to the user.

**Ollama call settings:** `stream: true` (forward progress to the UI), `temperature: 0.4`, `num_ctx: 8192`. Keep prompts short enough that system prompt + example + output fit in 8K tokens. If the example spec is too long, use a trimmed example.

**Edit pipeline** (`edit.ts`): input = current spec + user instruction. Output = a JSON Patch array (RFC 6902) changing only what was asked. Apply with fast-json-patch, then validate. If the model returns a broken patch twice, fall back to asking for the full updated spec.

**Prompts** live as Markdown files in `packages/ai/prompts/`, loaded at runtime, with `{{catalog}}`, `{{example}}`, `{{storyboard}}` placeholders. Each prompt must state: output JSON only, use only listed object types, keep all times within duration, make periodic motion loop-friendly.

**Providers:** one interface `generateJSON({ system, user, schema, onToken })`. Implement `ollama` and `openai-compatible` (base URL + key + model from `.env`), so Gemini or Groq free tiers can be used as a fallback with no code changes. Add `GET /api/health` that reports whether Ollama is reachable and the model is pulled.

## Backend API and web app

**API endpoints** (Fastify, JSON):

| Method | Path | Does |
| --- | --- | --- |
| POST | `/api/generate` | Body `{ prompt, duration, aspect }`. Starts generation, returns `{ jobId }` |
| GET | `/api/jobs/:id/events` | SSE stream: `storyboard`, `token` progress, `repairing`, `done` (with spec), `error` |
| POST | `/api/projects/:id/edit` | Body `{ instruction }`. Returns `{ patch, spec, version }` |
| GET | `/api/projects` | List projects with title, duration, updated time |
| GET / PUT | `/api/projects/:id` | Read or save a project (manual JSON edits) |
| POST | `/api/projects/:id/undo` | Restore the previous spec version |
| POST | `/api/projects/:id/export` | Body `{ preset }`. Starts MP4 export, returns `{ jobId }` |
| GET | `/api/exports/:file` | Download a finished MP4 |
| GET | `/api/health` | Ollama status, model name, GPU/model loaded |

Store every spec change as a new version row so undo always works.

**Web screens:**

- **New project:** large prompt box, duration slider (5–30s), aspect buttons (16:9, 9:16, 1:1), Generate button. While generating, show the storyboard beats as soon as they arrive, then a progress indicator for the spec.
- **Editor:** the Krita-style workspace described in "Workspace and drawing tools", with the AI assistant as a docker and the spec editor as an optional advanced panel. Export is in the menu bar.
- **Projects:** grid of saved projects with a thumbnail frame rendered at the midpoint.
- **Render-only page** (`/render/:id`): a bare full-size canvas with `window.renderFrame(t)` exposed, used only by the exporter.

Show clear, actionable errors: "Ollama is not running — start it and refresh", "Model not found — run `ollama pull qwen2.5-coder:14b`".

## Video export

Export renders every frame with the same engine in headless Chrome and pipes the frames into ffmpeg, so the MP4 matches the preview exactly.

1. Puppeteer opens `/render/:id?w=<width>&h=<height>` and waits for `window.renderReady`.
2. For frame `i` from 0 to `duration × fps − 1`: call `renderFrame(i / fps)`, read the canvas as PNG (`canvas.toDataURL` or `toBlob`), and write it to ffmpeg's stdin.
3. ffmpeg command: `-f image2pipe -framerate <fps> -i - -c:v libx264 -pix_fmt yuv420p -crf 18 -preset medium -movflags +faststart out.mp4`.
4. Report progress (frame i of N) over SSE; save to `data/exports/`.

Presets:

| Preset | Size | fps |
| --- | --- | --- |
| YouTube | 1920×1080 | 30 |
| Shorts / Reels / TikTok | 1080×1920 | 30 |
| Square | 1080×1080 | 30 |
| Draft (fast) | 960×540 | 24 |

If the spec's aspect does not match the preset, letterbox it; never stretch. Optional later: an audio track (music file) muxed with `-shortest`.

## Build milestones

Build in this order. Finish one milestone, make sure its "done when" passes, then stop and report.

| # | Milestone | Done when |
| --- | --- | --- |
| 1 | Monorepo, `spec` package, `engine` with all reference objects, ui package (tokens, fonts, core components in Storybook), Krita-style workspace shell (menu, toolbox, canvas, dockers, timeline) with playback, welcome screen | `examples/autumn-window.json` plays in the canvas and looks the same as `reference/autumn-window.html`; scrubbing works; panels dock and resize; polish checklist passes; determinism test passes |
| 2 | Drawing: brush, eraser, fill, shapes, select, transform, eyedropper; drawing layers; frame-by-frame timeline; onion skin; undo/redo | A user can draw a 12-frame flipbook with a pen tablet, see onion skin, play it at 12 fps, and undo any step |
| 3 | AI generation with Ollama: storyboard, spec, validate, repair, SSE progress, AI assistant docker | A prompt produces a valid scene that appears as layers in the timeline and plays |
| 4 | AI editing: chat edits via JSON Patch, animate drawn layers, version history, SQLite projects | "Make the leaves fall faster" and "make my bird fly left to right" change only the right values; projects survive restart |
| 5 | MP4 export with presets and progress | A 12s scene exports a playable 1080×1920 MP4 matching the preview |
| 6 | Library growth and polish: rain, snow, stars, lightning, city skyline, cat, brush presets, style presets, cloud fallback provider | At least 10 new objects, each with a demo spec; fallback provider works from `.env` |

## Rules for the AI agent

Follow these on every milestone:

- Work one milestone at a time. At the end, stop and report: what you built, how to run it, what is not done, and any decision you made that this brief did not cover.
- Ask before changing the scene spec format, adding a major dependency, or deviating from the folder structure.
- TypeScript strict mode, no `any` in the `spec` and `engine` packages.
- The engine must stay deterministic: no `Math.random()`, `Date.now()` or frame-to-frame state. Use the seeded RNG.
- Every object file has a Zod param schema, defaults, and a one-sentence description, because the AI catalog is generated from them.
- All art is original. Do not draw or name known characters, mascots, logos or artworks.
- Never commit secrets; provide `.env.example` with every variable documented.
- Keep the README current: install steps (Node, pnpm, Ollama, `ollama pull qwen2.5-coder:14b`), `pnpm dev`, and how to export.

* Build all UI from `packages/ui`. If a screen needs something new, add it to the library with a Storybook story first, then use it.
* Before reporting a milestone done, take Playwright screenshots of every changed screen at 1366×768 and 1920×1080, check them against the polish checklist, and fix what fails.

**Required tests:**

- [ ] Every file in `packages/spec/examples/` validates against the schema.
- [ ] Determinism: rendering the same spec at the same `t` twice gives an identical pixel hash.
- [ ] Reference resolution: `$palette` and `@track` values resolve correctly; unknown references fail validation.
- [ ] Track evaluation: easing, `step`, values before the first and after the last key.
- [ ] AI layer: with a mocked provider, an invalid spec triggers repair and a valid one passes on the first try.
- [ ] Export (Milestone 4): a 2-second test spec exports an MP4 with the expected frame count.
