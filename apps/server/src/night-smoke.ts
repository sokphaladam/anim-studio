// Draws "Night smoke", a hand-drawn duotone lofi loop: a girl at a counter at night, chin on her hand, a ribbon of
// cigarette smoke curling across a starry sky. Built only from the editor's own brush / fill / frame-by-frame layers,
// so it opens, plays and edits in the app like anything drawn by hand.
// Usage: npm exec -w @anim/server -- tsx src/night-smoke.ts [--export]
// Writes data/night-smoke/ (scene.json + check frames), saves it as a project, and with --export an MP4 (YouTube preset).
import { createRenderer, validateScene } from "@anim/engine";
import type { SceneSpec, Stroke } from "@anim/spec";
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./db";
import { exportMp4 } from "./export";

type P = [number, number];
const DUR = 8, FPS = 30, ANIM = 12; // smoke and stars are drawn "on twos" at 12 drawings a second, like hand animation
const TAU = Math.PI * 2;

// two-tone screen-print palette: near-black night, warm tan line and skin, cream highlights
const C = {
  night: "#100c0b",
  hair: "#1b1411",
  dress: "#0a0707",
  tan: "#c99a69",
  tanDark: "#9c6f49",
  line: "#2b1b14",
  cream: "#efdcb8",
  counter: "#1e1612",
};

const r1 = (v: number) => Math.round(v * 10) / 10;
const brush = (pts: P[], color: string, size: number, preset = "ink", pressure: (u: number) => number = () => 0.5): Stroke => ({
  tool: "brush",
  preset,
  color,
  size,
  points: pts.map(([x, y], i) => [r1(x), r1(y), Math.round(Math.min(1, Math.max(0, pressure(i / Math.max(1, pts.length - 1)))) * 100) / 100] as [number, number, number]),
});
const fill = (at: P, color: string): Stroke => ({ tool: "fill", at, color });

/** A smooth curve through control points (Catmull-Rom), sampled n times per span. */
function curve(pts: P[], n = 12, closed = false): P[] {
  const out: P[] = [];
  const N = pts.length;
  const at = (i: number) => (closed ? pts[(i + N) % N] : pts[Math.min(N - 1, Math.max(0, i))]);
  const spans = closed ? N : N - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)) as P);
    }
  }
  out.push(closed ? out[0] : pts[N - 1]);
  // run past the start so the brush's streamlining can't leave a gap the fill leaks through
  if (closed) out.push(out[1], out[2]);
  return out;
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 48, a0 = 0, a1 = TAU): P[] => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry]);

type Layer = SceneSpec["layers"][number];
const layers: Layer[] = [];
const draw = (id: string, strokes: Stroke[], extra: Partial<Layer> = {}) => layers.push({ id, type: "drawing", params: {}, frames: [{ start: 0, strokes }], ...extra } as Layer);
/** A solid shape on its own layer: a closed outline in its own color, then filled from `seed` (a point inside it). */
const shape = (id: string, ctrl: P[], color: string, seed: P, extra: Partial<Layer> = {}, more: Stroke[] = []) =>
  draw(id, [brush(curve(ctrl, 14, true), color, 3, "marker"), fill(seed, color), ...more], extra);
const onTwos = (n: number) => Array.from({ length: n }, (_, k) => k / ANIM);

