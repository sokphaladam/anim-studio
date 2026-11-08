# Anim Studio — Production-Quality Animation Roadmap

**Repository:** sokphaladam/anim-studio  
**Target:** Local-first, AI-assisted 2D animation for polished, repeatable music-video scenes  
**Status:** Implementation plan; no application code changes are included in this document  
**Baseline reviewed:** main branch, November 8, 2026

## 1. Product goal

Evolve Anim Studio from a layered lofi-scene generator and 2D editor into a dependable **production animation studio**. A creator should be able to generate an attractive scene, separate and repair its artwork, rig characters, direct expressive movement, add cinematic atmosphere, and export a seamless silent animation that CR Content can use behind a song.

The target look is the supplied reference: one coherent illustrated world that feels alive through convincing character movement, secondary motion, environmental detail, careful lighting and restrained typography. The objective is not to make every object move or to imitate a specific creator's artwork.

### Production principles

1. **Artwork quality before effects.** Character identity, anatomy, clean masks, joints and hidden-pixel reconstruction matter more than adding filters.
2. **Hybrid animation.** Use bones for connected limbs, mesh deformation for flexible shapes, image/pose swaps for face and view changes, and frame-by-frame animation when deformation cannot look right.
3. **Editable and deterministic.** AI proposes artwork, rigs, poses and animation plans. The saved scene specification and renderer remain the source of truth. Playback and export must not ask an image/video model to invent each frame.
4. **Local-first.** Preserve Ollama, ComfyUI and the current model lifecycle. Heavy models must be unloaded between stages on 10–12 GB GPUs. Cloud fallback remains explicit and optional.
5. **Backward compatibility.** Existing projects and SceneSpec version 1 must continue to open and render. New schema fields are optional or introduced through an explicit migration.
6. **One milestone at a time.** Inspect current Git status, README, BRIEF, implementation and tests before starting a milestone. Do not overwrite uncommitted user work or silently change model downloads.

## 2. Current foundation and gaps

The current project already has valuable infrastructure:

- React/Vite editor, Electron desktop wrapper, Fastify API and SQLite/Drizzle project history.
- Shared Zod scene schema and deterministic Canvas 2D engine.
- Ollama-based planning and edits, ComfyUI/SDXL image generation, SAM segmentation and BiRefNet cutouts.
- Layered backgrounds, character groups, body/head/part layers, pivots and reconstructed pixels behind moving parts.
- Existing actions including breathe, bob, blink, sway, drift, swing, look_at and path.
- Preview/export parity tests and headless FFmpeg MP4 export.

The main quality gap is that many character motions are still rigid transforms of cut-out images. This works for restrained movement but can look like flat puppets when a head turns, a limb bends, hair moves, or a character changes pose. The generation pipeline also needs stronger asset review, identity continuity, joint-aware preparation and automated visual checks.

## 3. Target architecture

Keep the existing monorepo and package boundaries. Extend the current packages rather than introducing another editor, renderer, database or job system.

- packages/spec: optional rig, mesh, pose, expression, motion-clip and render-profile data contracts.
- packages/ai: reference-guided planning, asset preparation, rig suggestions, pose/expression generation and Motion Director prompts.
- packages/engine: deterministic skeleton evaluation, IK, mesh deformation, pose blending, motion curves and compositing objects.
- apps/server: generation stages, validation, project persistence and portable animation-package export.
- apps/web: rig controls, facial/expression controls, motion editor, animation preview and quality report.
- apps/desktop: continue to package the same local workflow; do not fork behavior.

The Canvas 2D engine remains the initial renderer. A GPU or WebGL renderer is not a prerequisite for these milestones. Profile first; optimize only demonstrated bottlenecks.

## 4. Milestones

### M8 — Production artwork and character identity

**Goal:** Make generated assets clean, coherent and reusable before adding more sophisticated animation.

Scope:

