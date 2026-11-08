# Graph Report - anim-studio  (2026-11-05)

## Corpus Check
- 210 files · ~93,455 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: .css 2, .example 1, (none) 1)

## Summary
- 1384 nodes · 3516 edges · 71 communities (63 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Engine Images & Bitmaps
- Layered Scene Generation
- Canvas View & Tools
- Server & Store
- Web Package Deps
- Editor Store Actions
- Root Tooling Deps
- Export Dialog & Brushes
- AI Edit Tests
- Server Package Deps
- Night Smoke Scene
- Server App & Images
- Generate Routes & Jobs
- Spec Schema
- UI Dialogs & Palette
- Path Mover & Registry
- Layers Docker
- App Pages & Thumbs
- AI Painting Client
- AI Edit Pipeline
- Paint Tool & Bounds
- Actions & Tracks
- Desktop Package
- AI Prompts
- AI Provider Config
- Examples & E2E Helpers
- MP4 Export
- Engine Package Deps
- UI Button
- Toast & Main
- Studio State
- AI Package Deps
- Card Picker
- Spec Package
- UI Package Deps
- CI Workflow
- UI Radix Deps
- TS Base Config
- Layered CLI
- AI Status & Assistant
- Layered E2E
- Button Stories
- Color Picker
- UI Package Meta
- Panel & EmptyState
- Setup AI Script
- Setup Painter Script
- ComfyUI Painter
- Renderer
- NumberField
- Lofi Draw E2E
- Build Script
- Project Routes
- Community 53
- Community 54
- Vite Config
- Community 56
- Electron Main
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70

## God Nodes (most connected - your core abstractions)
1. `useStudio` - 48 edges
2. `defineObject()` - 43 edges
3. `generateLayered()` - 41 edges
4. `num` - 40 edges
5. `SceneSpec` - 39 edges
6. `cx()` - 38 edges
7. `validateScene()` - 34 edges
8. `createRenderer()` - 32 edges
9. `color` - 30 edges
10. `Button` - 28 edges

## Surprising Connections (you probably didn't know these)
- `Layered scene planning prompt` --semantically_similar_to--> `Motion actions (breathe, bob, blink, swing, sway, drift, look_at, path)`  [INFERRED] [semantically similar]
  packages/ai/prompts/layered.md → README.md
- `Layered scene planning prompt` --semantically_similar_to--> `Ambient effects (stars, falling-leaves, birds, steam, rain)`  [INFERRED] [semantically similar]
  packages/ai/prompts/layered.md → README.md
- `buildApp()` --calls--> `configFromEnv()`  [EXTRACTED]
  apps/server/src/app.ts → packages/ai/src/config.ts
- `buildApp()` --calls--> `providerFor()`  [EXTRACTED]
  apps/server/src/app.ts → packages/ai/src/config.ts
- `buildApp()` --calls--> `comfyHealth()`  [EXTRACTED]
  apps/server/src/app.ts → packages/ai/src/painters/comfyui.ts

## Import Cycles
- None detected.

## Communities (71 total, 8 thin omitted)

### Community 0 - "Engine Images & Bitmaps"
Cohesion: 0.05
Nodes (73): Bitmap, Factory, frameUrl(), getImage(), images, makeCanvas(), balcony, Building (+65 more)

### Community 1 - "Layered Scene Generation"
Cohesion: 0.07
Nodes (54): AMBIENT, AMBIENT_PERIOD, Frac, generateLayered(), IDLE, label(), LayeredEvent, LayeredPlan (+46 more)

### Community 2 - "Canvas View & Tools"
Cohesion: 0.07
Nodes (37): CanvasView(), cssVar(), TOOLS, visibleSpec(), loading, loadSpecImages(), bbox(), newDrawingLayer() (+29 more)

### Community 3 - "Server & Store"
Cohesion: 0.06
Nodes (30): start(), buildApp(), createStore(), Store, projects, versions, app, dir (+22 more)

### Community 4 - "Web Package Deps"
Cohesion: 0.06
Nodes (46): dependencies, @anim/engine@workspace:^, @anim/spec@workspace:^, @anim/ui@workspace:^, dockview-react@^8.8.2, @fontsource/figtree@^5.3.0, @fontsource/geist-mono@^5.3.0, @fontsource/geist-sans@^5.3.0 (+38 more)

### Community 5 - "Editor Store Actions"
Cohesion: 0.14
Nodes (38): addStroke(), DEFAULTS, deleteFrame(), deleteLayer(), duplicateFrame(), findLayer(), framesOf(), frameTime() (+30 more)

### Community 6 - "Root Tooling Deps"
Cohesion: 0.06
Nodes (41): devDependencies, eslint@^10.13.0, eslint-plugin-react-hooks@^7.1.1, playwright@^1.64.1, prettier@^3.9.10, @types/node@^22, typescript@^5, typescript-eslint@^8.72.1 (+33 more)

### Community 7 - "Export Dialog & Brushes"
Cohesion: 0.09
Nodes (28): zustand@^5.0.16, ExportDialog(), BrushPresetsDocker(), PRESETS, ColorDocker(), HistoryDocker(), AUTOSAVE_KEY, Editor() (+20 more)

### Community 8 - "AI Edit Tests"
Cohesion: 0.09
Nodes (26): frames(), valid(), bird, scene, windowIdx, withBird, MAX_TURN, RenderOptions (+18 more)

### Community 9 - "Server Package Deps"
Cohesion: 0.07
Nodes (36): dependencies, @anim/ai@workspace:^, @anim/engine@workspace:^, @anim/spec@workspace:^, better-sqlite3@^13.0.3, drizzle-orm@^0.45.4, fastify@^5.12.7, ffmpeg-static@^5.3.0 (+28 more)

### Community 10 - "Night Smoke Scene"
Cohesion: 0.09
Nodes (31): BLINK, brush(), C, canvas, curve(), draw(), dust, ellipse() (+23 more)

### Community 11 - "Server App & Images"
Cohesion: 0.10
Nodes (20): DATA, ffmpegBin, imageStore(), healthRoutes(), localHealth(), app, config, dir (+12 more)

### Community 12 - "Generate Routes & Jobs"
Cohesion: 0.12
Nodes (25): cancelJob(), getJob(), Body, generateRoutes(), Layered, AnimateFn, Aspect, ASPECT_SIZE (+17 more)

### Community 13 - "Spec Schema"
Cohesion: 0.10
Nodes (25): sceneSpecJsonSchema, ACTION_CHANNELS, ACTION_TYPES, ActionSchema, AssetSchema, BeatSchema, CameraSchema, DrawingFrameSchema (+17 more)

### Community 14 - "UI Dialogs & Palette"
Cohesion: 0.17
Nodes (23): CommandPalette(), Dialog(), DialogProps, ContextMenu(), Dropdown, MenuAction, MenuBar(), menuContentCls (+15 more)

### Community 15 - "Path Mover & Registry"
Cohesion: 0.10
Nodes (19): clamp(), pathMover, pt, Category, Env, getObject(), ObjectDef, parsedCache (+11 more)

### Community 16 - "Layers Docker"
Cohesion: 0.18
Nodes (25): BLEND_LABEL, CATEGORY_ICON, DrawingProps(), ICON, LayersDocker(), PivotProps(), RenameField(), Clock() (+17 more)

### Community 17 - "App Pages & Thumbs"
Cohesion: 0.14
Nodes (17): App(), SceneThumb(), RenderOnly(), Window, ASPECT_ICON, ExampleCard(), usePainter(), Welcome() (+9 more)

### Community 18 - "AI Painting Client"
Cohesion: 0.14
Nodes (24): animatePainting(), Aspect, aspectOf(), AssetStatus, Box, cancelGeneration(), ChatMessage, describe() (+16 more)

### Community 19 - "AI Edit Pipeline"
Cohesion: 0.12
Nodes (19): check(), EditResult, editScene(), hideStrokes(), missing(), patchJsonSchema, PatchSchema, normalize() (+11 more)

### Community 20 - "Paint Tool & Bounds"
Cohesion: 0.13
Nodes (22): paintTool(), layerPivot(), objectBounds(), pivotCache, bboxCache, Brush, BRUSH_PRESETS, CanvasFactory (+14 more)

### Community 21 - "Actions & Tracks"
Cohesion: 0.18
Nodes (21): actionOffsets(), actionTracks(), boxOf(), center(), Channel, compileActions(), fitPeriod(), Keys (+13 more)

### Community 22 - "Desktop Package"
Cohesion: 0.11
Nodes (21): dependencies, @anim/server@workspace:^, @fastify/static@^10.1.8, devDependencies, electron@^45.2.0, electron-builder@^26.18.0, esbuild@^0.28.2, main (+13 more)

### Community 23 - "AI Prompts"
Cohesion: 0.10
Nodes (22): Edit prompt (JSON patch scene editing), Layer transform for animating drawings, Track and palette references (@track, $palette), Fractional box/path coordinates, Layered scene planning prompt, Plan schema (title, mood, beats, setting, environment, lighting, characters, props, ambient, actions), Walk action (fixed walking pose), AI editing via JSON Patch (RFC 6902) (+14 more)

### Community 24 - "AI Provider Config"
Cohesion: 0.19
Nodes (11): configFromEnv(), providerFor(), withFallback(), ollama(), openaiCompatible(), lines(), ollamaSchema(), GenerateJSONArgs (+3 more)

### Community 25 - "Examples & E2E Helpers"
Cohesion: 0.15
Nodes (10): dir, CANDIDATES, launch(), out, TIMES, errors, out, errors (+2 more)

### Community 26 - "MP4 Export"
Cohesion: 0.18
Nodes (14): exportMp4(), frameCount(), loadFonts(), loadImages(), Preset, PRESETS, Job, JobEvent (+6 more)

### Community 27 - "Engine Package Deps"
Cohesion: 0.13
Nodes (18): dependencies, @anim/spec@workspace:*, perfect-freehand@^1.2.3, zod@^4.1.0, devDependencies, @napi-rs/canvas@^1.1.0, exports, @anim/spec (+10 more)

### Community 28 - "UI Button"
Cohesion: 0.17
Nodes (14): Button, ButtonProps, IconButtonProps, Variant, variants, Tabs(), Toggle(), Tooltip() (+6 more)

### Community 29 - "Toast & Main"
Cohesion: 0.13
Nodes (8): Ctx, Toast, ToastProvider(), Tone, toneCls, TooltipProvider(), preview, @storybook/react-vite

### Community 30 - "Studio State"
Cohesion: 0.12
Nodes (4): Generation, StudioState, Renderer, SceneSpec

### Community 31 - "AI Package Deps"
Cohesion: 0.14
Nodes (17): dependencies, @anim/engine@workspace:*, @anim/spec@workspace:*, fast-json-patch@^3.1.1, zod@^4.1.0, exports, @anim/engine, @anim/spec (+9 more)

### Community 32 - "Card Picker"
Cohesion: 0.17
Nodes (8): Preset, PRESETS, State, CardPicker(), PickerCard, dot, ArtStyles(), swatch()

### Community 33 - "Spec Package"
Cohesion: 0.14
Nodes (15): dependencies, zod@^4.1.0, devDependencies, @anim/engine@workspace:*, exports, ./examples/*, @anim/engine, zod (+7 more)

### Community 34 - "UI Package Deps"
Cohesion: 0.12
Nodes (16): devDependencies, @fontsource/geist-mono@^5.3.0, @fontsource/geist-sans@^5.3.0, storybook@^10.6.5, @storybook/react-vite@^10.6.5, tailwindcss@^4.3.3, @tailwindcss/vite@^4.3.3, @types/react@^18 (+8 more)

### Community 35 - "CI Workflow"
Cohesion: 0.13
Nodes (14): runs-on, steps, jobs, ci, name, branches, run, uses (+6 more)

### Community 36 - "UI Radix Deps"
Cohesion: 0.13
Nodes (15): dependencies, lucide-react@^1.65.0, @radix-ui/react-context-menu@^2.4.1, @radix-ui/react-dialog@^1.3.1, @radix-ui/react-dropdown-menu@^2.2.1, @radix-ui/react-menubar@^1.2.1, @radix-ui/react-slider@^1.6.1, @radix-ui/react-toggle@^1.2.1 (+7 more)

### Community 37 - "TS Base Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+5 more)

### Community 38 - "Layered CLI"
Cohesion: 0.15
Nodes (11): bin, canvas, enc, n, out, painter, [prompt = "A girl is sleeping on a balcony at night. Create a 6-second animation. At 3 seconds, she wakes up and looks at the clock.", dur = "6"], provider (+3 more)

### Community 39 - "AI Status & Assistant"
Cohesion: 0.27
Nodes (11): AIStatus, useAIStatus(), AIAssistantDocker, ASSET_ICON, ASSET_TONE, AssetRow(), LAYERED, PHASE_LABEL (+3 more)

### Community 40 - "Layered E2E"
Cohesion: 0.17
Nodes (5): envFile, port, out, procs, root

### Community 41 - "Button Stories"
Cohesion: 0.18
Nodes (11): IconButton, AllStates(), Disabled, Ghost, IconButtons(), meta, Primary, S (+3 more)

### Community 42 - "Color Picker"
Cohesion: 0.33
Nodes (8): hexToHsv(), HSV, hsvToHex(), ColorPicker(), ColorPickerProps, useDrag(), Default(), NoRecent()

### Community 43 - "UI Package Meta"
Cohesion: 0.20
Nodes (9): @radix-ui/react-toast@^1.3.1, @types/react-dom@^18, @types/react-dom, main, name, private, type, version (+1 more)

### Community 44 - "Panel & EmptyState"
Cohesion: 0.53
Nodes (9): EmptyState(), Panel(), Box(), Collapsed(), Empty(), Error(), Loading(), LongTitle() (+1 more)

### Community 45 - "Setup AI Script"
Cohesion: 0.29
Nodes (8): envFile, install(), isLocal, log(), run(), tags(), URL_, waitForServer()

### Community 46 - "Setup Painter Script"
Cohesion: 0.33
Nodes (9): download(), expectedHash(), extra, install(), log(), models, portable, root (+1 more)

### Community 47 - "ComfyUI Painter"
Cohesion: 0.36
Nodes (8): maskFrom(), comfyui(), ensureRunning(), run(), upload(), sleep(), workflow(), AIError

### Community 48 - "Renderer"
Cohesion: 0.33
Nodes (8): drawFrame(), frameIndexAt(), setCanvasFactory(), CanvasLike, createRenderer(), drawDrawing(), mul(), parseParams()

### Community 49 - "NumberField"
Cohesion: 0.36
Nodes (7): clamp(), NumberField(), NumberFieldProps, Default(), Disabled(), ValidationError(), WithSlider()

### Community 50 - "Lofi Draw E2E"
Cohesion: 0.25
Nodes (3): out, procs, root

### Community 51 - "Build Script"
Cohesion: 0.29
Nodes (3): here, root, stage

### Community 52 - "Project Routes"
Cohesion: 0.38
Nodes (6): bad(), Edit, Id, missing(), projectRoutes(), Save

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 54 - "Community 54"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 56 - "Community 56"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 57 - "Electron Main"
Cohesion: 0.70
Nodes (4): ./dist/server.mjs, createWindow(), startBundledServer(), waitFor()

### Community 58 - "Community 58"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 59 - "Community 59"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 60 - "Community 60"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 61 - "Community 61"
Cohesion: 0.50
Nodes (4): scripts, build-storybook, storybook, typecheck

### Community 62 - "Community 62"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (3): exports, ./theme.css, ./tokens.css

## Knowledge Gaps
- **21 isolated node(s):** `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 465 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SceneSpec` connect `Studio State` to `Layered Scene Generation`, `Canvas View & Tools`, `Server & Store`, `Editor Store Actions`, `Export Dialog & Brushes`, `AI Edit Tests`, `Night Smoke Scene`, `Generate Routes & Jobs`, `Spec Schema`, `Path Mover & Registry`, `Layers Docker`, `App Pages & Thumbs`, `AI Painting Client`, `AI Edit Pipeline`, `Paint Tool & Bounds`, `Actions & Tracks`, `MP4 Export`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `generateLayered()` (e.g. with `.decode()` and `.encode()`) actually correct?**
  _`generateLayered()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `../../tsconfig.base.json`, `../../tsconfig.base.json`, `../../tsconfig.base.json` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Engine Images & Bitmaps` be split into smaller, more focused modules?**
  _Cohesion score 0.054901960784313725 - nodes in this community are weakly interconnected._
- **Why does `vitest` connect `AI Edit Tests` to `Layered Scene Generation`, `Server & Store`, `Editor Store Actions`, `Root Tooling Deps`, `Server App & Images`, `Path Mover & Registry`, `AI Edit Pipeline`, `AI Provider Config`, `Examples & E2E Helpers`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Should `Layered Scene Generation` be split into smaller, more focused modules?**
  _Cohesion score 0.07139079851930195 - nodes in this community are weakly interconnected._
- **Should `Canvas View & Tools` be split into smaller, more focused modules?**
  _Cohesion score 0.0701344243132671 - nodes in this community are weakly interconnected._