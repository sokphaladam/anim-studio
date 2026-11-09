# Anim Studio — Hybrid AI Animation Architecture

**Decision:** Build an editable-first, dual-output animation pipeline. A single prompt produces (1) a native editable Anim Studio project and (2) one or more rendered video outputs. The native project is the source of truth; cloud-generated video is a separate cinematic deliverable or clip-level asset, not a pretend collection of editable layers.

**Repository baseline reviewed:** `README.md`, `BRIEF.md`, `package.json`, `packages/spec/src/schema.ts`, `packages/ai/src/layered.ts`, `packages/ai/src/generate.ts`, `packages/ai/src/painters/comfyui.ts`, and `.env.example`.

The repository already contains a local-first foundation: React/Vite + Electron, Fastify, Zod, SQLite/Drizzle, ComfyUI painting, segmentation, layer/character rigs, deterministic Canvas rendering, and FFmpeg export. The README reports Milestone 7. Do not replace this architecture or create another renderer, database, job queue, asset store, or frontend.

---

## 1. Product behavior

The user writes one natural-language prompt and clicks **Generate**. Anim Studio automatically:

1. Understands the prompt and creates a validated storyboard and asset/motion plan.
2. Generates a clean background, characters, props, alternate expressions, and other needed artwork.
3. Separates editable RGBA layers using segmentation masks, reconstructs hidden pixels, and builds character rigs.
4. Compiles the motion plan to deterministic tracks/keyframes in the existing scene engine.
5. Optionally generates cinematic AI video shots through a cloud video provider.
6. Inspects assets and sampled video frames, repairs or retries only failed stages within a budget.
7. Saves an editable project and renders the selected video outputs.

The user should not need to manually create masks, pivots, keyframes, or provider requests for an ordinary prompt. Advanced editing remains available after generation.

## 2. Non-negotiable architecture rule

**The editable `SceneSpec` is canonical.** AI models can propose content, produce artwork, and generate video clips, but they must not replace the project model or invent a different image on every playback frame.

There are two output paths from one validated `AnimationPlan`:

### A. Editable master (always created)

- Built from stored background, character, prop, and effect assets.
- Uses the current `SceneSpec`, layers, parent/pivot/mesh data, actions, and compiled tracks.
- Preview and export use the same deterministic TypeScript renderer.
- Users can edit artwork layers, transforms, pivots, keyframes, timing, camera, particles, and compositing.
- Produces a reproducible MP4 from the project.

### B. Cinematic AI video (optional cloud output)

- Generated as a separate shot or clip using a first-frame image and supported reference images/video.
- Stored as a normal project media asset and represented as a clip/footage layer where the current schema supports it.
- Editable at clip level (trim, timing, transform, opacity, ordering, replacement, and compositing), but **not** automatically editable as separate character body parts.
- May be shown beside the editable master as a cinematic alternative, or used as a video plate when alignment and quality checks pass.

A flattened video cannot be reliably converted into clean semantic layers, correct joints, and editable keyframes in every case. Do not claim otherwise. Keep both outputs and show users which one they are editing.

## 3. High-level architecture

```text
                         ONE USER PROMPT
                                |
                                v
                    Prompt Director (Ollama)
                                |
                                v
                    Validated AnimationPlan
                         /              \
                        /                \
          EDITABLE PROJECT PATH       CINEMATIC VIDEO PATH
                    |                         |
          Generate clean BG            Select shot keyframes
          Generate characters          Prepare references
          Generate props               Upload refs to provider
          Generate expressions         Run cloud/local video model
                    |                         |
          Segment masks + RGBA         Poll task / download MP4
          Reconstruct hidden pixels    Save video clip asset
          Build rigs + pivots                  |
          Compile motion to tracks             |
                    \                         /
                     \                       /
                      v                     v
                    Quality Inspector / Repair Router
                                |
                    Project + Render Manifests
                                |
             +------------------+------------------+
             |                  |                  |
             v                  v                  v
       Editable Scene      Editable Master    Cinematic AI Cut
       in workspace        MP4 via engine     MP4/video layers
```

