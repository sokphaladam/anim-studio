import { readFileSync, writeFileSync } from "node:fs";
import { comfyui, videoPrompt, HOLD_STILL } from "../packages/ai/src/index.ts";
const p = comfyui({ url: "http://127.0.0.1:8188", dir: "D:/Workplace/anim-studio/data/comfyui" });
const [img, out, loop] = [process.argv[2], process.argv[3], process.argv[4] === "loop"];
const motion = "her head nodding softly to the music, blinking slowly, breathing gently, steam curling up from the mug, stars twinkling";
const t0 = Date.now(); let last = "";
const mp4 = await p.animate!({ image: readFileSync(img), positive: videoPrompt(`${motion}. ${HOLD_STILL}`, "a girl with headphones at a desk in an attic studio at night"), negative: "", width: 1280, height: 704, frames: 97, fps: 24, seed: 7, loop,
  onProgress: (x) => { const k = x.label + (x.step ? ` ${x.step}/${x.steps}` : ""); if (k !== last) console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + "s", k); last = k; } });
writeFileSync(out, mp4); console.log("done", ((Date.now() - t0) / 1000).toFixed(0), "s");
