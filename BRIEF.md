# Prompt-to-Animation Tool — Build Brief for AI

Oct 31, 2026 · @sokphaladam

## How to use this brief

Give this whole document to an AI coding agent (Claude Code, Cursor, or similar) as its build instructions. It defines the goal, stack, folder layout, data contract and milestones, so the agent builds one milestone at a time instead of guessing.

1. Open the agent from the repository root.
2. Ask it to read `BRIEF.md`, `README.md`, the current implementation and the Git status before changing anything.
3. Ask it to build **one milestone only**. Do not ask it to skip unfinished acceptance criteria from earlier milestones.
4. After implementation, require tests, a summary of changed files, setup/run instructions and known limitations. The agent must stop after that milestone.
5. Do not commit, push, or change remote repository state unless explicitly asked.

Everything below this section is written to the AI coding agent.

## Project goal

Build **Anim Studio**: a local, Krita-style 2D animation studio with a desktop application and an editable browser-based workspace. The user can draw and animate by hand with brushes, layers and a frame timeline, or describe a scene and let local AI generate artwork and animation structure. The user can keep editing either way and export MP4.

The core design rule is: **AI may generate artwork and propose scene structure, but it must not replace the editable project or the deterministic renderer.** Language models plan scenes, assets, layers and timed actions. Image models create the visual assets and alternate poses. Vision and segmentation models identify editable parts. A deterministic TypeScript engine composes the stored assets, layers, transforms and keyframes. The renderer must not ask an AI model to invent a new image on every playback frame.

User flow:
1. The user enters a prompt, e.g. "a girl sleeping on a balcony at night, 6 seconds; at 3 seconds she wakes up and looks at the clock".
2. The AI creates a scene plan containing the environment, characters, props, independently editable assets and timed actions.
3. The image-generation pipeline creates the background and separate character/prop artwork, then extracts transparent layers where needed.
4. The server validates the scene and asset references, and reports useful errors or requests repair when required.
5. The browser opens the result as editable layers and timeline tracks. The user can move, redraw, hide, reorder and animate parts.
6. The user refines the scene by chat or manual editing and exports MP4.

The app runs locally on the user's PC. Keep the local-first workflow and the configured local AI/image-generation providers. Any cloud fallback must remain optional.

## Workspace and drawing tools (Krita-style)

The editor is a dark, dockable creative workspace with the toolbox on the left, canvas in the center, dockers on the right and animation timeline along the bottom. Follow familiar Krita-style workspace conventions, but use original icons, artwork and UI. Do not copy Krita's code, artwork or branding.

**Toolbox:**

| Tool | Shortcut | Behavior |
| --- | --- | --- |
| Brush | B | Pressure-sensitive strokes from mouse or pen tablet; size, opacity, smoothing and presets |
| Eraser | E | Erases strokes on the current frame |
| Fill | F | Fills a closed area on the current frame |
| Shapes | U | Line, rectangle and ellipse; hold Shift to constrain |
| Move / Transform | T | Move, scale and rotate a layer or selection; auto-key creates transform keyframes |
| Select | S | Rectangle and lasso selection on the current frame |
| Eyedropper | P, or Ctrl while brushing | Picks a color from the canvas |
| View | Space drag, Ctrl+wheel | Pan and zoom the canvas view |

**Timeline docker:** a grid of layers by frames. Users can insert a blank frame, duplicate or delete a frame, drag frames to retime, set FPS and play range, loop, and step frame-by-frame. Object and rigged-part layers show keyframes as diamonds. AI storyboard beats appear as markers above the frame numbers.

**Onion skin:** show up to 3 frames before and after the current frame with adjustable opacity and distinct tints.

**Layers docker:** drawing layers, object/image layers, character groups and ordinary groups. Each layer has visibility, lock, opacity, blend mode, rename and drag-to-reorder. AI-generated layers show a small generated marker until the user edits them.

**AI assistant docker:** prompt box and chat history. It can create a scene, generate separate assets, add layers, change keyframes, or animate a drawn or rigged layer. A request such as "make my drawn bird fly from left to right in 3 seconds" should add deterministic transform keyframes to that layer.

**History:** undo/redo across drawing and AI edits, plus autosave using the existing project persistence system.

## Visual design system

The app must look like a finished professional creative tool: calm graphite surfaces that let the artwork stand out, one warm accent, crisp type, and consistent behavior. Build screens from the existing token file and shared component library; do not invent one-off styles.

**Color tokens** (`packages/ui/src/tokens.css`, dark theme by default):