- Add an optional Character Identity profile: stable character ID, reference images, hair/eye/clothing palette, body proportions, facing direction and style notes.
- Let a scene plan reference an existing character profile. Do not regenerate identity details on every scene or prompt edit.
- Add a character asset checklist: full subject visible, expected anatomy/parts present, reasonable crop margin, transparent cutout valid, alpha edge quality, mask coverage and hidden-area reconstruction status.
- Improve segmentation cleanup: feather/defringe controls, mask erosion/dilation, small-hole cleanup, edge-halo detection and manual mask correction.
- Preserve original generated source images and all derived masks/cutouts. Failed or repaired stages must not destroy source assets.
- Improve occluded-area reconstruction around the neck, shoulders, elbows, wrists, hips and knees. Use deterministic image-based repair first; optional inpainting is a controlled offline repair step, not a playback dependency.
- Add asset preview states: original, mask, cutout, reconstructed body and assembled character.
- Allow a person to approve, repair, regenerate or skip one part without discarding the rest of the scene.

Acceptance criteria:

- Existing M1–M7 projects still load unchanged.
- Generated characters keep their saved reference profile on a second scene generation.
- No blank/opaque/rectangular cutout silently passes validation.
- Transparent edges have no obvious white fringe at 100% and 200% preview zoom.
- Every uncertain repair is explicitly marked for review; the system does not report a guessed part as verified.
- Tests cover masks, edge cases, missing parts, profile persistence and old-project loading.

### M9 — Hybrid character rigging

**Goal:** Replace all-or-nothing rigid cutouts with an editable 2D rig that supports natural connected movement.

Scope:

- Define a backward-compatible rig data model: bones, parent IDs, rest transforms, joint limits, bind pose, influence weights and mesh references.
- Build an interactive rigging workspace to add/select bones, place joints, adjust pivots, paint or refine weights, mirror a rig and preview motion.
- Implement a practical first rig: torso, neck, head, upper/lower arms, hands, upper/lower legs and feet. Add optional tail, ears and hair chains for animals and stylized characters.
- Implement two-bone IK for arms and legs with target handles, pole direction and joint constraints. Preserve FK/manual transform control.
- Add mesh deformation for flexible regions such as hair tips, sleeves, tails and soft clothing. Start with a stable triangle mesh and weighted deformation; keep the undeformed source image for reset and repair.
- Keep rigid image layers as a supported fallback. A layer should not be forced into a mesh if a simple pivot is better.
- Add rig diagnostics: disconnected joints, zero/invalid weights, flipped bone direction, self-intersection warnings and excessive stretch.

Acceptance criteria:

- A character can bend an elbow and knee without the full limb rotating as one flat cutout.
- IK targets remain stable when the parent body moves.
- Rig edits are undoable, save with the project and survive reopen.
- A rig with no mesh/weights falls back to the existing transform behavior.
- Deterministic test frames match after repeated scrubbing and headless export.

### M10 — Face, gaze and pose system

**Goal:** Make characters expressive without relying on unrealistic rotation of one face image.

Scope:

- Add named face states (for example neutral, blink, eyes-closed, happy, sad and surprised) with editable eye, eyebrow and mouth elements where source artwork supports them.
- Add gaze targets and eye direction independent from the head. Use bounded movement and expose a manual correction control.
- Support generated head-angle/pose variants (front, three-quarter and profile) tied to the same Character Identity profile.
- Blend or swap between compatible poses with configurable timing. Do not morph unrelated raster images and call the result natural.
- Add reusable pose presets: rest, listening, looking at a prop, sipping, writing, sleeping and waking.
- Keep facial and pose tracks editable on the timeline and usable by the Motion Director.

Acceptance criteria:

- Blink timing does not distort the rest of the face.
- Gaze can move toward a prop without rotating the entire body.
- Head turns beyond the safe rig angle use a matching pose variant or show a review warning.
- Switching pose does not change the character's saved clothing, palette or proportions.
- The user can manually override every AI-selected expression or pose.

### M11 — Motion Director and professional animation curves

**Goal:** Create movement that feels intentional, weighted and human rather than robotic.

Scope:

- Extend the current action system into reusable, named motion clips with tracks, start/end, loop behavior, blend weight and target references.
- Add Bezier/easing curves with editable handles, anticipation, overshoot limits, settle and hold controls.
- Support overlapping action tracks: body motion, head motion, gaze, limbs, hair and props must be independently editable.
- Add secondary-motion helpers for hair, ears, tails, loose clothing and hanging objects. Use deterministic spring-like or bounded procedural motion evaluated from absolute time, not accumulated frame state.
- Add motion principles as explicit planning constraints: anticipation, follow-through, overlapping action, weight, contact and return-to-rest.
- Add contact/constraint options for hands on a desk, feet on a floor, a hand holding a cup and a cat standing on a branch. Prevent visible sliding where possible.
- Create idle, listening, breathing, blink, look-at, reach, sip, write, tail-sway and walk-cycle libraries. Motion clips must be editable and not black-box model outputs.
- Expand the AI Motion Director to propose a timeline from scene intent, character rig capabilities and timing. Validate every target and duration before applying it.