The branches can share reference artwork, character profiles, timing, and shot metadata. They must not share a false assumption that their pixels will be identical.

## 4. Reuse the existing repository components

| Existing component | Keep and extend                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/spec`    | `SceneSpec`, asset references, character profiles, layer hierarchy, pivots, mesh/IK, actions, tracks, validation and migrations.                   |
| `packages/engine`  | Deterministic time-based composition, object registry, transform evaluation, effects and rendering. Do not make model calls from the render loop.  |
| `packages/ai`      | Existing Ollama planning/editing and ComfyUI painter. Add a video-provider abstraction and an orchestration pipeline.                              |
| `apps/server`      | Existing Fastify routes, job/event progress, SQLite persistence, image store and export service. Extend them; no new queue or asset server.        |
| `apps/web`         | Existing dockable editor, Layers docker, timeline, preview, job progress and export UI. Add video-clip and generation status UI only where needed. |
| `apps/desktop`     | Keep Electron as the desktop wrapper. Secrets and provider calls remain in the server process.                                                     |

### Important baseline details

- `packages/ai/src/layered.ts` already plans and generates layered scenes, uses background removal/text segmentation, keeps source/mask assets, reconstructs pixels behind moving parts, sets parent/pivot relationships, and compiles actions.
- `packages/ai/src/painters/comfyui.ts` already has a `Painter` contract with paint, inpaint, segmentation and optional local image-to-video animation. Its local video workflow currently uses Wan 2.2 TI2V 5B.
- `packages/spec/src/schema.ts` already supports layers, assets, characters, parent/pivot, mesh and IK-related data. Preserve old-project compatibility.
- The README already documents deterministic MP4 export with FFmpeg. Keep this as the reliable editable-master render path.

## 5. New modules and contracts

Follow existing naming and import conventions; paths below are proposed responsibilities, not a command to duplicate existing files.

```text
packages/ai/src/
  director/
    animation-plan.ts       # prompt -> storyboard, shots, assets, action plan
    animation-plan.schema.ts
    prompt-builder.ts
  video/
    types.ts                # provider-neutral request/task/result contracts
    local-comfyui.ts        # adapter around existing Wan image-to-video path
    runway.ts               # cloud adapter
    model-policy.ts         # allowlist, quality/cost/latency selection
  pipeline/
    generate-hybrid.ts      # orchestrates both output paths
    editable-project.ts     # calls existing layered generation and motion compiler
    cinematic-shots.ts      # generates and stores AI video shots
  quality/
    scene-checks.ts         # schema, masks, pivots, source/reconstruction checks
    frame-checks.ts         # sampled-frame visual/temporal inspection
    repair-policy.ts        # stage-local retry and budget policy
```

### Provider-neutral video contract

```ts
export type VideoModelId = string;

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  firstFrame?: Uint8Array;
  lastFrame?: Uint8Array;
  referenceImages?: Array<{ id: string; image: Uint8Array; role?: string }>;
  referenceVideo?: Uint8Array;
  durationSeconds: number;
  aspect: "16:9" | "9:16" | "1:1";
  resolution: "720p" | "1080p";
  seed?: number;
  audio: "none" | "native";
}

export interface VideoTask {
  provider: string;
  providerTaskId: string;
  model: VideoModelId;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  estimatedCostUsd?: number;
}

export interface VideoGenerationResult {
  task: VideoTask;
  bytes?: Uint8Array; // only after server has fetched the result
  mimeType?: "video/mp4";
  durationSeconds?: number;
  width?: number;
  height?: number;
  seed?: number;
  providerMetadata?: Record<string, unknown>;
}

