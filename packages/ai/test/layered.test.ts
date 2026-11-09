import { evalTrack } from "@anim/engine";
import { describe, expect, it } from "vitest";
import { generateLayered, planProblems, LayeredPlanSchema, type LayeredEvent, type LayeredTools, type Painter, type Provider, type Raster } from "../src";
import { cleanMask, despeckle, feather, fillHoles, grow, haloShare, maskBox, maskFrom, palette, paletteDrift, peelPale, neckPoint, partProblems, recut, reviewOf, shrink, smear, touchesEdge, type Mask } from "../src/masks";

const PLAN = {
  title: "waking on the balcony",
  mood: "quiet night",
  beats: [{ at: 0, label: "Asleep" }, { at: 3, label: "Wakes" }],
  setting: "balcony",
  environment: "balcony, railing, night sky, city lights",
  lighting: "night, moonlight",
  characters: [{ id: "girl", look: "girl, hoodie", pose: "sitting, sleeping, eyes closed", box: [0.45, 0.4, 0.75, 0.95] }],
  props: [{ id: "clock", look: "wall clock", box: [0.1, 0.1, 0.2, 0.28] }],
  actions: [{ type: "look_at", who: "girl", target: "clock", start: 3, end: 5, wakes: true }],
};

// colors of the synthetic paintings
const SCLERA = [250, 250, 248], MOUTH = [170, 40, 50];
const SKIN = [240, 200, 170], SHIRT = [200, 60, 110], NECK = [150, 110, 90], EYE = [20, 20, 30], CLOCK = [230, 220, 190], SKY = [30, 40, 70];

function raster(w: number, h: number, at: (x: number, y: number) => number[] | null, bg = [255, 255, 255]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...(at(x, y) ?? bg), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
const near = (d: Uint8ClampedArray, i: number, c: number[]) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) < 12;
const maskWhere = (r: Raster, pick: (i: number) => boolean) => raster(r.width, r.height, (x, y) => (pick((y * r.width + x) * 4) ? [255, 255, 255] : null), [0, 0, 0]);

/** A character on white: a shirt-colored body with a round head on top, two dark eyes in it. */
function character(w: number, h: number, face = false) {
  const hx = w / 2, hy = h * 0.3, hr = h * 0.12;
  return raster(w, h, (x, y) => {
    if (face && Math.hypot(x - hx, y - hy) < hr) {
      // eye whites with a dark iris in each, and a mouth below
      const ex = Math.abs(Math.abs(x - hx) - hr * 0.4), ey = Math.abs(y - hy);
      if (ex < hr * 0.25 && ey < hr * 0.16) return ex < hr * 0.09 && ey < hr * 0.1 ? EYE : SCLERA;
      if (Math.abs(x - hx) < hr * 0.3 && Math.abs(y - (hy + hr * 0.5)) < hr * 0.06) return MOUTH;
      return SKIN;
    }
    if (Math.hypot(x - hx, y - hy) < hr) return Math.abs(y - hy) < hr * 0.12 && Math.abs(Math.abs(x - hx) - hr * 0.4) < hr * 0.15 ? EYE : SKIN;
    // a rounded torso under the head (a real cut-out never fills its box)
    if (y >= hy + hr * 0.8 && ((x - w / 2) / (w * 0.22)) ** 2 + ((y - h * 0.62) / (h * 0.28)) ** 2 < 1) return SHIRT;
    return null;
  });
}

