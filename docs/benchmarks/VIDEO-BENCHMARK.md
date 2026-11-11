# Video model benchmark (M12)

**Run:** 2026-11-10, `scripts/bench-video.mts`. Three cinematic-shot cases: the same first frame and the same motion prompt for every model, each 4 s at 720p, seed 7, no audio.
**Machine:** RTX 3060 12 GB, 32 GB RAM, Windows 11. The network had slow DNS that sometimes failed.
**Raw data:** `video-2026-11-09/results.json` (time, cost, frames, size, checks, Runway task ids). Contact sheets are in `video-2026-11-09/sheets/`: 8 frames from start to end, plus each case's first frame.

| Case (example scene) | What should move |
| --- | --- |
| **night** (`night-study`) | rain on the window, the person nodding while writing, the candle flickering, a slow push-in |
| **autumn** (`autumn-window`) | leaves drifting past the window, the sleeping animal breathing, warm light flickering |
| **owl** (`snowy-owl`) | snow falling, the owl blinking and turning its head, branches swaying |

## Results

| Model | Cost / 4 s clip | Time (night / autumn / owl) | App clip checks | Motion (by eye) | Steadiness (by eye) |
| --- | --- | --- | --- | --- | --- |
| **seedance2_5** (Runway) | $1.20 (30 credits/s) | 298 / 166 / 149 s | 3/3 pass | **Best.** Rain clearly visible; the owl blinks and turns its head. | Look, colours and characters steady. |
| **kling_4** (Runway) | $0.51 (12.56 credits/s, 20% off until 2026-11-30; list price 15.7/s = $0.63) | 273 / 315 / 460 s | 3/3 pass | **Least.** Night barely moves. In autumn the lamp lights up and leaves float *inside* the room. The owl blinks. | Steady, but adds unasked motion. |
| **Wan 2.2 TI2V 5B** (local ComfyUI) | free | 740 / 828 / 757 s | 3/3 pass | Subtle; night and autumn move gently. | **Weakest.** In owl the starfield is gone after the first frame and the owl spreads its wings (not asked). |

- **Frames:** cloud clips came back as 97 frames at 1280×720, local as 93 frames at 1280×704. Both are within the app's duration tolerance.
- **What the app's checks do and don't see:** all 9 clips passed duration, size, blank-frame and flicker checks. Those checks didn't catch the vanished starfield or the extra wing pose. Judging scene drift and prompt adherence still needs eyes or a vision model (not built; see the architecture doc's status).

## Choosing defaults

- **Cloud default: keep `RUNWAY_VIDEO_MODEL=seedance2_5`.** It followed the motion prompt best and kept the scene steady on every case, and it was the fastest. It costs the most: about $0.30 per second, $0.80 minimum per clip. With the default `RUNWAY_MAX_COST_USD=5`, a job affords one 10 s shot plus a retry of a shorter one.
- **Budget cloud: `kling_4`.** About 40% of seedance's price while the discount lasts, and just as steady, but it moves too little or adds motion of its own. Use it when calm, near-still shots are fine.
- **Turbo LoRA (2026-11-12):** with `Wan22_TI2V_5B_Turbo_lora_rank_64` (4 steps, cfg 1) the same night clip took **140 s instead of 740 s** on the 3060, checks pass, no visible drift. It's on by default when the LoRA is installed; `VIDEO_TURBO=0` goes back to 20 steps. Results: `video-2026-11-11/results-local.json`.
- **Tiled decode (2026-11-12):** profiling a 6 s loop (144 frames, turbo) on the 3060: load ~50 s, 4 steps ~85 s, **frame decode 425 s** (the plain VAEDecode overflows 12 GB and falls back to a crawl). `VAEDecodeTiled` (512 px tiles, 64 frames) cut the decode to 155 s and the clip from **567 s to 292 s**, with no visible seams (SSIM 0.94 against the untiled frame). 1024 px / 32-frame tiles were only 9 s faster, so the safer setting stays.
- **Local (free): Wan 2.2 stays the offline/default path** when cloud is off. It takes about 12–14 min per 4 s clip on a 3060 (roughly 3 min per second of video). It drifts more on dark, sparse scenes like the starry owl sky.
- **Choosing by style:** these three are all soft lofi anime scenes, which is what the app makes. Seedance led on all three, so there is no reason yet to pick models per style. Re-run the script when new styles or models arrive.

## Cost and reliability notes

- **Total Runway spend: $6.84.**
  - 9 clips were billed: 6 kept ($5.13) and 2 lost, re-made for $1.71.
  - The first two benchmark tries failed on DNS before any task was made, so they cost nothing.
- **Where the money went:**
  - **Lost after rendering ($1.71):** seedance night and kling autumn were rendered and billed, but their downloads failed when the connection dropped. A dropped download is now treated as an outage and retried (test added). The script also saves each task id as soon as it exists, so a lost clip can be fetched again.
  - **Earlier verification ($1.20):** one more seedance clip from the M11 live check.
- **Price checks:**
  - Seedance's quote matched Runway's bill exactly.
  - Kling is quoted at list price while the discount runs, so the app over-quotes it by about 25%. That is the safe direction; update `PRICE` in `packages/ai/src/video.ts` when prices change.
- **Low memory:**
  - **What happened:** Wan 2.2 (a 9.5 GB model) failed twice while the cloud benchmark was running at the same time. ComfyUI crashed mid-clip, then hit a `MemoryError` while loading the model. Alone on the machine it worked every time.
  - **Advice:** on 32 GB RAM, don't run other heavy work during local video. The app now says the PC ran out of memory instead of "fetch failed".
  - **Not covered:** cards under 12 GB were not tested.

## Re-running

```sh
cd apps/server
npx tsx ../../scripts/bench-video.mts --models seedance2_5,kling_4,local --max-usd 6
```

- **Pricing first:** the script prices the clips still to make before starting anything paid, and stops if they are over `--max-usd`.
- **Resumable:** clips already made are kept.
- **Output:** results go to `docs/benchmarks/video-<date>/`. Use `--cases night,owl` to run fewer cases.
