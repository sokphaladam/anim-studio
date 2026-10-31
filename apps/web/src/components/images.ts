import { getImage, imageSources, registerImage } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";

const loading = new Map<string, Promise<void>>();

/** Loads every painting a scene uses into the engine; resolves when all are ready (failures just stay blank). */
export function loadSpecImages(spec: SceneSpec): Promise<void> {
  const todo = imageSources(spec).filter((src) => !getImage(src));
  return Promise.all(
    todo.map((src) => {
      let p = loading.get(src);
      if (!p) {
        const img = new Image();
        img.src = src;
        p = img.decode().then(
          () => registerImage(src, img),
          () => void loading.delete(src), // retry on the next call
        );
        loading.set(src, p);
      }
      return p;
    }),
  ).then(() => {});
}
