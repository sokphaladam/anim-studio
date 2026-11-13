# Anim Studio — Next Improvement Plan

**Repo:** `sokphaladam/anim-studio` @ `65f587f` ("enhance walking actions with resting poses and jumping mechanics"), reviewed 2026-11-13
**Target look:** the lofi night-balcony screen recording (a calm painted scene; only a writing hand, a head bob, a changing laptop screen, twinkling string lights and candles move; seamless loop). Use the technique, not the artwork: characters and scenes stay original.

Give this file to your coding agent the same way as `BRIEF.md`: one phase at a time, read the current code and Git status first, then tests, a changed-files list and known limitations at the end of each phase.

---

## 1. Where the project stands

The project is far along. It has about 21,500 lines of TypeScript across 7 workspaces, and every milestone in `docs/ANIM-STUDIO-PRODUCTION-QUALITY-ROADMAP.md` is in code except M13 (music).

| Area | State |
| --- | --- |
| Editor (dockview, drawing, timeline, onion skin, layers, history) | Done |
| Deterministic engine: tracks, actions, bones, 2-bone IK, mesh skinning, switches, look/compositing, loop report | Done |
| AI: Ollama plan → ComfyUI paint → BiRefNet/SAM 3.1 cut → reconstruct → rig → animate | Done |
| Cinematic video: Runway (seedance / kling) + local Wan 2.2, budget, retries, crash recovery | Done, benchmarked |
| Export: MP4 presets, CR Content package with manifest + checksums, import | Done |
| Music-aware animation (M13) | **Not started** |

**Checks I ran on a fresh clone (Linux, Node 22):**

- `npm run typecheck`: passes in all 7 workspaces.
- Tests: `packages/spec` 8/8, `packages/engine` 102/102, `packages/ai` 85/85 and `apps/web` 29/29 pass.
- `apps/server` tests were **not run**: `better-sqlite3` couldn't compile in my sandbox. This is my environment, not your code; run them on your PC.
- `npm run lint`: **fails with 2 errors**, so the CI workflow (`lint` runs before `test`) is red on `main`.

**The biggest risk** isn't missing code. It's that most of the M8–M11 artwork features were only ever run on the **fake painter**: iris separation, expression patches, the Motion Director with a real model, and fringe checks at 200%. The docs say so honestly. Nothing proves the real GPU pipeline produces a scene like the recording.

---

## 2. Gap analysis against the recording

| What moves in the recording | What Anim Studio can do today | Gap |
| --- | --- | --- |
| Writing hand | `swing` on a SAM-found part, or a bone with `write` clip | Generated characters aren't auto-rigged; the arm moves as one flat piece |
| Head bob to the beat | `bob` action | No BPM / beat input from the song (M13) |
| String lights and candles twinkle | Engine has `flicker` and `glow` objects | **The AI planner can't use them.** `AMBIENT` in `layered.ts` only allows `stars`, `falling-leaves`, `birds`, `steam`, `rain` |
| Laptop screen changes | Switches and footage layers exist | No plan field or stage for a screen region |
| City bokeh shimmer, dust, window rain, snow, fireflies | Engine has `dust`, `window-rain`, `snow`, `fireflies` | Same as above: not offered to the planner |
| Nothing else drifts | Deterministic engine guarantees it | Only cinematic video can drift (the benchmark showed the owl starfield vanishing); no check catches it |

Most of the visible gap is one well-scoped change: **let the planner use the engine effects that already exist** (Phase 2).

---

## 3. Phases (do them in this order)

### Phase 0 — Clean up `main` (small)

**Why:** CI is red, so any later regression is invisible. The repo also carries generated files.

- Fix the two lint errors:
  - `apps/server/src/routes/generate.ts:158`: `({ target: _, ...c })`. Destructure without the unused name, or add `argsIgnorePattern: "^_"` / `destructuredArrayIgnorePattern` to the `no-unused-vars` rule in `eslint.config.js`.
  - `packages/ai/src/video.ts:122`: `timeoutMs` is destructured in `generateVideo` but only used in `pollVideo` (which receives `o`). Remove it from that destructure. The timeout itself still works.