| Token | Value | Use |
| --- | --- | --- |
| `--bg-app` | `#16151a` | Window background and gaps between panels |
| `--bg-panel` | `#1e1d23` | Docker and toolbar surfaces |
| `--bg-raised` | `#28272e` | Inputs, buttons and timeline rows |
| `--bg-hover` | `#32313a` | Hover state |
| `--canvas-surround` | `#0e0e11` | Area around canvas; transparency uses a checkerboard |
| `--border` | `#2d2c33` | Dividers |
| `--border-strong` | `#44424c` | Popovers and focused inputs |
| `--text-1` | `#ecebef` | Primary text |
| `--text-2` | `#a8a5b1` | Secondary text |
| `--text-3` | `#8f8d98` | Hints and disabled text (lightened from `#72707b` to meet WCAG AA) |
| `--accent` | `#f2a93b` | Active tool, playhead, keyframes and primary action |
| `--accent-hover` | `#ffbd5a` | Primary action hover |
| `--select` | `#4c8dff` | Selection outlines and transform handles |
| `--danger` / `--success` / `--warning` | `#ff5d6c` / `#3ccf91` / `#f2c94c` | Status and toasts |

Use the existing typography, spacing, radii, icon and component conventions already in the repository. The accent is functional, not decorative. Every interactive element needs visible focus, hover, pressed, selected and disabled states. Respect reduced-motion settings.

**Polish checklist** (every milestone must pass it):
- [x] No hard-coded colors, sizes or font values outside the shared tokens where tokens apply.
- [x] Every icon button has a tooltip; actions are reachable from the menu or command palette where applicable.
- [x] Keyboard focus is visible and follows a logical order; text meets WCAG AA contrast.
- [x] Panels work at 1366×768 and 1920×1080, including common Windows display scaling.
- [x] Long names truncate cleanly and expose the full name on hover.
- [x] Loading, empty and error states exist for every changed panel.

## Technology stack

Use the current versions and conventions already in the repository. Do not add another frontend, renderer, database, job system or major dependency without asking.

| Layer | Technology | Purpose |
| --- | --- | --- |
| Language | TypeScript, strict mode; Node.js 20+ | Shared language across engine, server and UI |
| Monorepo | npm workspaces | Shared spec, engine, AI and UI packages |
| Frontend | React + Vite | Workspace, dockers and player |
| Desktop | Electron | Desktop application wrapper |
| Backend | Fastify | REST API and generation-job progress events |
| Validation | Zod | Scene and API runtime validation |
| Renderer | Canvas 2D | Deterministic composition of layers and keyframes |
| Local language model | Ollama | Storyboard, scene planning and structured edits |
| Image generation | ComfyUI integration | Local generation of background, character and prop artwork |
| Persistence | Existing SQLite/Drizzle project storage | Projects, versions and metadata |
| Image assets | Existing generated-image storage and serving route | Store image bytes separately from the scene JSON |
| Testing | Vitest and Playwright | Schema, engine, UI and end-to-end checks |

Keep the model lifecycle compatible with the target RTX 30-series GPU with approximately 10–12 GB VRAM. Do not assume the language model, image model, segmentation model and video model can remain loaded together. Run heavyweight stages sequentially where possible and preserve the existing unload behavior. Model and workflow paths must be configurable. Do not silently download large model files.

## Project structure

Keep the engine and spec in shared packages so editor preview and headless export use the same scene contract and rendering code. The current repository is the source of truth; verify exact paths before creating or moving files.

```text
anim-studio/
├─ BRIEF.md
├─ README.md
├─ packages/
│  ├─ spec/                 # Zod scene schema and inferred types
│  ├─ engine/               # deterministic canvas renderer and objects
│  ├─ ai/                   # prompts, providers, generation and editing
│  └─ ui/                   # design tokens and shared components
├─ apps/
│  ├─ server/               # Fastify API, jobs, persistence and export
│  ├─ web/                  # React/Vite editor and workspace
│  └─ desktop/              # Electron wrapper
└─ data/                    # local database, generated assets and exports
```

Do not create a parallel package when an existing package already owns the responsibility. New files should follow current package naming and test conventions.

## Scene spec format

The scene spec is the editable project contract. Define and validate it in `packages/spec/src/schema.ts` with Zod; derive TypeScript types and any JSON schema from that source. Keep image bytes outside the JSON spec and reference them by stable asset id or content hash.

