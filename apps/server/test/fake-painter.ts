// A GPU-free stand-in for the ComfyUI painter: small flat paintings of a balcony, a girl and a clock, with masks and
// inpainting done by color. Used by the layered tests and by scripts/layered-e2e.mjs.
import type { Painter } from "@anim/ai";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/** The girl-on-balcony plan a model would return for the acceptance prompt. */
export const PLAN = {
  title: "balcony wake",
  beats: [{ at: 0, label: "Asleep" }, { at: 3, label: "Wakes" }],
  setting: "balcony",
  environment: "balcony, night",
  characters: [{ id: "girl", look: "girl", pose: "sleeping", box: [0.45, 0.4, 0.75, 0.95] }],
  props: [{ id: "clock", look: "wall clock", box: [0.1, 0.1, 0.2, 0.28] }],
  actions: [{ type: "look_at", who: "girl", target: "clock", start: 3, end: 5 }],
};

const png = (w: number, h: number, draw: (g: ReturnType<ReturnType<typeof createCanvas>["getContext"]>) => void) => {
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  draw(g);
  return new Uint8Array(c.toBuffer("image/png"));
};
/** Mask of the pixels `keep` picks (white = in). */
async function maskOf(bytes: Uint8Array, keep: (r: number, g: number, b: number) => boolean) {
  const img = await loadImage(Buffer.from(bytes));
  const c = createCanvas(img.width, img.height);
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = keep(d.data[i], d.data[i + 1], d.data[i + 2]) ? 255 : 0;
    d.data.set([v, v, v, 255], i);
  }
  g.putImageData(d, 0, 0);
  return new Uint8Array(c.toBuffer("image/png"));
}

// small paintings keep the test fast; the pipeline works from the size it gets
export const painter: Painter = {
  name: "fake",
  paint: async (a) =>
    png(a.width / 8, a.height / 8, (g) => {
      const w = a.width / 8, h = a.height / 8;
      g.fillStyle = a.positive.includes("solo") || a.positive.includes("clock") ? "#ffffff" : "#203040";
      g.fillRect(0, 0, w, h);
      if (a.positive.includes("solo")) {
        g.fillStyle = "#c03c6e";
        g.beginPath();
        g.ellipse(w / 2, h * 0.62, w * 0.2, h * 0.26, 0, 0, Math.PI * 2);
        g.fill();
        // a turned view is told apart by a slightly darker skin (still what "head" segments)
        g.fillStyle = /profile|three-quarter/.test(a.positive) ? "#e8c0a0" : "#f0c8aa";
        g.beginPath();
        g.arc(w / 2, h * 0.3, h * 0.12, 0, Math.PI * 2);
        g.fill();
      } else if (a.positive.includes("clock")) {
        g.fillStyle = "#e6dcbe";
        g.beginPath();
        g.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2);
        g.fill();
      }
    }),
  removeBackground: (bytes) => maskOf(bytes, (r, g, b) => r + g + b < 740),
  // the subject check after painting finds everything drawn; a head is the skin-colored disc
  segment: (bytes, text) => maskOf(bytes, (r, g, b) => (text === "head" ? r > 220 && g > 180 && g < 215 && b > 150 && b < 190 : text !== "eyes" && r + g + b < 740)),
  inpaint: async (a) => {
    // repaint the masked area a flat neck color
    const [img, mask] = await Promise.all([loadImage(Buffer.from(a.image)), loadImage(Buffer.from(a.mask))]);
    return png(img.width, img.height, (g) => {
      g.drawImage(img, 0, 0);
      const m = createCanvas(img.width, img.height).getContext("2d");
      m.drawImage(mask, 0, 0);
      const md = m.getImageData(0, 0, img.width, img.height).data;
      const d = g.getImageData(0, 0, img.width, img.height);
      for (let i = 0; i < md.length; i += 4) if (md[i] > 128) d.data.set([150, 110, 90, 255], i);
      g.putImageData(d, 0, 0);
    });
  },
};