/** In-memory PNG stand-ins: "encoding" stores the raster under a token. */
/** missCharacter: the first `n` character paintings come back empty (the painter painted something else). */
function fakeTools(opts: { noHead?: boolean; missCharacter?: number; face?: boolean } = {}) {
  let misses = opts.missCharacter ?? 0;
  const blobs = new Map<string, Raster>();
  const stored = new Map<string, Raster>();
  let n = 0;
  const encode = (r: Raster) => {
    const key = `r${n++}`;
    blobs.set(key, r);
    return new TextEncoder().encode(key);
  };
  const get = (png: Uint8Array) => blobs.get(new TextDecoder().decode(png))!;
  const calls: string[] = [];
  const painter: Painter = {
    name: "fake",
    async paint(a) {
      calls.push(`paint ${a.width}x${a.height}`);
      // a quarter of the asked size keeps the test fast; the pipeline works from what it gets
      const w = a.width / 4, h = a.height / 4;
      if (a.positive.includes("solo")) return encode(misses-- > 0 ? raster(w, h, () => null) : character(w, h, opts.face));
      if (a.positive.includes("clock")) return encode(raster(w, h, (x, y) => (Math.hypot(x - w / 2, y - h / 2) < w * 0.3 ? CLOCK : null)));
      return encode(raster(w, h, () => SKY));
    },
    async removeBackground(png) {
      calls.push("cutout");
      const r = get(png);
      return encode(maskWhere(r, (i) => !near(r.data, i, [255, 255, 255])));
    },
    async segment(png, text) {
      calls.push(`segment ${text}`);
      const r = get(png);
      // a subject (the check after painting) is everything drawn; a head is skin; parts aren't in these paintings
      if (text === "girl" || text === "clock") return encode(maskWhere(r, (i) => !near(r.data, i, [255, 255, 255])));
      if (text === "eyes") return encode(maskWhere(r, (i) => near(r.data, i, EYE) || near(r.data, i, SCLERA)));
      if (text === "mouth") return encode(maskWhere(r, (i) => near(r.data, i, MOUTH)));
      if (text === "eyebrows") return encode(maskWhere(r, () => false));
      if (opts.noHead) return encode(maskWhere(r, () => false));
      return encode(maskWhere(r, (i) => near(r.data, i, SKIN) || near(r.data, i, EYE) || near(r.data, i, SCLERA) || near(r.data, i, MOUTH)));
    },
    async inpaint(a) {
      calls.push(`inpaint ${a.denoise}`);
      const r = get(a.image), m = get(a.mask);
      // repaints the masked area: a neck color for the neck, open (skin) eyes for the eyes
      return encode(raster(r.width, r.height, (x, y) => {
        const i = (y * r.width + x) * 4;
        return m.data[i] > 128 ? (a.denoise === 1 ? NECK : SKIN) : [...r.data.subarray(i, i + 3)];
      }));
    },
  };
  const tools: LayeredTools = {
    painter,
    encode,
    decode: async (png) => get(png),
    store(png) {
      const src = `/api/images/${new TextDecoder().decode(png)}.png`;
      stored.set(src, get(png));
      return src;
    },
  };
  return { tools, stored, calls };
}

const provider = (answers: unknown[]): Provider => ({
  name: "mock",
  model: "mock",
  generateJSON: async () => JSON.stringify(answers.shift()),
});

const run = async (opts: Parameters<typeof fakeTools>[0] = {}, plans: unknown[] = [{ ...PLAN, actions: [{ ...PLAN.actions[0], end: 6 }] }]) => {
  const f = fakeTools(opts);
  const events: LayeredEvent[] = [];
  const spec = await generateLayered({ prompt: "A girl is sleeping on a balcony at night. At 3 seconds she wakes up and looks at the clock.", duration: 6, aspect: "16:9" }, provider(plans), f.tools, (e) => events.push(e));
  return { spec, events, ...f };
};

