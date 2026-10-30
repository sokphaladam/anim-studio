import { ENGINE_FONTS, createRenderer } from "@anim/engine";
import { useEffect, useRef } from "react";
import { EXAMPLES } from "../store/scenes";

declare global {
  interface Window {
    renderFrame?: (t: number) => void;
    renderReady?: boolean;
  }
}

/** Bare full-size canvas for the exporter: /render/:id?w=1920&h=1080 exposes window.renderFrame(t). */
export function RenderOnly({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const q = new URLSearchParams(location.search);
  const w = Number(q.get("w")) || 1920, h = Number(q.get("h")) || 1080;
  const ex = EXAMPLES.find((e) => e.id === id);
  useEffect(() => {
    if (!ex || !ref.current) return;
    const r = createRenderer(ref.current, ex.load());
    window.renderFrame = (t) => r.render(t);
    r.render(0);
    // shortcut: only bundled examples until projects are stored in Milestone 4
    Promise.allSettled(ENGINE_FONTS.map((f) => document.fonts.load(f))).then(() => {
      r.render(0);
      window.renderReady = true;
    });
  }, [ex]);
  if (!ex) return <p className="p-4 text-danger">Unknown scene "{id}"</p>;
  return <canvas ref={ref} width={w} height={h} style={{ display: "block", width: w, height: h }} />;
}