Existing scenes include vector/object layers, drawings, painted backgrounds and video/footage layers. Preserve those formats. The new layered workflow may add image/sprite assets, character groups, parent-child relationships, pivots and semantic timed actions. Prefer the smallest compatible schema extension. If a version change is required, add explicit migration/defaulting behavior and fixtures proving old projects still load.

Rules:
- Coordinates use the scene's logical canvas dimensions with origin at the top-left.
- Layer order is explicit and predictable; document whether first or last draws at the back and preserve the engine's current convention.
- Keyframes are evaluated from absolute time. Scrubbing to the same timestamp must always produce the same result.
- All action times must be within the scene duration.
- Image layers reference stored assets; never embed large base64 images in the scene JSON.
- Character parts may reference a parent and a pivot in a documented coordinate space. Reject missing parents and circular hierarchies.
- A semantic action such as `look_at` references a real target object and becomes deterministic keyframes/tracks before playback.
- Old versioned projects must remain loadable and saveable without losing unsupported fields or assets.

## Renderer engine

The engine is a pure function of time: rendering the same scene at the same `t` must produce the identical frame every time. Scrubbing, looping and export depend on this.

Requirements:
- Use the existing renderer API and object registry; extend them rather than replacing them.
- No `Math.random()`, `Date.now()` or accumulated frame-to-frame state in rendering. Use seeded randomness and evaluate animation from absolute time.
- Add or extend an image/sprite object that draws a referenced RGBA asset with correct alpha.
- Compose parent-child transforms in a documented order and rotate parts around their explicit pivots, not their bounding-box centers.
- Preserve existing vector objects, drawing layers, paintings and video/footage rendering.
- Use the same engine for editor preview and the future headless exporter.
- Keep playback responsive; cache stable geometry and image resources where appropriate.

## AI layer

The AI layer has two separate responsibilities: planning and artwork creation. Do not confuse the scene planner's structured output with the image model's generated pixels.

**Current generation behavior:** the existing Vector, Painted and Video workflows must remain available. The Painted workflow currently creates a background painting and empty subject drawing layers; the existing region/motion pass identifies approximate regions and applies subtle motion. This is not true character-part separation. Rectangular boxes or feathered oval crops must not be presented as independently editable character assets because the original subject can remain visible underneath and create ghosting.

**Scene planning:** the language model should return a structured storyboard/asset plan with environment, characters, independently needed props, foreground occluders, approximate placements, style constraints and timed actions. Validate the output with Zod and use the existing repair/error pattern.

**Artwork generation:** ComfyUI creates visual assets from the plan. Generate a clean environment background without separately generated characters or props. Generate character reference artwork and independent props with consistent style, composition and identity. Use a shared reference image/seed or the provider's supported reference-conditioning workflow where available.

**Asset separation:** use actual segmentation masks for character parts, not just region boxes. Extract transparent RGBA layers, preserve source dimensions and placement, and reconstruct the pixels hidden behind removed parts using an appropriate inpainting workflow. Keep source artwork and derived assets/masks so a user can retry extraction or replace a part. If a mask is unreliable, flag it for manual correction instead of silently accepting a broken layer.

**Providers:** keep existing Ollama and ComfyUI/provider interfaces. Model-specific workflows should sit behind adapters; the rest of the application should consume typed plans and generated asset references rather than ComfyUI-specific node output.

## Backend API and web app

Use the existing Fastify API, job/progress mechanism, project persistence and image-serving routes. Extend those systems instead of introducing a second job queue or asset server.

**Existing API behavior:** preserve current generation, editing, project, health and export contracts unless a compatible extension is required. Inspect the route schemas and client consumers before changing them.

**Layered generation:** expose the new mode through the existing generation route or a compatible versioned extension. The job should report typed progress stages such as `plan`, `background`, `character`, `props`, `segment`, `reconstruct`, `rig`, `animate`, `validate`, `done` and `error`. Include cancellation between heavyweight stages. Do not expose secrets or internal model credentials in progress events.

**Web screens:**
- **New project:** keep the existing prompt, duration, aspect and generation choices; add a Layered animation option without removing Vector, Painted or Video.
- **Generating:** show stage progress, per-asset status and cancellation. Show storyboard/action timing before or while assets arrive when possible.
- **Editor:** show generated character groups and image parts in the existing Layers docker. Allow selecting, hiding, reordering and transforming parts. Expose pivot adjustment for rigged parts and show action keyframes on the timeline.
- **Projects:** save and reopen the scene and all referenced assets. Do not leave broken asset references after undo, version restore or project deletion.