Acceptance criteria:

- All generated tracks are deterministic for a fixed scene and time.
- Secondary motion joins continuously at loop boundaries.
- A hand/foot contact target remains within configurable tolerance during the action.
- No action silently targets a missing layer or unsupported joint.
- AI motion generation produces a reviewable plan and one undoable edit, not dozens of opaque changes.

### M12 — Cinematic scene and compositing system

**Goal:** Improve visual depth, lighting and final image consistency without overwhelming the illustration.

Scope:

- Add explicit foreground/midground/background grouping and depth metadata.
- Add controllable camera framing, subtle push/pan and safe-area guides. Camera movement must be optional and cyclic for loop exports.
- Add deterministic compositing controls: color grade, exposure, contrast, saturation, vignette, bloom/glow, soft shadows, contact shadow, fog/haze, light shafts and depth-of-field approximation.
- Improve ambient effects: rain on a window, falling leaves, drifting dust, steam, snow, fireflies and light flicker. Support region masks and occlusion ordering.
- Add reusable scene color palette and lighting direction. Keep subject and environment in the same light/color space.
- Add quality presets such as Draft, Balanced and Final that change render resolution/sampling without changing scene semantics.
- Respect reduced-motion and performance settings in the editor; all visual effects have clear on/off and intensity controls.

Acceptance criteria:

- All effects are deterministic and do not flicker due to random reseeding per frame.
- Character feet, shadows and foreground occlusion appear consistent while moving.
- Effects can be independently disabled for troubleshooting.
- Final render preserves the intended composition at 1920×1080 and 1080×1920.
- Preview and export use the same effect parameters and produce matching sampled frames.

### M13 — Music-aware animation input

**Goal:** Accept music analysis from CR Content without duplicating song analysis or coupling the renderer to an audio service.

Scope:

- Define a validated MusicAnimationData input: song duration, BPM, beat timestamps, section ranges/types/energy and optional time-sampled energy envelope.
- Add an import/preview mode for that data. No original audio is required in Anim Studio for the first integration.
- Allow motion clips to reference beat, bar, section start/end and energy envelopes.
- Provide restrained beat-reactive controls for head nod, light pulse, particles and camera. Keep a minimum/maximum amount and smoothing.
- Add section-aware motion direction: quieter verses use subtle idle motion; choruses may use stronger but still intentional movement.
- Keep all music references optional so non-music projects are unchanged.

Acceptance criteria:

- Beat-aligned keyframes land within one frame at the selected export FPS.
- Missing or invalid analysis data falls back to ordinary scene timing.
- Beat reactivity does not make all layers pulse together.
- The same music analysis and scene always produce the same exported frames.

### M14 — Loop validation and portable animation package

**Goal:** Deliver a reliable, self-contained animation package for CR Content.

Scope:

- Add loop validation for first/last image difference, motion continuity, periodic tracks, non-cyclic actions, particles, camera and effect state.
- Compare first/last frames and motion at multiple points, not just one pixel metric. Report likely visible seam causes with timestamps and layer IDs.
- Add a loop preview that plays at least three consecutive cycles.
- Export a portable package containing: silent MP4, manifest, scene specification, referenced image assets, profile references and validation report.
- Use a clear package contract agreed with CR Content (see section 5). Store stable asset paths and checksums; never embed absolute local paths.
- Keep export atomic: a failed or cancelled job must not replace the last known-good output.

Acceptance criteria:

- A package imports on another machine without access to the original project directory.
- Manifest duration, frame count, FPS, dimensions and loop status match the actual MP4.
- Export contains no audio; CR Content owns final song audio mixing.
- The loop can play three times without a visible jump at the boundary for the validated test scenes.
- Package validation rejects missing assets, path traversal, unsupported schema versions and mismatched checksums.

## 5. Shared Anim Studio → CR Content package contract

Use one documented interchange contract for both repositories. The first integration should favor a complete rendered MP4 plus manifest; a portable editable scene package is included for future revisions.

Suggested package files:

