import { describe, expect, it } from "vitest";
import { generateAgent, type LayeredTools, type Painter, type Provider, type Raster } from "../src";

const SKY = [30, 40, 70],
  SKIN = [240, 200, 170],
  SHIRT = [200, 60, 110],
  EYE = [20, 20, 30],
  LAMP = [250, 200, 80];
const near = (d: Uint8ClampedArray, i: number, c: number[]) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) < 12;
function raster(w: number, h: number, at: (x: number, y: number) => number[] | null, bg = SKY): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...(at(x, y) ?? bg), 255], (y * w + x) * 4);
  return { width: w, height: h, data };
}
/** The whole scene: a girl (head with eyes over a shirt) and a lantern, on sky. */
const scene = (w: number, h: number) =>
  raster(w, h, (x, y) => {
    const hx = w * 0.4,
      hy = h * 0.4,
      hr = h * 0.1;
    if (Math.hypot(x - hx, y - hy) < hr) return Math.abs(y - hy) < hr * 0.12 && Math.abs(Math.abs(x - hx) - hr * 0.4) < hr * 0.15 ? EYE : SKIN;
    if (((x - hx) / (w * 0.08)) ** 2 + ((y - h * 0.65) / (h * 0.2)) ** 2 < 1) return SHIRT;
    if (Math.hypot(x - w * 0.8, y - h * 0.25) < h * 0.06) return LAMP;
    return null;
  });

function fakeTools() {
  const blobs = new Map<string, Raster>();
  let n = 0;
  const encode = (r: Raster) => (blobs.set(`r${n}`, r), new TextEncoder().encode(`r${n++}`));
  const get = (png: Uint8Array) => blobs.get(new TextDecoder().decode(png))!;
  const where = (r: Raster, pick: (i: number) => boolean) => raster(r.width, r.height, (x, y) => (pick((y * r.width + x) * 4) ? [255, 255, 255] : null), [0, 0, 0]);
  const calls: string[] = [];
  const painter: Painter = {
    name: "fake",
    paint: async (a) => encode(scene(a.width / 4, a.height / 4)),
    async segment(png, text) {
      calls.push(`segment ${text}`);
      const r = get(png);
      const pick =
        {
          girl: [SKIN, SHIRT, EYE],
          "girl head": [SKIN, EYE],
          "girl eyes": [EYE],
          lantern: [LAMP],
        }[text] ?? [];
      return encode(where(r, (i) => pick.some((c) => near(r.data, i, c))));
    },
    async inpaint(a) {
      calls.push(`inpaint ${a.denoise}`);
      const r = get(a.image),
        m = get(a.mask);
      // the background repaint fills with sky; the eye repaint with skin (closed eyes)
      return encode(
        raster(r.width, r.height, (x, y) => {
          const i = (y * r.width + x) * 4;
          return m.data[i] > 128 ? (a.denoise === 1 ? SKY : SKIN) : [...r.data.subarray(i, i + 3)];
        }),
      );
    },
  };
  const tools: LayeredTools = {
    painter,
    encode,
    decode: async (png) => get(png),
    store: (png) => `/api/images/${new TextDecoder().decode(png)}.png`,
  };
  return { tools, calls };
}

const READ = {
  title: "lantern night",
  beats: [{ at: 0, label: "Calm" }],
  environment: "night sky",
  objects: [
    {
      id: "girl",
      find: "girl",
      kind: "character",
      idle: ["breathe", "blink", "bob"],
    },
    { id: "lamp", find: "paper lamp", kind: "prop", motion: "sway" },
  ],
};

describe("image-first agent", () => {
  it("sends what the segmenter couldn't find back to the model, then cuts and rigs what is there", async () => {
    const f = fakeTools();
    const asked: string[] = [];
    const answers = [
      READ,
      {
        ...READ,
        objects: [READ.objects[0], { ...READ.objects[1], find: "lantern" }],
      },
    ];
    const provider: Provider = {
      name: "mock",
      model: "mock",
      vision: true,
      generateJSON: async (a) => (asked.push(a.user), expect(a.image).toMatch(/^data:image\/png;base64,/), JSON.stringify(answers.shift())),
    };
    const events: { type: string; text?: string }[] = [];
    const spec = await generateAgent(
      {
        prompt: "a girl under a paper lantern at night",
        duration: 6,
        aspect: "16:9",
      },
      provider,
      f.tools,
      (e) => events.push(e),
    );

    // the second look was told what was missing
    expect(asked[1]).toMatch(/lamp \("paper lamp"\)/);
    expect(events.some((e) => e.type === "thought" && /Couldn't find lamp/.test(e.text ?? ""))).toBe(true);
    const ids = spec.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["background", "girl", "girl_body", "girl_head", "girl_head_blink", "lamp"]));
    // the background was repainted once and checked empty
    expect(f.calls.filter((c) => c === "inpaint 1")).toHaveLength(1);
    expect(spec.assets!.background.checks![0].status).toBe("pass");
    // the head rides on the body; the lamp sways about its top
    expect(spec.layers.find((l) => l.id === "girl_head")!.parent).toBe("girl_body");
    expect(spec.layers.find((l) => l.id === "lamp")!.pivot).toBeDefined();
    expect(Object.keys(spec.tracks).length).toBeGreaterThan(0);
  });

  it("fails with a fix when nothing named is in the painting", async () => {
    const f = fakeTools();
    const bad = {
      ...READ,
      objects: [{ id: "dog", find: "dog", kind: "character" }],
    };
    const provider: Provider = {
      name: "mock",
      model: "mock",
      generateJSON: async () => JSON.stringify(bad),
    };
    await expect(generateAgent({ prompt: "a dog", duration: 6, aspect: "16:9" }, provider, f.tools, () => {})).rejects.toThrow(/Nothing the model named/);
  });
});