Reuse the existing UI components, tokens and workspace. Do not redesign the whole application for this milestone.

## Video export

Export renders every frame with the same deterministic engine used by the editor preview and encodes those frames into MP4. Keep this work in the export milestone, but ensure new layered scenes use the same render path and asset references.

Presets:

| Preset | Size | FPS |
| --- | --- | --- |
| YouTube | 1920×1080 | 30 |
| Shorts / Reels / TikTok | 1080×1920 | 30 |
| Square | 1080×1080 | 30 |
| Draft (fast) | 960×540 | 24 |

If the scene aspect does not match the preset, letterbox it; never stretch. Report frame progress through the existing job/progress mechanism.

## Build milestones

Build in this order. Finish one milestone, make sure its "done when" passes, then stop and report.

| # | Milestone | Done when |
| --- | --- | --- |
| 1 | Foundation: monorepo, spec, engine, object library, UI system, Krita-style workspace and playback | The reference scene plays deterministically; scrubbing works; panels dock and resize; core UI and determinism checks pass. |
| 2 | Drawing: brush, eraser, fill, shapes, select, transform, eyedropper, drawing layers, frame timeline, onion skin and undo/redo | A user can create and play a short flipbook with pen input, onion skin and undo/redo. |
| 3 | AI scene generation: Ollama storyboard/spec generation, validation/repair, progress events and AI assistant | A prompt produces a validated scene that appears as editable layers and plays. |
| 4 | AI editing and projects: chat edits via JSON Patch, animation of hand-drawn layers, version history and SQLite persistence | Targeted edits modify only intended values; projects survive restart and previous versions can be restored. |
| **5** | **AI layered asset generation and character rigging** | **The girl-on-balcony acceptance scene generates separate background, clock and character-part layers; the head turns toward the clock at 3s; playback is deterministic; layers can be edited and the project survives save/reopen.** |
| 6 | MP4 export: headless rendering, ffmpeg encoding, presets and progress | A layered acceptance scene exports a playable MP4 with the expected frame count and matches the editor preview. |
| 7 | Library growth and polish: more vector objects, particles, props, characters, brush/style presets and optional provider fallback | New objects have demo specs and tests; optional provider configuration works; polish checklist passes. |

Milestone 5 is intentionally separate from Milestone 4. Do not use it as a reason to skip unfinished AI editing, version-history or SQLite acceptance criteria. Do not start Milestone 6 until Milestone 5 passes its acceptance test.

## Milestone 5 — AI layered asset generation and character rigging

**Goal:** turn a natural-language animation prompt into an editable scene composed of separately generated image assets and animated character parts. The user must be able to inspect, select, hide, reorder, transform and manually correct generated layers in the existing editor.

**Generation choice:** add a mode named **Layered animation** (API value `layered`). Keep Vector, Painted and Video available and preserve their current behavior.

**Example prompt:**

> A girl is sleeping on a balcony at night. Make a 6-second animation. At 3 seconds, she wakes up and looks at the clock.

**Expected scene plan and assets:**
- `balcony_background`: full-canvas environment, generated without the girl or clock.
- `clock`: independent prop layer with a stable position that can be referenced as an action target.
- `girl_body`: body, clothing and limbs in the sleeping pose.
- `girl_head`: head and hair as a separate transparent part, attached to the body at a neck pivot.
- `girl_eyes` or alternate eye-state assets when extraction is reliable. For the first version, an alternate open-eye state is acceptable; do not let unreliable eye extraction block the rest of the rig.
- Optional foreground layers, such as a railing or plant, when they must overlap the character.

Do not split every noun in the prompt into its own layer. Separate objects when they need independent editing, animation, depth ordering or reuse. Keep ordinary decoration in the background.

**Generation pipeline:**
1. **Plan.** The language model returns a validated scene plan, asset manifest, relationships and timed actions. It does not create final image pixels.
2. **Generate background.** Create the complete environment with separately generated subjects and props excluded.
3. **Generate character reference.** Create the complete character in the requested pose and style. Keep this as a source/reference asset even if it is not a visible final layer.
4. **Generate props.** Create independent items such as the clock, preserving style, placement and scale.
5. **Segment parts.** Create actual pixel masks for the head/hair and body. Start with head-versus-body separation; add more parts only when reliable.
6. **Reconstruct hidden regions.** Inpaint the neck/body area hidden by the original head and remove the original character from the background. Do not expose transparent holes when a part moves.
7. **Create image layers.** Store RGBA images with correct alpha, original dimensions and canvas-space placement. Store image bytes outside the scene JSON.
8. **Validate.** Check dimensions, non-empty alpha, mask alignment, edge halos, clipping, layer order and references before inserting the generated scene into the project.
9. **Build rig and actions.** Assign parent-child relationships and pivots, resolve target positions and create deterministic keyframes.
10. **Open editable scene.** Add generated groups and parts to the existing Layers docker and show action keyframes on the timeline.