- Stop tracking generated files: `git rm -r --cached .DS_Store graphify-out .vitest`. Add `.DS_Store`, `graphify-out/` and `.vitest/` to `.gitignore`. `graphify-out` alone is 3 MB of cache. Decide whether `.serena/` and `.claude/settings.json` belong in the repo.
- README: fix "with the with the Animagine…" in the AI generation section.
- Milestone numbers collide. `README` says "Milestone 11". Both `docs/ANIM-STUDIO-HYBRID-ANIMATION-ARCHITECTURE.md` and `docs/ANIM-STUDIO-PRODUCTION-QUALITY-ROADMAP.md` define their own M8–M12 with different meanings. Rename one set (for example H8–H12 for the hybrid/video track), and add a single "Status" table to the README that lists both tracks.
- Optional: format `package.json` (`"setup:painter":"…"` has no space). Run Prettier across the repo once in a separate commit.

**Done when:** `npm ci && npm run lint && npm run typecheck && npm test && npm run build` passes locally and in GitHub Actions.

### Phase 1 — Prove the real GPU pipeline (medium, highest value)

**Why:** every later phase depends on knowing how real ComfyUI art behaves. Today, only the fake painter is proven.

- Add `scripts/golden-e2e.mjs`, or extend `generate:layered`. It runs the golden prompt from the architecture doc plus a lofi study prompt in the spirit of the recording, on the real model and ComfyUI, and writes to `docs/benchmarks/layered-<date>/`:
  - every stage image (background, character source, masks, cut-outs, reconstructed body, eye/expression patches);
  - a contact sheet of 8 frames across the loop, plus the seam (last frame next to the first);
  - stage timings and **peak VRAM / RAM per stage** (roadmap §6 asks for this and it doesn't exist yet). On Windows, read it from `nvidia-smi --query-gpu=memory.used --format=csv` polled during each stage.
  - the `loopReport`, `rigProblems`, `poseProblems` and quality report as JSON.
- Write `docs/benchmarks/LAYERED-BENCHMARK.md` the same way as `VIDEO-BENCHMARK.md`: what passed, what looked wrong by eye, and which checks missed it.
- Fix whatever breaks first. Likely candidates: SAM 3.1 not finding small parts like a pen hand, white fringe at 200% on dark night scenes, iris separation on anime eyes, and the Motion Director's JSON from `qwen2.5-coder:14b`.

**Done when:** two real scenes generate end to end on the RTX 3060, the results are committed, and each failure is either fixed or listed as a known limitation.

### Phase 2 — Close the "recording look" gaps (small to medium)

**2a. Let the planner use the existing effects.**

- `packages/ai/src/layered.ts`:
  - extend `AMBIENT` and `AMBIENT_PERIOD` with `flicker`, `glow`, `dust`, `window-rain`, `snow` and `fireflies`;
  - add a branch for each in `ambientLayers`, mapping the plan box to each object's params;
  - set `window-rain` to `clip` to a window layer when the plan names one;
  - add each effect's phrase to the motion description map (line ~147).
- `packages/ai/prompts/layered.md`: describe each new effect in one line, and add a rule that night scenes with lamps, string lights or candles should use `flicker` or `glow`.
- `packages/ai/test/layered.test.ts`: one test per new effect (the layer is created, its period fits the scene, and `loopReport` is clean).

**2b. Twinkling lights placed where the painting actually has lights.**

- After the background stage, find bright small blobs in the painted background (local luminance maxima above a threshold, filtered by size). This step is deterministic, with no model involved.
- Emit `glow` and `flicker` points there, each with a seeded phase so the bulbs don't pulse together. Limit the count (for example 40), and only do this when the plan asked for lights.
- Put it in a new pure function, for example `findLights(raster)` in `packages/ai/src/regions.ts`, with unit tests on synthetic images.

**2c. Screen content.**

- Add an optional plan field `screen: { prop, frames: 2–4, period }`.
- Find the screen with SAM 3.1 ("laptop screen" or "phone screen" on the prop), then paint 2–4 small screen images. Simple flat UI or a soft glow is enough.
- Make them a **switch** clipped to the screen mask, with a cross-fade. Add a `glow` on the face for screen light.

**Done when:** the lofi study prompt produces twinkling lights at the painted bulb positions, a changing screen, and no seam in the "Play 3 loops" view.

### Phase 3 — Vision QA for what the deterministic checks miss (medium)

**Why:** the video benchmark showed all 9 clips passing every check while the owl's starfield vanished and it spread wings nobody asked for. The same blind spot applies to cut-outs (wrong part found, identity drift).

- Add an optional local vision model through Ollama, a Qwen2.5-VL-class model that fits in 12 GB at 4-bit. Check current options before choosing. Load it after the painter unloads, like the existing model lifecycle.
- Ask narrow, structured questions with a Zod-validated answer:
  - "Is this cut-out a [head / arm holding a pen / cat]? yes / no / unsure."
  - "Compared with frame 1, did any of these disappear: [list from the plan]?"
  - "Does anything move that is not in this list: [planned motions]?"
- The answers only ever set `review` with a note. They never pass or fail a shot on their own, which keeps the honest-reporting rule.
- Add this to the Quality report tab and to `quality-report.json` in packages.
- Use a fake vision provider in CI. Run the real one as an opt-in local test.

### Phase 4 — Auto-rig generated characters (large)

**Why:** right now a person must add the skeleton, and the arm moves as one flat cut-out. That's the main thing between "puppet" and the recording's natural writing hand.

- Segment limbs during generation, not only "moving parts": upper arm, forearm and hand for the arm that acts. Use SAM 3.1 prompts plus geometry (each piece must touch its neighbour).
- Place bones from the masks (joint = the overlap centroid between neighbouring pieces), apply the person template from M9, and attach each piece to its bone. Use a mesh only for sleeves and hair.
- Reconstruct the elbow and wrist from the hidden pixels, the item the M8 status lists as "needs M9 limb pieces".
- Make the `write` and `sip` clips use IK on the auto rig. Fall back to the current rigid `swing` whenever a limb piece is missing, and flag it for review.
- Add to the fake painter a character whose limbs separate, so CI covers the whole path.

### Phase 5 — M13 music-aware input (medium)

This is the only roadmap milestone not started. Do it once CR Content can send a real analysis payload.

- `packages/spec`: add `MusicAnimationDataSchema` (duration, bpm, beats[], sections[{start, end, type, energy}], optional energy envelope) and optional `SceneSpec.music`.
- `packages/engine`: let actions use `period: "beat" | "bar"` and `amount` scaled by section energy, with min/max and smoothing. Fit loop length to whole bars (8 / 12 / 16 / 24 s).
- Editor: import a JSON file, show beat markers on the timeline, and add a "sync to beat" toggle on `bob`, `flicker` and camera push.
- Acceptance as in the roadmap: beats land within one frame, phases are offset so not everything pulses together, and missing data falls back to normal timing.

### Phase 6 — Editor gaps listed in the docs (pick as needed)

Each of these is listed as "Not done" in the roadmap. They're independent of each other.

- Paint mask corrections by hand in the Part check docker (brush add/remove on the mask, then re-cut).
- Regenerate a single part without touching the rest of the scene.
- Click a bone on the canvas to select it.
- Draw curve handles and switch keys on the timeline rows, not only in the Motion and Face dockers.
- Drag clips in the Results panel instead of using number fields.
- Paint weights by hand (the data model already accepts `weights`).
- Walk cycle with root travel and foot contacts.

### Phase 7 — Performance and reliability (small to medium)

- Profile 1080p export with the look effects on. The roadmap says this is "not yet profiled". Record ms/frame per effect in the benchmark doc.
- `follow` samples 24 earlier moments per frame. Cache per-time results within one render pass, or limit chain depth.
- Reattach collected cloud clips (`GET /api/video/recovered`) to the shot that asked for them, not only list them.
- Make `POST /api/characters/view` a job with progress events, like generation.
- Test an 8 GB card, or simulate one by lowering the VRAM budget, and document what fails.

---

## 4. Suggested order and size

| # | Phase | Size | Unblocks |
| --- | --- | --- | --- |
| 0 | Clean up `main` | S | Trustworthy CI |
| 1 | Real GPU proof | M | Every later phase |
| 2 | Lights, screen, effects in planner | S–M | The recording look |
| 3 | Vision QA | M | Catching drift and wrong parts |
| 4 | Auto-rig | L | Natural hand and arm motion |
| 5 | Music input | M | Beat-synced loops for CR Content |
| 6 | Editor gaps | S each | Manual fixes |
| 7 | Performance and reliability | S–M | Long exports, smaller GPUs |

Phases 0 and 2a are quick wins you can do in one session. Phase 1 should come before anything big, because it will change what Phases 3 and 4 need to fix.