- animation.mp4 — silent H.264 loop, 16:9 by default, 1920×1080, 30 FPS.
- manifest.json — schema version, title, duration, FPS, dimensions, frame count, loop flag, codec, color metadata, checksum, scene/project ID and export timestamp.
- scene.spec.json — portable SceneSpec with no absolute paths.
- assets/ — all referenced source and derived image assets needed to reopen the project.
- quality-report.json — validation results, warnings and seam metrics.

Contract rules:

- The MP4 is the dependable playback artifact. CR Content must not need Anim Studio or its AI models to render the final song video.
- The scene specification and assets preserve editability for later revisions.
- The MP4 is silent. Audio is muxed exactly once by CR Content.
- Default output is an opaque full-frame scene. Alpha-video export may be explored later, but must not block the first integration.
- Loop duration may be chosen to fit a musical phrase (for example 8, 12, 16 or 24 seconds); CR Content must loop based on manifest duration instead of assuming one fixed length.
- The importing repository must validate the manifest and actual media with ffprobe rather than trusting filename extensions.

## 6. Performance and local hardware constraints

- Target RTX 30-series GPUs with approximately 10–12 GB VRAM, while retaining CPU fallback where practical.
- Run language planning, image painting and segmentation sequentially when their combined memory use would exceed the device budget.
- Do not load an image model, segmentation model and optional video model at the same time by default.
- Add stage-level VRAM/RAM/time reporting before introducing model changes.
- Avoid mandatory 20–30 GB video models. Character animation should remain possible using the deterministic rig/mesh/pose engine.
- Keep model installation explicit, resumable and visible in the UI. Never trigger a large download silently.
- Profile final 1080p rendering and memory use; allow draft previews at lower resolution.

## 7. Testing strategy

Every milestone must add or update tests in the existing Vitest/Playwright setup:

- Schema tests: old SceneSpec fixtures, migration, rig validation and invalid references.
- Engine tests: FK/IK, mesh determinism, curve interpolation, pose blending, contacts, cyclic motion and compositor determinism.
- AI tests: schema-constrained plans, invalid target repair, partial asset failure and no mutation of the active project before a generation stage completes.
- Visual regression: fixed-time frames for representative human, animal, hair, hand, tail, foliage and night-light scenes.
- End-to-end tests: generate with fake painter, repair a part, rig and animate, save/reopen, scrub, export, inspect and import the package.
- Performance tests: representative scene complexity, render frame time and peak memory.

Use deterministic fake providers/painters in ordinary CI. GPU tests should be separate, opt-in local tests with clear model prerequisites.

## 8. Non-goals and guardrails

- Do not replace React/Vite, Fastify, SQLite/Drizzle, the existing Canvas engine or Electron wrapper without measured evidence and an explicit decision.
- Do not rewrite the entire app or attempt M8–M14 in one coding-agent task.
- Do not make all characters use the same generic rig if anatomy differs; allow species/type-specific templates.
- Do not promise perfect face reconstruction or full 3D rotation from a single 2D image. Use pose variants or flag manual review where a turn exceeds available artwork.
- Do not use AI-generated per-frame video as the default renderer; it risks identity drift and is difficult to edit deterministically.
- Do not change project data destructively. Add migrations, backups and round-trip tests.

## 9. Recommended implementation order

1. M8 asset quality and identity continuity.
2. M9 hybrid rig foundation (first human/animal templates).
3. M10 expressions and pose variants.
4. M11 Motion Director and natural animation curves.
5. M12 cinematic compositor and depth.
6. M14 loop validation/package export.
7. M13 music-aware controls and the shared integration, or implement M13 before M14 if a real CR Content analysis payload is ready.

The sequence may be adjusted only after inspecting the current implementation and measuring the actual blocker. Finish each milestone with typecheck, lint, unit tests, relevant end-to-end tests, screenshots and a changed-files/limitations report.

## 10. Definition of production-ready

A scene is production-ready only when its character identity and anatomy are consistent, masks and reconstructed pixels are clean, rigged movement looks natural at normal playback speed, facial expressions and gaze are intentional, lighting and compositing are coherent, motion is deterministic, the loop boundary is acceptable, and the exported package passes technical validation.

**Related plan:** docs/CR-CONTENT-MUSIC-VIDEO-STUDIO-ROADMAP.md in the CR Content repository defines the receiving workflow and final song renderer.