export interface VideoProvider {
  readonly id: string;
  createTask(
    request: VideoGenerationRequest,
    signal?: AbortSignal,
  ): Promise<VideoTask>;
  getTask(
    task: VideoTask,
    signal?: AbortSignal,
  ): Promise<VideoGenerationResult>;
  cancelTask(task: VideoTask): Promise<void>;
}
```

Do not expose provider-specific model request bodies to the planner, editor, or scene renderer. Adapters own request mapping, upload requirements, task polling, provider errors, and output retrieval.

## 6. Cloud provider recommendation

Use **Runway Dev API as the first cloud adapter**, but keep it optional and behind the `VideoProvider` interface. Its current API catalog lists both `seedance2_5` and `kling_4` for image-to-video, and its Model Router can choose from supported models by quality, cost, or latency preference. Start with explicit model IDs for repeatable A/B tests; add Model Router as an opt-in auto mode after the app has a benchmark set.

Suggested initial evaluation:

- `seedance2_5`: first candidate for reference-rich cinematic shots.
- `kling_4`: second candidate for controlled image-to-video and shot continuity.
- Existing local Wan 2.2 ComfyUI animation: preserve as the local/offline option.

Do not hard-code one model as the eternal winner. Maintain a small internal benchmark set with the same anime prompts, aspect ratios, reference frames, and durations; compare character identity, temporal stability, anatomy, motion adherence, and cost.

### Runway adapter requirements

- Use the official API endpoint and version header in the server adapter only.
- Keep the secret in the desktop/server environment, never in React, browser storage, project JSON, logs, or generation events.
- Use provider task IDs and poll the task endpoint; support cancellation and clear provider errors.
- Download successful outputs into Anim Studio's own asset store immediately. Provider output URLs are temporary and should not be exposed as permanent project URLs.
- Persist model ID, task ID, request parameters, duration, resolution, estimated/actual cost, and output asset ID in the generation manifest.
- Pin model IDs and API-version configuration; do not silently change models mid-project.

## 7. AnimationPlan: the shared source for both outputs

The director should return validated structured data, not a long free-form prompt for each subsystem.

Suggested top-level contract:

```ts
interface AnimationPlan {
  title: string;
  originalPrompt: string;
  style: {
    family: "anime" | "cartoon" | "vector" | "painted";
    artDirection: string;
    palette?: string[];
  };
  output: {
    aspect: "16:9" | "9:16" | "1:1";
    durationSeconds: number;
    fps: 24 | 30 | 60;
  };
  characters: CharacterPlan[]; // stable IDs and identity references
  assets: AssetPlan[]; // background, props, foreground, expressions
  shots: ShotPlan[]; // start/end, camera, first/last frame, motion
  actions: TimedActionPlan[]; // target IDs, start/end, motion intent
  quality: {
    identityStrictness: number;
    motionStrictness: number;
    allowCloud: boolean;
  };
}
```

`ShotPlan` should include `id`, `start`, `end`, `purpose`, `camera`, `motionPrompt`, `firstFrameAssetId`, optional `lastFrameAssetId`, reference asset IDs, editable action IDs, and a preferred generation path (`rigged_2d`, `local_video`, `cloud_video`, or `hybrid`). The planner should pick the least expensive path that can meet the scene's requirements.

Use Zod. Reject unknown IDs, overlapping or out-of-range timing, invalid dimensions and actions without targets. Keep a repair loop with a small fixed attempt count. Preserve the original user prompt and plan revision for reproducibility.

## 8. One-prompt pipeline in detail

### Stage 0 — Preflight

- Check local Ollama, ComfyUI, segmentation models, FFmpeg, disk space and GPU availability.
- Check whether cloud video is enabled and configured.
- Estimate cloud cost from model, duration, resolution and retry budget before making paid requests.
- Respect a user-configured spend ceiling. If cloud is disabled or no key exists, continue with local generation rather than failing the whole project.

### Stage 1 — Director / plan

- Expand the prompt into a short storyboard with shot timings and a visual continuity guide.
- Lock character IDs, appearance descriptions, reference images, palette and proportions.
- Describe each moving object separately: what moves, when it moves, how far, and its rest position.
- Decide which movement can be deterministic 2D rigging and which shot benefits from video generation.
- Emit validated plan events to the current job progress stream.

### Stage 2 — Editable artwork

Reuse the current layered generation pipeline:

1. Generate the clean environment with characters and foreground props excluded.
2. Generate each character using its saved identity profile/reference.
3. Generate independent props and occluders.
4. Segment actual subject parts; create transparent RGBA cut-outs and keep source images and masks.
5. Reconstruct hidden pixels behind moving parts.
6. Create expression overlays (open/closed eyes, mouth states) where the action requires them.
7. Build parent-child rigs, pivots, optional mesh weights and IK targets.

Do not make every tiny detail its own layer. Separate only the parts that genuinely need independent motion or manual editing. If mask confidence or reconstruction coverage is poor, flag the part for review rather than silently treating it as production-ready.

### Stage 3 — Motion compilation

- Compile semantic actions into deterministic tracks before playback.
- Evaluate all motion as a pure function of absolute time. No accumulated simulation state in the render loop.
- Add camera tracks, parallax, secondary motion, particles and depth-aware foreground elements using the existing engine.
- Ensure each loop has a mathematically valid loop period and the final frame connects cleanly to the first.
- Store action intent and generated keyframes so users can edit either the semantic action or its resulting tracks.

### Stage 4 — Cinematic video generation

- For each shot selected for cloud video, use the corresponding generated first-frame artwork and approved references.
- Keep prompts shot-specific; do not send the entire scene prompt repeatedly to every shot.
- Request the same duration and aspect range as the storyboard shot where supported.
- Generate only shots that need it. Do not create multiple expensive copies of a 12-second video just to make a 12-second scene.
- Save each clip as a project media asset with source references and provider metadata.
- Preserve the original image assets and editable project even if cloud generation fails.

### Stage 5 — Quality inspector and repair

Use deterministic checks first, visual-model judgement second, and human approval for uncertain results.

**Asset / project checks**

- Every layer references a valid asset; all image dimensions and alpha channels are valid.
- Masks are non-empty, non-rectangular where expected, and within source bounds.
- Cut-outs have acceptable edge halos/fringing; reconstructed areas do not expose holes at expected movement ranges.
- Parent IDs and target IDs exist; no circular parent graph; pivots are plausible and mesh weights are normalized.
- Keyframes/actions stay inside scene duration; the render at any timestamp is deterministic.

**Video checks**

- Sample frames at beginning, quarter points, midpoint, three-quarter point and end (plus action peaks).
- Inspect character identity, anatomy, clothing, object persistence, blur, flicker, scene drift and motion adherence.
- Compare sampled frames temporally; flag sudden appearance changes and severe luminance/structure flicker.
- Check clip dimensions, duration, decode integrity and frame-rate metadata.

**Repair policy**

- Retry only the failed stage or shot; do not regenerate all artwork for one bad shot.
- Maximum one automatic retry by default; make retry count configurable.
- Stop when the quality gate fails repeatedly or the spend ceiling is reached. Return a visible `needs_review` state with a useful reason instead of silently accepting defects.
- Never promise zero defects. The quality system reduces failures and makes uncertain output visible.

### Stage 6 — Composition and delivery

Produce clear deliverables:

1. **Editable Project** — all source artwork, masks, rigs, keyframes, shot plan, generation metadata and media references.
2. **Editable Master MP4** — rendered by the existing deterministic engine and FFmpeg from the project.
3. **Cinematic AI Cut MP4** — stitched from successful cloud/local generated clips, where requested.
4. **Quality Report** — passed checks, warnings, failed checks and retry history.

If a generated AI clip is included in the editable master timeline, represent it as a clip/footage layer with clip-level editing. Do not represent it as editable character parts unless an actual tracking/segmentation/rig conversion has been created and validated.

## 9. Scene and persistence strategy

- Keep `SceneSpec` as the editable scene contract and retain its version/migration behavior.
- Preserve existing image asset kinds (`image`, `source`, `mask`). Do not store MP4 bytes as an image asset.
- Reuse the current footage/video layer contract if it captures URI/local path, timing, frame rate and source metadata. If it does not, add a small optional `VideoClip` schema or sidecar manifest with explicit migration tests.
- Store large media bytes in the existing local media store and reference them by stable asset ID/content hash.
- Store generation history separately from the render loop: plan revision, provider/model, prompts, task ID, seed, cost, output hash and quality report.
- A project version must preserve every referenced asset. Undo/restore/project deletion must not orphan an asset still referenced by another version.
- Old projects must continue to load and render. Add fixtures from prior project versions before changing schemas.

## 10. Backend API and job events

Extend the existing Fastify generation job and event mechanism. Do not create a second job system.

Suggested progress phases:

`preflight -> plan -> background -> characters -> props -> segment -> reconstruct -> rig -> animate -> cinematic_shots -> quality_check -> repair -> compose -> export -> done`

Useful event payloads:

- `phase`: stable stage ID.
- `progress`: percentage or completed/total counts.
- `asset`: ID, display name and status (`queued`, `running`, `ready`, `review`, `failed`).
- `shot`: ID, timing, provider/model, status and optional cost estimate.
- `warning`: concise user-facing explanation and suggested action.
- `result`: project ID, editable master asset ID, cinematic output asset ID and quality report ID.

The API key must never appear in event payloads. Add cancellation checkpoints between long local stages and support cancellation of cloud tasks when the provider allows it.

## 11. UI additions

Keep the existing editor and design system. Add the smallest required UI:

- **Generate dialog:** one prompt; style, duration, aspect and quality; a Local / Hybrid / Cloud mode; cost estimate and spend cap when cloud is enabled.
- **Generation progress:** stage timeline, individual asset/shot cards, local/cloud badges, cancel button and useful error details.
- **Results view:** tabs for Editable Project, Editable Master, Cinematic AI Cut and Quality Report.
- **Layers docker:** generated source and separated part indicators; uncertain masks/pivots/reconstruction warnings.
- **Timeline:** video/footage clip rows (if supported by current layer registry), trims and clip timing, separate from character part/keyframe rows.
- **Inspector:** selected layer/clip settings, provider/model metadata, mask repair/retry action and approval status.

Do not make users choose dozens of technical model settings. Put provider overrides in advanced settings.

## 12. Configuration and security

Proposed server-only settings (names can be adjusted to match existing environment conventions):

```dotenv
# Local-first default
VIDEO_PROVIDER=local