describe("layered generation", () => {
  it("builds separate background, clock and rigged body/head layers with a neck pivot", async () => {
    const { spec, events } = await run();
    const ids = spec.layers.map((l) => l.id);
    expect(ids).toEqual(["balcony_background", "clock", "girl", "girl_body", "girl_head", "girl_head_awake"]);
    const byId = Object.fromEntries(spec.layers.map((l) => [l.id, l]));
    expect(byId.girl_body.parent).toBe("girl");
    expect(byId.girl_head.parent).toBe("girl_body");
    expect(byId.clock.parent).toBeUndefined();
    // the neck pivot sits at the bottom of the head, inside the character's box
    const [px, py] = byId.girl_head.pivot!;
    const head = byId.girl_head.params as { x: number; y: number; w: number; h: number };
    expect(px).toBeGreaterThan(head.x);
    expect(px).toBeLessThan(head.x + head.w);
    expect(py).toBeGreaterThan(head.y + head.h * 0.6);
    // every image layer refers to a stored asset; sources and masks are kept for retries
    expect(Object.keys(spec.assets!)).toEqual(expect.arrayContaining(["girl_source", "girl_mask", "girl_head_mask", "clock_source"]));
    // stages arrive in pipeline order
    const phases = events.flatMap((e) => (e.type === "status" ? [e.phase] : []));
    expect(phases.indexOf("plan")).toBeLessThan(phases.indexOf("background"));
    expect(phases.indexOf("segment")).toBeLessThan(phases.indexOf("reconstruct"));
    expect(phases.at(-1)).toBe("validate");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("the separated head is not left in the body layer, and what it hid is filled (not a hole)", async () => {
    // in this fixture skin exists only in the head
    const { spec, stored } = await run();
    const body = stored.get(spec.assets!.girl_body.src)!;
    const bp = spec.layers.find((l) => l.id === "girl_body")!.params as { x: number; y: number; w: number; h: number };
    const hp = spec.layers.find((l) => l.id === "girl_head")!.params as { x: number; y: number; w: number; h: number };
    let skin = 0, filled = 0;
    for (let y = 0; y < body.height; y++)
      for (let x = 0; x < body.width; x++) {
        const i = (y * body.width + x) * 4;
        if (body.data[i + 3] <= 32) continue;
        if (near(body.data, i, SKIN)) skin++;
        // a body pixel inside the head's area: filled in behind the head
        const sx = bp.x + (x / body.width) * bp.w, sy = bp.y + (y / body.height) * bp.h;
        if (sx > hp.x && sx < hp.x + hp.w && sy > hp.y && sy < hp.y + hp.h) filled++;
      }
    expect(skin).toBe(0);
    expect(filled).toBeGreaterThan(0);
    // and the head layer is the head: skin, nothing of the shirt
    const head = stored.get(spec.assets!.girl_head.src)!;
    let shirt = 0;
    for (let i = 0; i < head.width * head.height * 4; i += 4) if (head.data[i + 3] > 32 && near(head.data, i, SHIRT)) shirt++;
    expect(shirt).toBe(0);
  });

  it("look_at: still until 3s, turns toward the clock by 5s and holds; the eyes open at 3s", async () => {
    const { spec } = await run();
    const look = spec.actions!.find((a) => a.type === "look_at")!;
    const turn = spec.tracks[look.tracks!.rotation!];
    expect(evalTrack(turn, 2.9)).toBe(0);
    expect(evalTrack(turn, 3)).toBe(0);
    expect(evalTrack(turn, 4)).not.toBe(0);
    expect(evalTrack(turn, 5.9)).toBe(evalTrack(turn, 5));
    // the plan stretched the turn to 6s; it still reaches its pose by 5s and holds
    expect(look.end).toBe(5);
    // the clock is up-left of the head: turning toward it is counter-clockwise (negative) in screen space
    expect(evalTrack(turn, 5)).toBeLessThan(0);
    const eyes = spec.tracks.girl_eyes_open;
    expect([evalTrack(eyes, 2.9), evalTrack(eyes, 3.5)]).toEqual([0, 1]);
  });

  it("a painting that doesn't show the subject is repainted once, then fails with the subject named", async () => {
    const once = await run({ missCharacter: 1 });
    expect(once.calls.filter((c) => c.startsWith("segment girl"))).toHaveLength(2);
    expect(once.spec.layers.some((l) => l.id === "girl_head")).toBe(true);
    await expect(run({ missCharacter: 2 })).rejects.toThrow(/didn't paint a girl \(tried twice\)/);
  });

  it("a missing head mask fails with the part named, before any scene is produced", async () => {
    await expect(run({ noHead: true })).rejects.toThrow(/girl's head/);
  });

  it("a plan aimed at an unknown target is sent back with the problem", async () => {
    const bad = { ...PLAN, actions: [{ ...PLAN.actions[0], target: "moon" }] };
    const { spec } = await run({}, [bad, PLAN]);
    expect(spec.actions?.[0].target).toBe("clock");
    expect(planProblems(LayeredPlanSchema.parse(bad), 6).join()).toMatch(/"moon" must be a prop/);
  });

  it("cancelling stops between stages", async () => {
    const f = fakeTools();
    const ac = new AbortController();
    const p = generateLayered({ prompt: "x x x", duration: 6, aspect: "16:9" }, provider([PLAN]), f.tools, (e) => e.type === "plan" && ac.abort(), ac.signal);
    await expect(p).rejects.toThrow();
    expect(f.calls.filter((c) => c.startsWith("inpaint"))).toEqual([]);
  });
});

describe("mask checks", () => {
  const W = 20, H = 20;
  const m = (f: (x: number, y: number) => boolean): Mask => Uint8Array.from({ length: W * H }, (_, i) => (f(i % W, (i / W) | 0) ? 255 : 0));

  it("rejects empty, fully opaque and rectangular parts", () => {
    const img = (f: (x: number, y: number) => boolean): Raster => {
      const data = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) data.set([9, 9, 9, f(i % W, (i / W) | 0) ? 255 : 0], i * 4);
      return { width: W, height: H, data };
    };
    expect(partProblems(img(() => false), "head")).toEqual(["head: the mask is empty"]);
    expect(partProblems(img(() => true), "head")[0]).toMatch(/whole image is opaque/);
    expect(partProblems(img((x, y) => x > 3 && x < 12 && y > 3 && y < 12), "head")[0]).toMatch(/plain rectangle/);
    expect(partProblems(img((x, y) => Math.hypot(x - 10, y - 10) < 6), "head")).toEqual([]);
  });

  it("resizes a mask of the same shape, and rejects empty or misaligned ones", () => {
    const r = (w: number, h: number): Raster => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
    expect(maskFrom(r(10, 10), W, H).length).toBe(W * H);
    expect(() => maskFrom(r(30, 10), W, H)).toThrow(/30×10 but its image is 20×20/);
    expect(() => maskFrom(r(0, 0), W, H)).toThrow(/doesn't line up/);
  });

  it("peels a painted white outline off a part's edge, keeping white inside it and leaving white parts alone", () => {
    const disc = (ring: boolean, body: number[]): Raster => {
      const data = new Uint8ClampedArray(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        const d = Math.hypot((i % W) - 10, ((i / W) | 0) - 10);
        if (d < 6) data.set(i === 10 * W + 10 ? [255, 255, 255, 255] : [...body, 255], i * 4); // a highlight in the middle
        else if (ring && d < 9) data.set([250, 250, 248, 255], i * 4);
      }
      return { width: W, height: H, data };
    };
    const dark = disc(true, [20, 18, 24]);
    const out = peelPale(dark, 4);
    const opaque = (r: Raster) => r.data.filter((_, i) => i % 4 === 3 && r.data[i] > 0).length;
    expect(opaque(out)).toBe(opaque(disc(false, [20, 18, 24])));
    expect(out.data[(10 * W + 10) * 4 + 3]).toBe(255);
    expect(haloShare(out)).toBe(0);
    const cup = disc(true, [240, 238, 232]);
    expect(peelPale(cup, 4)).toBe(cup);
  });

  it("finds the neck where the head meets the body, and none when they don't touch", () => {
    const head = m((x, y) => Math.hypot(x - 10, y - 5) < 4);
    const body = m((x, y) => y >= 9 && x > 5 && x < 15);
    const p = neckPoint(head, body, W, H, 2)!;
    expect(p[1]).toBeGreaterThan(5);
    expect(Math.abs(p[0] - 10)).toBeLessThan(1);
    expect(neckPoint(head, m((x, y) => y > 17), W, H, 2)).toBeNull();
    expect(maskBox(grow(head, W, H, 1), W)).toEqual([6, 1, 15, 10]);
  });

  it("touchesEdge spots a subject cut off by its painting's edge", () => {
    expect(touchesEdge(m((x, y) => Math.hypot(x - 10, y - 10) < 6), W, H)).toBe(false);
    expect(touchesEdge(m((x, y) => y > 8 && x < 12), W, H)).toBe(true);
  });

  it("smear fills a region from the colors around it, ring by ring", () => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set(i % W < 10 ? [200, 0, 0, 255] : [0, 0, 0, 0], i * 4);
    const out = smear({ width: W, height: H, data }, m((x) => x >= 10 && x < 14), m((x) => x < 10));
    expect([...out.r.data.subarray((5 * W + 13) * 4, (5 * W + 13) * 4 + 4)]).toEqual([200, 0, 0, 255]);
    expect(out.r.data[(5 * W + 15) * 4 + 3]).toBe(0);
  });
});

describe("lofi loops", () => {
  const LOFI = {
    ...PLAN,
    characters: [{ ...PLAN.characters[0], pose: "sitting, holding a mug", idle: ["breathe", "bob", "blink"], parts: [{ id: "arm", find: "arm holding the mug", motion: "swing" }] }],
    props: [{ id: "clock", look: "wall clock", box: [0.1, 0.1, 0.2, 0.28], motion: "sway" }],
    ambient: [{ type: "stars" }, { type: "birds" }, { type: "steam", at: "clock" }],
    actions: [{ type: "walk", who: "girl", path: [[0.6, 0.95], [0.8, 0.95]], start: 1, end: 5 }],
  };

  it("idle loops, swaying props, ambient effects and a walk all become seamless keyframes", async () => {
    const { spec, events } = await run({}, [LOFI]);
    const types = Object.fromEntries(spec.actions!.map((a) => [a.id, [a.type, a.part]]));
    expect(types).toMatchObject({ girl_breathes: ["breathe", "girl_body"], girl_bobs: ["bob", "girl_head"], girl_blinks: ["blink", "girl_head_blink"], clock_sways: ["sway", "clock"], girl_walks: ["path", "girl"] });
    // the arm couldn't be found in this painting: it stays on the body and the rest still works
    expect(events.some((e) => e.type === "asset" && e.id === "girl_arm" && e.status === "skipped")).toBe(true);
    // sky effects sit behind the cast, steam rises from the clock in front
    const ids = spec.layers.map((l) => l.id);
    expect(ids.indexOf("stars-1")).toBeLessThan(ids.indexOf("girl"));
    expect(ids.indexOf("birds-1")).toBeLessThan(ids.indexOf("girl"));
    expect(ids.at(-1)).toBe("steam-1");
    // every loop repeats a whole number of times in the 6s scene
    for (const a of spec.actions!.filter((a) => a.type !== "path"))
      for (const name of Object.values(a.tracks!)) {
        const tr = spec.tracks[name];
        expect(tr.loop).toBe(true);
        const cycles = 6 / tr.keys.at(-1)![0];
        expect(Math.abs(cycles - Math.round(cycles))).toBeLessThan(1e-9);
      }
    for (const l of spec.layers.filter((l) => "period" in l.params)) expect(Number.isInteger(6 / (l.params.period as number))).toBe(true);
    // the blink overlay is hidden until the blink shows it
    expect(spec.layers.find((l) => l.id === "girl_head_blink")!.params.opacity).toBe(0);
  });

  it("a head listed as a moving part moves the head piece instead of making a second head", async () => {
    const { spec } = await run({}, [{ ...LOFI, characters: [{ ...LOFI.characters[0], parts: [{ id: "head", find: "head", motion: "sway" }, { id: "body", find: "body", motion: "sway" }] }] }]);
    expect(spec.layers.filter((l) => l.id === "girl_head")).toHaveLength(1);
    expect(spec.actions!.find((a) => a.id === "girl_head_sways")?.part).toBe("girl_head");
  });

  it("a head told to swing with nothing to reach for sways instead of aiming at itself", async () => {
    const { spec } = await run({}, [{ ...LOFI, characters: [{ ...LOFI.characters[0], parts: [{ id: "head", find: "head", motion: "swing" }] }] }]);
    expect(spec.actions!.find((a) => a.part === "girl_head" && (a.type === "swing" || a.type === "sway"))?.type).toBe("sway");
  });

  it("steam without a prop to rise from is sent back", () => {
    const bad = LayeredPlanSchema.parse({ ...LOFI, ambient: [{ type: "steam" }] });
    expect(planProblems(bad, 6).join()).toMatch(/steam needs "at"/);
  });
});

describe("production artwork (M8)", () => {
  it("every cut-out records its source, mask, crop, cleanup and a checklist, and reconstruction is reported", async () => {
    const { spec } = await run();
    const a = spec.assets!;
    for (const id of ["girl_body", "girl_head", "clock"]) {
      expect(a[id].mask && a[a[id].mask!].kind).toBe("mask");
      expect(a[a[id].from!]).toBeDefined();
      expect(a[id].crop).toHaveLength(4);
      expect(a[id].cleanup).toBeDefined();
      expect(a[id].checks!.find((c) => c.name === "cutout")?.status).toBe("pass");
    }
    expect(a.girl_body.from).toBe("girl_body_fill");
    expect(a.girl_body_fill.kind).toBe("source");
    expect(a.girl_body.checks!.map((c) => c.name)).toEqual(expect.arrayContaining(["reconstruction", "identity"]));
    expect(a.girl_head.checks!.find((c) => c.name === "joint")?.status).toBe("pass");
    // review is set exactly when a check isn't a pass
    for (const x of Object.values(a)) if (x.checks) expect(!!x.review).toBe(x.checks.some((c) => c.status !== "pass"));
  });

  it("saves a character profile, and a second generation keeps it and paints with its look and seed", async () => {
    const first = await run();
    const profile = first.spec.characters!.girl;
    expect(profile.look).toBe("girl, hoodie");
    expect(first.spec.assets![profile.reference!].src).toBe(first.spec.assets!.girl_source.src);
    expect(Object.keys(profile.palette).length).toBeGreaterThan(0);
    expect(profile.proportions!.head).toBeGreaterThan(0);

    const kept = { ...profile, look: "girl, red hoodie, short hair", notes: "keep the scarf" };
    const f = fakeTools();
    const seeds: number[] = [];
    const paint = f.tools.painter.paint;
    f.tools.painter.paint = (args) => (args.positive.includes("solo") && seeds.push(args.seed), paint(args));
    const plan = { ...PLAN, actions: [{ ...PLAN.actions[0], end: 6 }], characters: [{ ...PLAN.characters[0], look: "a different girl" }] };
    let asked = "";
    const p: Provider = { name: "mock", model: "mock", generateJSON: async (a) => ((asked = a.user), JSON.stringify(plan)) };
    const refs = { [profile.reference!]: first.spec.assets![profile.reference!] };
    const spec = await generateLayered({ prompt: "the girl again", duration: 6, aspect: "16:9", characters: { girl: kept }, assets: refs }, p, f.tools, () => {});
    expect(asked).toContain("girl: girl, red hoodie, short hair");
    expect(seeds[0]).toBe(profile.seed);
    expect(f.calls.some((c) => c.startsWith("paint"))).toBe(true);
    expect(spec.characters!.girl).toEqual({ ...kept, reference: "girl_reference" });
    expect(spec.assets!.girl_reference.src).toBe(first.spec.assets!.girl_source.src);
    expect(spec.assets!.girl_body.checks!.find((c) => c.name === "identity")).toMatchObject({ status: "pass" });
  });

  it("flags a reused character whose colors drifted from the saved profile", async () => {
    const first = await run();
    const profile = { ...first.spec.characters!.girl, palette: { c1: "#00ff00", c2: "#0000ff" } };
    const f = fakeTools();
    const spec = await generateLayered({ prompt: "again", duration: 6, aspect: "16:9", characters: { girl: profile } }, provider([{ ...PLAN, actions: [{ ...PLAN.actions[0], end: 6 }] }]), f.tools, () => {});
    expect(spec.assets!.girl_body.checks!.find((c) => c.name === "identity")?.status).toBe("review");
    expect(spec.assets!.girl_body.review).toMatch(/differ from the saved girl profile/);
    // no reference asset was passed, so the profile keeps none rather than pointing at nothing
    expect(spec.characters!.girl.reference).toBeUndefined();
  });
});

describe("mask cleanup and recut", () => {
  const W = 40, H = 40;
  const square = (x0: number, y0: number, x1: number, y1: number, m = new Uint8Array(W * H)) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 255;
    return m;
  };
  const on = (m: Mask) => m.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0);

  it("fills small enclosed holes but not big ones or gaps open to the edge", () => {
    const m = square(5, 5, 35, 35);
    for (const i of [20 * W + 20, 20 * W + 21]) m[i] = 0; // pinhole
    for (let y = 10; y < 20; y++) for (let x = 8; x < 18; x++) m[y * W + x] = 0; // big hole (100 px)
    const out = fillHoles(m, W, H, 10);
    expect(out[20 * W + 20]).toBe(255);
    expect(out[12 * W + 10]).toBe(0);
    expect(out[0]).toBe(0);
  });

  it("drops small specks, keeps the biggest island, and shrink undoes grow on a square", () => {
    const m = square(5, 5, 25, 25);
    m[38 * W + 38] = 255;
    const out = despeckle(m, W, 4);
    expect(out[38 * W + 38]).toBe(0);
    expect(on(out)).toBe(400);
    expect(on(despeckle(square(0, 0, 2, 1), W, 100))).toBe(2);
    expect(on(shrink(grow(square(10, 10, 20, 20), W, H, 2), W, H, 2))).toBe(100);
    expect(on(cleanMask(square(10, 10, 20, 20), W, H, { grow: -1 }))).toBe(64);
  });

  it("feather only lowers alpha at the edge", () => {
    const r: Raster = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    square(10, 10, 30, 30).forEach((v, i) => r.data.set([200, 50, 50, v], i * 4));
    const f = feather(r, 2);
    expect(f.data[(20 * W + 20) * 4 + 3]).toBe(255);
    expect(f.data[(10 * W + 20) * 4 + 3]).toBeLessThan(255);
    expect(f.data[(5 * W + 5) * 4 + 3]).toBe(0);
  });

  it("recut crops to the cleaned mask and fails a rectangular cut-out instead of passing it", () => {
    const src: Raster = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) };
    const disc = new Uint8Array(W * H).map((_, i) => (Math.hypot((i % W) - 20, ((i / W) | 0) - 20) < 8 ? 255 : 0));
    const ok = recut(src, disc, { grow: 2 }, "disc");
    expect(ok.crop).toEqual([11, 11, 30, 30]); // disc spans 13..27, grown by 2
    expect(ok.checks.find((c) => c.name === "cutout")?.status).toBe("pass");
    const box = recut(src, square(5, 5, 30, 30), {}, "box");
    expect(box.checks.find((c) => c.name === "cutout")).toMatchObject({ status: "fail", note: expect.stringMatching(/opaque|rectangle/) });
    expect(reviewOf(box.checks)).toMatch(/opaque|rectangle/);
    expect(() => recut(src, new Uint8Array(W * H), {}, "nothing")).toThrow(/empty/);
  });

  it("palette finds the main colors and measures drift", () => {
    const r: Raster = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
    for (let i = 0; i < 100; i++) r.data.set(i < 70 ? [200, 60, 110, 255] : [240, 200, 170, 255], i * 4);
    expect(palette(r)).toEqual(["#c83c6e", "#f0c8aa"]);
    expect(paletteDrift(["#c83c6e"], palette(r))).toBe(0);
    expect(paletteDrift(["#00ff00"], palette(r))).toBeGreaterThan(60);
  });
});