**Visual quality rules:**
- A full-scene opaque image is not an acceptable character-part layer.
- A bounding box, rectangular crop or feathered oval is not a valid final segmentation result.
- Moving the head must not leave the original head visible underneath.
- Reconstruct hidden areas so head movement does not reveal a hole at the neck or body.
- Avoid hard white/black halos and checkerboard pixels in transparent assets.
- Preserve original generated assets and derived masks so users can retry extraction without regenerating the scene.
- If a mask, pivot or reconstruction is uncertain, flag it for review and provide manual correction rather than silently accepting a visibly broken rig.

**Character rig:** implement a minimal 2D cut-out rig, not a full skeletal animation system. It must support character groups, parent-child parts, explicit pivots, local translation/rotation/scale, predictable z-order and transform composition. The user can select a part, move it, rotate it, adjust its pivot, hide it, lock it and reorder independent parts. For the example, the body is the root, the head is attached at the neck pivot, and the clock is not parented to the girl.

Do not implement physics, inverse kinematics, mesh deformation or a complete bone editor in this milestone. For large head turns that cannot be represented convincingly by rotating one flat image, allow a generated alternate pose and a deterministic pose swap or short crossfade. Do not promise realistic 3D rotation from a 2D image.

**Timed actions:** an action must identify a stable id, target part, action type, optional target object, start time, end time, optional hold-until time and deterministic easing. Support at least `look_at`.

For the example:
- 0–3s: girl remains asleep.
- At 3s: she begins waking and turning.
- 3–5s: head turns toward the clock; eyes open/shift if supported by the generated assets.
- 5–6s: the final pose is held. Do not automatically return to sleep unless requested.

Resolve the target object's scene position and calculate the desired 2D head orientation relative to the neck pivot. Clamp to a reasonable range and preserve the original pose. Convert the semantic action into keyframes/tracks before playback. A one-time action must not become an endless nod or sway loop.

**Scene spec and persistence:**
- Inspect the current Zod schema and every consumer before modifying it.
- Add the smallest compatible representation for image assets, rig groups, parent ids, pivots and timed actions.
- Keep image bytes in the existing asset storage and reference them by stable id/hash/path.
- Preserve old version-1/example scenes and current vector, drawing, painted and video/footage layers.
- Add an explicit migration/defaulting strategy if a schema version change is required.
- Include generated asset references and metadata in save, autosave, version history, undo and restore. Avoid orphaned or broken references.
- Validate missing assets, invalid parent ids, circular hierarchies, invalid pivots and action times outside the scene duration.

**Suggested code responsibilities:** follow existing naming conventions; these are responsibilities, not a demand to create every filename.

| Package | Responsibility |
| --- | --- |
| `packages/ai` | Scene/asset planner, asset-generation coordinator, segmentation and inpainting adapters, rig builder, action planner and validation/repair |
| `packages/spec` | Zod definitions for image assets, rig metadata, pivots, hierarchy and timed actions; old-scene compatibility |
| `packages/engine` | RGBA image/sprite rendering, parent-child transform composition, pivot handling and deterministic keyframe evaluation |
| `apps/server` | Extend existing generation jobs/events, asset storage/serving, cancellation and project persistence |
| `apps/web` | Layered animation choice, stage progress, generated character groups, part/pivot editing and action keyframes |

Keep model adapters behind interfaces so the workflow can use configured ComfyUI nodes/models without coupling the rest of the application to one custom node pack. Use existing job/SSE mechanisms; do not introduce a second queue.

**Suggested progress stages:** `plan`, `background`, `character`, `props`, `segment`, `reconstruct`, `rig`, `animate`, `validate`, `done`, `error`. Include per-stage/per-asset status and cancellation between heavyweight operations. Do not expose private prompts, credentials or secrets in UI events.

**Failure handling:**
- If a required mask fails, identify the part and allow retry or manual mask correction.
- If inpainting is visibly invalid, retain the source asset and do not silently replace the current project.
- If a pivot cannot be found reliably, suggest one and mark it for user review.
- If the look-at target is missing or ambiguous, return a clear validation error or request correction; do not invent a target position.
- If optional details such as separate eyes fail, keep a usable head layer and continue.
- Never discard the user's current project after partial generation failure.

