import { ENGINE_FONTS, createRenderer } from "@anim/engine";
import type { SceneSpec } from "@anim/spec";
import { useEffect, useRef } from "react";

/** Thumbnail at the scene's midpoint; plays while hovered or focused. */
export function SceneThumb({ spec, playing }: { spec: SceneSpec; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const r = createRenderer(ref.current!, spec);
    const mid = spec.meta.duration / 2;
    r.render(mid);
    Promise.allSettled(ENGINE_FONTS.map((f) => document.fonts.load(f))).then(() => !playing && r.render(mid));
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      r.render((mid + (now - start) / 1000) % spec.meta.duration);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spec, playing]);
  const w = 480;
  return <canvas ref={ref} width={w} height={Math.round((w * spec.meta.height) / spec.meta.width)} className="block h-full w-full object-contain" aria-hidden />;
}
