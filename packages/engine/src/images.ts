/** A loaded bitmap: an HTMLImageElement, ImageBitmap or a node canvas Image. */
export type Bitmap = { width: number; height: number };

// Images are loaded by the host (browser, exporter, tests) before rendering; draw() stays synchronous and deterministic.
const images = new Map<string, Bitmap>();

type Factory = (w: number, h: number) => { width: number; height: number; getContext(type: "2d"): unknown };
let factory: Factory | null = null;
/** The renderer's canvas factory, for objects that need scratch surfaces (painting motion masks). */
export const setCanvasFactory = (f: Factory) => void (factory = f);
export const makeCanvas = (w: number, h: number) => {
  if (!factory) throw new Error("No canvas factory: create a renderer first");
  return factory(w, h);
};

export const registerImage = (src: string, img: Bitmap) => void images.set(src, img);
export const getImage = (src: string) => images.get(src);

/** URL of frame i (0-based) of footage stored as <frames>001.jpg, <frames>002.jpg, … */
export const frameUrl = (frames: string, i: number) => `${frames}${String(i + 1).padStart(3, "0")}.jpg`;

/** Every image a scene refers to (paintings, footage frames and image-layer assets), so hosts know what to load before rendering. */
export function imageSources(spec: { layers: { type: string; params: Record<string, unknown> }[]; assets?: Record<string, { src: string }> }): string[] {
  return spec.layers.flatMap((l) => {
    if (l.type === "image" && typeof l.params.asset === "string") {
      const a = spec.assets?.[l.params.asset];
      return a ? [a.src] : [];
    }
    if (l.type === "painting" && typeof l.params.src === "string") return [l.params.src];
    if (l.type === "footage" && typeof l.params.frames === "string" && typeof l.params.count === "number")
      return Array.from({ length: l.params.count }, (_, i) => frameUrl(l.params.frames as string, i));
    return [];
  });
}