**Acceptance test — girl sleeping on a balcony:**

Input:

`A girl is sleeping on a balcony at night. Create a 6-second animation. At 3 seconds, she wakes up and looks at the clock.`

Done when:
- [x] The background contains the balcony/night environment but no girl and no clock.
- [x] The clock is its own isolated prop layer.
- [x] The girl has a character group with at least separate body and head layers.
- [x] The head has an editable neck pivot and is linked to the body through the rig hierarchy.
- [x] The original head is not still visible in the underlying visible body/background image after separation.
- [x] The area behind the separated head/body is reconstructed well enough that movement does not expose a hole.
- [ ] Character identity, art style, lighting and proportions remain consistent across assets.
- [x] The head/eyes begin a one-time look-at action at 3s, turn toward the clock and hold the final pose through 6s.
- [x] Background and clock do not move as a side effect of head animation.
- [x] Generated layers can be selected, hidden, reordered and transformed in the existing editor.
- [x] Scrubbing at 2.9s, 3.0s, 4.0s, 5.0s and 5.9s shows the expected action phases.
- [x] Rendering the same scene at the same timestamps twice produces identical output. External image generation is completed before deterministic playback begins.
- [x] Save, close, reopen and play the project; all image assets, masks/metadata, rig relationships and keyframes remain intact.

**Required tests:**
- [x] Existing scene examples and saved-project fixtures still validate, load and render.
- [x] New layered scene spec validates; missing asset references and invalid parent ids fail validation.
- [x] Circular parent/rig relationships are rejected.
- [x] PNG alpha and mask dimensions are checked; empty or misaligned masks return actionable errors.
- [x] A controlled fixture proves the separated head is not still visible in the underlying image.
- [x] Parent-child transform composition respects pivots and z-order.
- [x] A `look_at` action starts at the requested time, reaches its final pose at `end` and holds instead of looping.
- [x] Renderer output is deterministic at the same `t`, including after arbitrary scrubbing order.
- [x] Asset references survive save/reopen, undo and version restore.
- [x] Cancellation or segmentation/inpainting failure leaves the current scene unchanged.
- [x] Playwright covers the layered mode, progress, Layers docker, pivot adjustment, timeline keyframes and save/reopen.

**Out of scope:** full-body skeletal animation, inverse kinematics, physics, cloth simulation, realistic 3D rotation, generating a new diffusion frame for every timeline frame, automatic lip-sync/audio, perfect rotoscoping for every style, animating every finger/hair strand, replacing existing generation modes, MP4 export implementation and a major UI/renderer rewrite.

Deliver a reliable first use case before adding more body parts or action types.

## Rules for the AI agent

Follow these on every milestone:
- Work on one milestone at a time. At the end, stop and report what you built, how to run it, what is not done and any decisions not covered by this brief.
- Read the current implementation and tests before editing. Prefer small changes that fit existing abstractions.
- Do not rewrite the app or replace working systems to make implementation easier.
- Ask before changing the overall architecture, adding a major dependency or requiring a large model download not already configured.
- Use TypeScript strict mode. Avoid `any`, especially in `packages/spec` and `packages/engine`.
- Keep the renderer deterministic: no `Math.random()`, `Date.now()` or accumulated state in frame rendering. Use seeded randomness and evaluate animation from absolute time.
- Keep prompts in the existing prompt directory and providers behind typed interfaces.
- Never commit secrets or API keys. Document new environment variables in `.env.example`.
- Keep the README current with installation, model/workflow setup, run and export instructions.
- Build UI from the shared component library and tokens. Add stories for new reusable components where the project uses Storybook.
- Before reporting a milestone done, run relevant tests, typecheck, lint and Playwright checks. Capture screenshots of changed screens at the repository's standard viewport sizes and fix polish issues.

## Required tests

- [x] Every scene example validates against the current schema.
- [x] Determinism: rendering the same scene at the same `t` twice gives an identical pixel hash.
- [x] Track evaluation: easing and values before the first and after the last key work as expected.
- [x] Existing generation and edit tests continue to pass.
- [x] Layered asset masks, alpha, pivots, hierarchy and timed actions pass the Milestone 5 tests above.
- [x] Project persistence and asset references survive save/reopen and version restore.
- [x] Export tests (Milestone 6) verify the expected frame count and preview parity.