describe("faces, gaze and turns (M10)", () => {
  const facePlan = {
    ...PLAN,
    characters: [{ ...PLAN.characters[0], pose: "sitting", expressions: ["happy", "sad"] }],
    actions: [
      { type: "look_at", who: "girl", target: "clock", start: 3, end: 5 },
      { type: "expression", who: "girl", expression: "happy", start: 4 },
    ],
  };
  const gen = async () => {
    const f = fakeTools({ face: true });
    const events: LayeredEvent[] = [];
    const spec = await generateLayered({ prompt: "she smiles at the clock", duration: 6, aspect: "16:9" }, provider([facePlan]), f.tools, (e) => events.push(e));
    return { spec, events, ...f };
  };

  it("lifts the irises out of the eye whites and has the eyes lead the head turn", async () => {
    const { spec, stored } = await gen();
    const irises = spec.layers.find((l) => l.id === "girl_irises")!;
    expect(irises.parent).toBe("girl_head");
    expect(spec.assets!.girl_head.from).toBe("girl_head_fill");
    // the head picture no longer has iris pixels: they were filled with eye white
    const head = stored.get(spec.assets!.girl_head.src)!;
    let dark = 0;
    for (let i = 0; i < head.width * head.height * 4; i += 4) if (head.data[i + 3] > 200 && near(head.data, i, EYE)) dark++;
    expect(dark).toBe(0);
    const gaze = spec.actions!.find((a) => a.type === "gaze")!;
    expect(gaze).toMatchObject({ part: "girl_irises", target: "clock", start: 3 });
    expect(gaze.end).toBeLessThan(spec.actions!.find((a) => a.type === "look_at")!.end!);
  });

  it("paints the expressions' mouths as switched overlays, keys the planned expression, and skips art it can't find", async () => {
    const { spec, events } = await gen();
    const mouth = spec.switches!.find((w) => w.id === "girl_mouth")!;
    expect(mouth.options).toEqual({ neutral: null, smile: "girl_mouth_smile", frown: "girl_mouth_frown" });
    expect(mouth.keys).toEqual([[0, "neutral"], [4, "smile"]]);
    expect(spec.layers.find((l) => l.id === "girl_mouth_smile")?.parent).toBe("girl_head");
    expect(events.some((e) => e.type === "asset" && e.id === "girl_brows" && e.status === "skipped")).toBe(true);
    // small face parts aren't flagged for their size
    expect(spec.assets!.girl_mouth_smile.checks!.find((c) => c.name === "coverage")?.status).toBe("pass");
  });

  it("flags a head turn past what a flat head can do", async () => {
    const { spec } = await gen();
    expect(spec.assets!.girl_head.checks!.find((c) => c.name === "turn")).toMatchObject({ status: "review" });
  });

  it("an expression the character wasn't painted with is sent back to the planner", () => {
    const bad = LayeredPlanSchema.parse({ ...facePlan, actions: [{ type: "expression", who: "girl", expression: "surprised", start: 1 }] });
    expect(planProblems(bad, 6).join()).toMatch(/add "surprised" to girl.expressions/);
  });
});