// ── background: night, a faint dust band and twinkling stars
draw("night", [fill([4, 4], C.night)]);
const rnd = (() => {
  let s = 7;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();
const stars = Array.from({ length: 90 }, () => ({ x: rnd() * 1280, y: rnd() * 470, r: rnd() ** 3 * 2.6 + 0.8, ph: rnd() * TAU, sp: 1 + Math.floor(rnd() * 3) }));
const dust = Array.from({ length: 260 }, () => {
  const u = rnd();
  return { x: -40 + u * 640, y: 40 + u * 120 + (rnd() - 0.5) * 70 * (1 - u * 0.5), r: rnd() * 1.4 + 0.4, a: Math.floor(40 + rnd() * 90) };
});
const sparkle = (x: number, y: number, s: number): Stroke[] => [brush([[x - s, y], [x, y], [x + s, y]], C.cream, 2.2, "brush-pen", (u) => 1 - Math.abs(u - 0.5) * 2), brush([[x, y - s], [x, y], [x, y + s]], C.cream, 2.2, "brush-pen", (u) => 1 - Math.abs(u - 0.5) * 2)];
layers.push({
  id: "stars",
  type: "drawing",
  params: {},
  // a new star drawing every half second
  frames: Array.from({ length: DUR * 2 }, (_, k) => ({
    start: k / 2,
    strokes: [
      ...dust.map((d) => brush([[d.x, d.y], [d.x + 0.4, d.y]], C.tan + d.a.toString(16).padStart(2, "0"), d.r, "marker")),
      ...stars.flatMap((s) => {
        // each star brightens and dims on its own whole-number cycle, so the loop is seamless
        const b = 0.5 + 0.5 * Math.sin(s.ph + (TAU * s.sp * k) / (DUR * 2));
        const size = s.r * (0.6 + 0.8 * b);
        return size > 2.6 ? sparkle(s.x, s.y, size * 2.2) : [brush([[s.x, s.y], [s.x + 0.3, s.y]], C.cream, size, "marker")];
      }),
    ],
  })),
} as unknown as Layer);

// ── smoke: a ribbon that rises from the cigarette, curls and drifts across the sky, redrawn 12 times a second
const TIP: P = [532, 349];
const PATH: P[] = [TIP, [492, 340], [452, 318], [432, 280], [456, 240], [506, 214], [520, 168], [478, 128], [400, 112], [318, 126], [236, 100], [160, 62], [70, 52], [-30, 70]];
function smokeAt(t: number) {
  const ph = (TAU * t) / DUR;
  // each control point drifts on a loop; further from the tip it drifts more, and later (the wave climbs the ribbon)
  return curve(
    PATH.map(([x, y], i) => {
      const a = Math.min(1, i / 4) * (6 + i * 2.4);
      return [x + Math.sin(2 * ph - i * 0.8) * a, y + Math.cos(ph - i * 0.65) * a * 0.7] as P;
    }),
    10,
  );
}
layers.push({
  id: "smoke",
  type: "drawing",
  params: { opacity: 0.92 },
  frames: onTwos(DUR * ANIM).map((start) => {
    const pts = smokeAt(start);
    const ph = (TAU * start) / DUR;
    // thin at the tip, swelling and pinching like a twisting ribbon, fading out at the far end
    const width = (u: number, shift: number) => Math.min(1, u * 9) * (1 - u ** 3) * (0.22 + 0.6 * Math.abs(Math.sin(u * 7.5 - 2 * ph + shift)));
    return {
      start,
      strokes: [
        brush(pts, C.tan + "55", 26, "wash", (u) => width(u, 1.2)),
        brush(pts, C.tan, 22, "brush-pen", (u) => width(u, 0)),
        brush(pts.map(([x, y]) => [x + 2, y - 3] as P), C.cream + "aa", 7, "brush-pen", (u) => width(u, 0.4) * 0.8),
      ],
    };
  }),
});

// ── the girl: a group that breathes; hair, body, face and the hand holding the cigarette are its children
layers.push({ id: "girl", type: "group", params: {}, transform: { x: 0, y: "@breath", rotation: 0, scale: 1 } } as Layer);
const kid = { parent: "girl" } as Partial<Layer>;

// hair, back: a long dark mass falling to the counter on both sides, with tan strand lines
shape("hair-back", [[660, 138], [744, 160], [790, 240], [806, 360], [842, 470], [902, 560], [960, 612], [840, 626], [760, 620], [560, 622], [440, 626], [372, 612], [440, 560], [500, 470], [520, 360], [536, 240], [580, 160]], C.hair, [660, 300], kid, [
  ...[
    [[738, 190], [776, 300], [800, 420], [860, 530], [930, 604]],
    [[714, 210], [748, 330], [770, 440], [826, 560], [880, 616]],
    [[586, 190], [548, 300], [530, 420], [474, 530], [400, 606]],
    [[606, 210], [570, 330], [552, 450], [500, 560], [450, 616]],
    [[770, 380], [790, 470], [840, 560]],
    [[540, 380], [520, 470], [470, 560]],
  ].map((s) => brush(curve(s as P[], 10), C.tan, 3.2, "brush-pen", (u) => 0.15 + 0.5 * Math.sin(u * Math.PI))),
]);

// neck and shoulders, then the strapless dress, then the choker
shape("skin", [[638, 330], [684, 330], [688, 392], [742, 414], [790, 440], [806, 520], [800, 622], [520, 622], [514, 520], [532, 440], [584, 412], [634, 392]], C.tan, [660, 450], kid, [
  // collarbones and the neck's shadow side
  brush(curve([[600, 432], [628, 440], [652, 436]]), C.tanDark, 3, "brush-pen", (u) => Math.sin(u * Math.PI)),
  brush(curve([[672, 436], [700, 440], [728, 432]]), C.tanDark, 3, "brush-pen", (u) => Math.sin(u * Math.PI)),
  brush(curve([[684, 340], [680, 372], [672, 396]]), C.tanDark, 6, "wash", (u) => Math.sin(u * Math.PI)),
]);
shape("dress", [[526, 520], [580, 494], [622, 506], [660, 528], [700, 506], [742, 494], [796, 520], [806, 622], [516, 622]], C.dress, [660, 580], kid, [
  brush(curve([[526, 520], [580, 494], [622, 506], [660, 528], [700, 506], [742, 494], [796, 520]]), C.tan, 2.4, "ink"),
  brush(curve([[660, 528], [662, 560], [658, 590]]), C.tan, 2, "brush-pen", (u) => Math.sin(u * Math.PI) * 0.6),
]);
draw("choker", [
  brush(curve([[638, 382], [661, 390], [686, 382]]), C.dress, 9, "marker"),
  brush(ellipse(661, 402, 6, 7, 20), C.tan, 2.2, "ink"),
  brush(curve([[661, 394], [661, 396]]), C.tan, 2, "marker"),
], kid);

// head: face, ear, then features (on their own layers so eyes can blink)
shape("face", [[606, 228], [664, 214], [718, 228], [726, 280], [714, 320], [690, 348], [662, 360], [632, 348], [608, 318], [598, 280]], C.tan, [662, 280], kid, [
  // jaw and cheek contour on the light side, soft shadow under the bangs
  brush(curve([[724, 280], [714, 320], [690, 348], [662, 360]]), C.line, 2.4, "ink", (u) => 0.3 + u * 0.4),
  brush(curve([[602, 246], [664, 238], [722, 246]]), C.tanDark, 12, "wash"),
  // blush hatching
  ...[0, 1, 2].flatMap((i) => [brush([[612 + i * 7, 306], [606 + i * 7, 314]], C.tanDark, 2.2, "brush-pen"), brush([[688 + i * 7, 306], [682 + i * 7, 314]], C.tanDark, 2.2, "brush-pen")]),
  // nose and a small, tired mouth
  brush(curve([[664, 304], [661, 314], [665, 316]]), C.line, 2, "ink"),
  brush(curve([[650, 334], [660, 337], [672, 333]]), C.line, 2.6, "brush-pen", (u) => Math.sin(u * Math.PI)),
]);

// eyes, half-lidded and drowsy, frame by frame: a blink at 2.6 s and a slow heavy blink at 6 s
const eye = (cx: number, cy: number, lid: number, flip: number): Stroke[] => {
  if (lid >= 1)
    return [brush(curve([[cx - 17 * flip, cy - 1], [cx, cy + 5], [cx + 17 * flip, cy - 2]]), C.line, 4, "brush-pen", (u) => 0.3 + Math.sin(u * Math.PI) * 0.7), brush(curve([[cx + 15 * flip, cy - 2], [cx + 21 * flip, cy - 6]]), C.line, 2.5, "brush-pen")];
  const top = cy - 9 + lid * 12; // the upper lid comes down over the iris
  const iris = [brush(ellipse(cx, cy + 1, 9, 10, 32), C.line, 4, "marker"), fill([cx, cy + 1], C.line), brush(ellipse(cx - 2, cy + 3, 4, 5, 20), C.dress, 3, "marker")];
  return [
    // white of the eye, cut off by the lid
    brush(curve([[cx - 16, top + 2], [cx, top], [cx + 16, top + 2], [cx + 13, cy + 8], [cx, cy + 10], [cx - 13, cy + 8]], 10, true), C.cream, 2, "marker"),
    fill([cx, Math.min(cy + 6, top + 6)], C.cream),
    ...iris,
    // the lid covers the iris above it
    brush([[cx - 20, top - 8], [cx + 20, top - 8]], C.tan, 16, "marker"),
    brush(curve([[cx - 18 * flip, top + 3], [cx - 6 * flip, top - 1], [cx + 8 * flip, top - 1], [cx + 20 * flip, top + 2], [cx + 23 * flip, top - 2]]), C.line, 5, "brush-pen", (u) => 0.45 + u * 0.55),
    brush(curve([[cx - 14 * flip, top - 7], [cx, top - 10], [cx + 14 * flip, top - 7]]), C.tanDark, 2, "brush-pen", (u) => Math.sin(u * Math.PI)),
    brush(curve([[cx - 10 * flip, cy + 11], [cx + 8 * flip, cy + 10]]), C.line, 2, "brush-pen", (u) => Math.sin(u * Math.PI)),
    brush([[cx + 4, top + 5], [cx + 4.4, top + 5]], C.cream, 3.6, "marker"),
  ];
};
const eyesAt = (lid: number) => [...eye(634, 292, lid, -1), ...eye(692, 292, lid, 1)];
const BLINK: [number, number][] = [[0, 0.32], [2.6, 0.75], [2.68, 1], [2.84, 0.75], [2.92, 0.32], [5.9, 0.55], [6.05, 0.8], [6.2, 1], [6.6, 0.8], [6.75, 0.55], [6.9, 0.32]];
layers.push({ id: "eyes", type: "drawing", params: {}, parent: "girl", frames: BLINK.map(([start, lid]) => ({ start, strokes: eyesAt(lid) })) } as Layer);

// hair, front: crown, blunt bangs with a jagged edge, and two side locks that sway
shape("bangs", [[598, 230], [588, 186], [612, 150], [662, 136], [712, 150], [736, 186], [728, 236], [722, 266], [712, 252], [702, 272], [690, 256], [678, 276], [666, 258], [654, 276], [642, 258], [630, 272], [618, 254], [608, 268], [600, 248]], C.hair, [664, 190], kid, [
  ...[
    [[662, 140], [640, 180], [626, 240]],
    [[664, 140], [684, 184], [700, 240]],
    [[650, 146], [620, 172], [604, 214]],
    [[676, 146], [708, 172], [724, 214]],
  ].map((s) => brush(curve(s as P[], 10), C.tan, 2.6, "brush-pen", (u) => 0.1 + 0.6 * Math.sin(u * Math.PI))),
  brush(curve([[612, 150], [662, 136], [712, 150]]), C.tan, 2.4, "ink", (u) => Math.sin(u * Math.PI)),
]);
const lock = (id: string, ctrl: P[], seed: P, line: P[], pivot: P) =>
  shape(id, ctrl, C.hair, seed, { parent: "girl", pivot, transform: { x: 0, y: 0, rotation: id.endsWith("l") ? "@swayL" : "@swayR", scale: 1 } } as Partial<Layer>, [
    brush(curve(line, 12), C.tan, 2.6, "brush-pen", (u) => 0.15 + 0.55 * Math.sin(u * Math.PI)),
  ]);
lock("lock-l", [[604, 220], [596, 290], [590, 360], [578, 420], [566, 470], [584, 430], [604, 360], [614, 290], [616, 228]], [604, 300], [[606, 230], [600, 320], [584, 420], [570, 466]], [608, 224]);
lock("lock-r", [[716, 220], [728, 290], [736, 360], [752, 420], [766, 472], [742, 430], [720, 360], [710, 290], [708, 228]], [720, 300], [[716, 230], [724, 320], [742, 420], [762, 468]], [714, 224]);

// the arm resting on the counter (viewer's right) and the arm propping her chin (viewer's left), with the cigarette
shape("arm-rest", [[812, 560], [840, 592], [820, 624], [700, 628], [672, 618], [680, 600], [720, 598], [790, 590]], C.tan, [760, 610], kid, [
  brush(curve([[680, 600], [720, 598], [790, 590], [812, 560]]), C.line, 2.4, "ink", (u) => 0.3 + 0.4 * Math.sin(u * Math.PI)),
  brush(curve([[690, 606], [684, 614]]), C.line, 2, "brush-pen"),
  brush(curve([[702, 604], [697, 614]]), C.line, 2, "brush-pen"),
]);
shape("arm-chin", [[548, 626], [536, 560], [548, 480], [574, 410], [596, 372], [618, 352], [646, 346], [652, 364], [632, 382], [612, 420], [590, 500], [588, 570], [600, 626]], C.tan, [580, 500], kid, [
  brush(curve([[600, 626], [588, 570], [590, 500], [612, 420], [632, 382]]), C.line, 2.6, "ink", (u) => 0.25 + 0.5 * Math.sin(u * Math.PI)),
  // knuckles of the curled fingers under the chin
  brush(curve([[618, 356], [628, 350], [640, 350]]), C.line, 2.4, "brush-pen"),
  brush(curve([[612, 370], [624, 364], [636, 364]]), C.line, 2.2, "brush-pen"),
  brush(curve([[606, 384], [616, 378], [628, 378]]), C.line, 2, "brush-pen"),
  // bracelet
  brush(curve([[540, 548], [566, 556], [594, 550]]), C.dress, 5, "marker"),
]);
draw("cigarette", [
  brush([[608, 356], [536, 349]], C.cream, 6.5, "marker"),
  brush([[548, 350], [536, 349]], C.tanDark, 6.5, "marker"),
  brush([[614, 354], [604, 357]], C.tan, 7, "marker"),
], kid);
// the ember breathes in time with her
layers.push({ id: "ember", type: "drawing", params: { opacity: "@ember", blend: "add" }, parent: "girl", frames: [{ start: 0, strokes: [brush([[TIP[0] + 1, TIP[1]], [TIP[0] + 1.4, TIP[1]]], "#e8763a", 14, "airbrush"), brush([[TIP[0] + 1, TIP[1]], [TIP[0] + 1.3, TIP[1]]], "#ffcf8a", 5, "marker")] }] } as unknown as Layer);

// ── the counter and a glass with a straw
shape("counter", [[-10, 622], [1290, 622], [1290, 730], [-10, 730]], C.counter, [640, 680], {}, [
  brush([[-10, 624], [1290, 624]], C.tan, 4, "marker"),
  ...[[60, 660, 380], [520, 690, 980], [900, 650, 1250], [140, 706, 520]].map(([x0, y, x1]) => brush(curve([[x0, y], [(x0 + x1) / 2, y + 2], [x1, y]]), C.tanDark, 2, "brush-pen", (u) => Math.sin(u * Math.PI) * 0.7)),
]);
// strands of hair spilling over the counter edge
draw("hair-spill", [
  ...[
    [[372, 612], [330, 626], [260, 630], [200, 640]],
    [[440, 622], [380, 634], [320, 646]],
    [[902, 600], [960, 624], [1040, 632], [1100, 644]],
    [[860, 620], [930, 636], [990, 652]],
  ].map((s) => brush(curve(s as P[], 12), C.hair, 9, "brush-pen", (u) => 0.9 - u * 0.8)),
  ...[
    [[372, 612], [330, 626], [260, 630], [200, 640]],
    [[902, 600], [960, 624], [1040, 632], [1100, 644]],
  ].map((s) => brush(curve(s as P[], 12), C.tan, 2.2, "brush-pen", (u) => (1 - u) * 0.8)),
]);
// opaque lines first so the fills stay inside them (the fill treats faint pixels as empty)
const GLASS: P[] = [[404, 520], [410, 624], [464, 624], [470, 520]];
draw("glass", [
  brush([...GLASS, GLASS[0]], C.cream, 3, "ink"),
  brush(curve([[407, 560], [437, 566], [467, 560]]), C.cream, 2.4, "ink"),
  fill([437, 600], C.cream + "cc"),
  fill([437, 540], C.cream + "22"),
  brush(ellipse(437, 520, 33, 5, 32), C.cream, 2.4, "ink"),
  // ice, a straw and a glint
  brush(curve([[420, 574], [432, 570], [436, 584], [424, 588], [420, 574]], 6), C.tanDark, 2, "ink"),
  brush([[452, 470], [446, 604]], C.tan, 5, "marker"),
  brush([[452, 470], [462, 456]], C.tan, 5, "marker"),
  brush(curve([[416, 532], [414, 610]]), C.cream, 4, "brush-pen", (u) => Math.sin(u * Math.PI)),
]);

const spec = {
  version: 1,
  meta: { title: "Night smoke", subtitle: "hand-drawn duotone lofi loop", duration: DUR, fps: FPS, width: 1280, height: 720 },
  tracks: {
    breath: { keys: [[0, 0], [2, 2.2], [4, 0], [6, 2.2], [8, 0]], loop: true },
    swayL: { keys: [[0, -0.02], [4, 0.025], [8, -0.02]], loop: true },
    swayR: { keys: [[0, 0.02], [2, -0.02], [4, 0.02], [6, -0.02], [8, 0.02]], loop: true },
    ember: { keys: [[0, 0.55], [2, 1], [4, 0.55], [6, 1], [8, 0.55]], loop: true },
    zoom: { keys: [[0, 1.02], [4, 1.06], [8, 1.02]], loop: true },
    camX: { keys: [[0, 640], [4, 616], [8, 640]], loop: true },
  },
  camera: { zoom: "@zoom", x: "@camX", y: 380 },
  layers,
  overlays: [{ type: "vignette", params: { strength: 0.7 } }],
  beats: [{ at: 0, label: "Night smoke", note: "she stares off, smoke curls across the stars" }, { at: 6, label: "Heavy blink" }],
} as unknown as SceneSpec;

const v = validateScene(spec);
if (!v.ok) throw new Error(v.errors.join("\n"));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = join(root, "data", "night-smoke");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "scene.json"), JSON.stringify(v.spec));
const canvas = createCanvas(1280, 720);
const r = createRenderer(canvas, v.spec, { createCanvas: (w, h) => createCanvas(w, h) });
const t0 = performance.now();
for (const t of [0, 2.7, 4, 6.3]) {
  r.render(t);
  writeFileSync(join(out, `t-${t}.png`), canvas.toBuffer("image/png"));
}
console.log(`check frames in ${out} (${((performance.now() - t0) / 4).toFixed(0)} ms a frame at 1280×720)`);
if (process.argv.includes("--export")) {
  const store = createStore(process.env.DB_PATH || join(root, "data", "anim-studio.db"));
  console.log(`saved as project ${store.create(v.spec, "Drawn by night-smoke.ts").id}`);
  store.close();
  const file = join(out, "night-smoke.mp4");
  await exportMp4(v.spec, "youtube", join(root, "data", "images"), file, () => {});
  console.log(`exported ${file}`);
}