# Cloud video is opt-in
CLOUD_VIDEO_ENABLED=0
RUNWAY_API_KEY=
RUNWAY_VIDEO_MODEL=seedance2_5
RUNWAY_VIDEO_QUALITY=720p
RUNWAY_MAX_COST_USD=5.00
RUNWAY_MAX_RETRIES=1
```

- Do not auto-download or auto-enable paid cloud services.
- Show a cost estimate before paid work; require explicit enabling/configuration by the user.
- Keep secrets out of renderer/browser code, project files, source control and logs.
- Treat provider output URLs as temporary. Download and verify them promptly, then serve the local asset route.
- Add timeouts, abort handling, backoff for rate limits, idempotency and provider error mapping.

## 13. Recommended implementation sequence

The current README reports Milestone 7. Treat this dual-output feature as the next major increment, not a replacement for M1–M7.

### M8 — Video provider abstraction and Runway adapter

**Scope:** add `VideoProvider` contract, preserve local Wan 2.2 adapter, implement Runway upload/create/poll/cancel/download, server-only secrets, job progress and cost accounting.

**Acceptance:** a fixed approved image and prompt can create a short cloud clip; cancellation and provider errors work; output is downloaded into the local asset store; the project opens without a live provider URL; no secret appears in browser or logs.

### M9 — Shared director plan and dual-output orchestration

**Scope:** validate a shared `AnimationPlan` that directs both the current editable layered path and cinematic shots. Add one-click orchestration and per-shot provider policy.

**Acceptance:** one prompt creates a saved editable scene and at least one optional cinematic shot from the same plan; cloud failure does not destroy the editable scene; progress and cancellation work.

### M10 — Quality gates and stage-local repair

**Scope:** add project/frame quality checks, warning states, bounded retries and budget enforcement.

**Acceptance:** seeded broken fixtures are rejected; a failed shot can be retried without rebuilding the whole project; repeated failure yields `needs_review`; retry and cost limits are enforced.

### M11 — Results UI and clip-level editing

**Scope:** present both outputs and quality report; allow generated clip timing/trim/replacement in the existing timeline if the current footage-layer implementation supports it.

**Acceptance:** user can edit the native layers, replace/re-time a generated video clip, save/reopen, and export both deliverables with correct media references.

### M12 — Benchmark and production hardening

**Scope:** compare `seedance2_5`, `kling_4`, and local Wan 2.2 on the same test set; pick defaults by style/task, record cost/quality; test low VRAM, offline mode, rate limits, restarts and corrupt media.

**Acceptance:** documented benchmark results; no paid request when cloud mode is disabled; no missing outputs after restart; all core existing tests continue to pass.

## 14. Test plan

**Unit tests**

- Zod validation and migration tests for the shared plan and any optional media schema.
- Provider request mapping, task status mapping, error mapping, polling, cancellation and output download.
- Cost estimate calculations and budget/retry policy.
- Project validation: assets, masks, parents, pivots, mesh weights, action timing and clip timing.
- Determinism: render identical timestamps twice and compare output hashes/pixels.

**Integration tests**

- Use a fake video provider; tests must not call paid cloud services.
- Run the current local layered pipeline with a fake painter, as existing E2E tests do.
- Verify saved projects and all source/mask/video assets survive restart, undo and restore.
- Test provider failure after editable generation; the editable project must remain intact.

**Golden acceptance scene**

Prompt: “A girl is sleeping on a balcony at night. At 3 seconds, she wakes up, opens her eyes and looks at the clock. The curtains and hair move gently. Six-second anime loop.”

Pass conditions:

- Background, clock, girl body, head, eyes/expression and moving parts are separate editable assets where separation is reliable.
- The character identity is stable; the head turns toward the clock at the correct time.
- No invalid asset references, broken rig hierarchy or out-of-range actions.
- The scene is deterministic, saves/reopens, and exports an MP4 matching the editor preview.
- Optional cinematic output is stored locally and linked to the same plan; failure does not break the editable project.
- Quality report clearly identifies uncertain masks, reconstruction, pivots or video frames.

## 15. Explicit non-goals for the first version

- Perfect automatic conversion of a flattened AI video into an editable multi-part character rig.
- Regenerating every frame with an AI model during editor playback.
- Replacing the existing renderer, database, asset store, job system, editor or ComfyUI setup.
- Making paid cloud video generation mandatory.
- Claiming “no defects” or hiding uncertain outputs from the user.

## Final recommendation

Build **editable-first, dual-output generation**. Keep the current local pipeline as the dependable source of the editable project and deterministic master. Add Runway Dev as an opt-in cloud `VideoProvider`, initially benchmarking Seedance 2.5 and Kling 4.0 against the existing local Wan 2.2 path. Use one shared storyboard/asset/motion plan to produce both branches, then inspect and present both outputs honestly. This provides one-prompt convenience without sacrificing editability, local-first operation, or engineering control.

runway api key: key_13e4fcc827a5dfb2be050a6e95f2b7e3f31f872160ee385393aea4f7aad90e13a3b3f0a2080c5c77f9f8e5f9ec7b88d403c300637c5ac11461d01788e4499ce4
