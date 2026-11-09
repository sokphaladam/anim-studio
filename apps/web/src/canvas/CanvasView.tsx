import { ENGINE_FONTS, apply, createRenderer, invert, layerMatrix, type Renderer } from "@anim/engine";
import { loadSpecImages } from "../components/images";
import type { SceneSpec } from "@anim/spec";
import { useToast } from "@anim/ui";
import { useEffect, useRef, useState } from "react";
import { frameOf, useStudio, type Tool } from "../store";
import { bbox, findLayer, heldIndexAt, newDrawingLayer, strokePoints } from "../store/edit";
import { drawRig } from "./rigOverlay";
import { overlayKey } from "../store/scenes";
import { brushTool, eraserTool, eyedropperTool, fillTool } from "../tools/paint";
import { dashedPath, selectTool } from "../tools/select";
import { shapesTool } from "../tools/shapes";
import { transformTool } from "../tools/transform";
import type { Pt, ToolContext, ToolController } from "../tools/types";

const TOOLS: Record<Tool, ToolController> = { brush: brushTool, eraser: eraserTool, fill: fillTool, shapes: shapesTool, transform: transformTool, select: selectTool, eyedropper: eyedropperTool };

/** Spec with hidden rows removed (visibility is editor state, not part of the scene). Hiding a rig parent hides its parts. */
export function visibleSpec(spec: SceneSpec, hidden: Record<string, boolean>): SceneSpec {
  const parent = new Map(spec.layers.map((l) => [l.id, l.parent]));
  const shown = (id: string | undefined, n = 0): boolean => id === undefined || n > spec.layers.length || (!hidden[id] && shown(parent.get(id), n + 1));
  return { ...spec, layers: spec.layers.filter((l) => shown(l.id)), overlays: spec.overlays.filter((_, i) => !hidden[overlayKey(i)]) };
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** Center canvas: plays the spec, routes pointer input to the current tool, and handles view gestures (Space-drag pan, Ctrl+wheel zoom, Shift+Space-drag rotate). */
export function CanvasView() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const hover = useRef<Pt | null>(null);
  const toolDown = useRef(false);
  const spec = useStudio((s) => s.spec);
  const hidden = useStudio((s) => s.hidden);
  const view = useStudio((s) => s.view);
  const tool = useStudio((s) => s.tool);
  const toast = useToast();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; mode: "pan" | "rotate" } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = spec?.meta.width ?? 16, H = spec?.meta.height ?? 9;
  const pad = 24;
  const fit = Math.max(0.01, Math.min((box.w - pad * 2) / W, (box.h - pad * 2) / H));
  const cssW = Math.round(W * fit), cssH = Math.round(H * fit);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  // read by store subscriptions and pointer handlers, which must see the current size, not the one at subscribe time
  const size = useRef({ cssW, cssH });
  useEffect(() => {
    size.current = { cssW, cssH };
  }, [cssW, cssH]);

  // --- coordinate mapping (screen → scene → layer) ---
  const sceneAt = (clientX: number, clientY: number): Pt => {
    const r = wrap.current!.getBoundingClientRect();
    const { view: v, spec: sp } = useStudio.getState();
    const dx = clientX - (r.left + r.width / 2 + v.panX), dy = clientY - (r.top + r.height / 2 + v.panY);
    const a = (-v.rotation * Math.PI) / 180;
    const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / v.zoom, ly = (dx * Math.sin(a) + dy * Math.cos(a)) / v.zoom;
    const { cssW, cssH } = size.current;
    const k = sp!.meta.width / cssW;
    return [(lx + cssW / 2) * k, (ly + cssH / 2) * k];
  };

  const context = (scene: Pt | null): (Omit<ToolContext, "scene"> & { scene: Pt | null }) | null => {
    const s = useStudio.getState();
    const sp = s.spec;
    if (!sp) return null;
    const frame = frameOf(s.t, sp), time = frame / sp.meta.fps;
    const m = (id: string) => layerMatrix(sp, findLayer(sp, id), time);
    return {
      spec: sp,
      frame,
      time,
      scene,
      sceneAt: (e) => sceneAt(e.clientX, e.clientY),
      toLayer: (id, p) => apply(invert(m(id)), ...p),
      fromLayer: (id, p) => apply(m(id), ...p),
      unitsPerPx: sp.meta.width / size.current.cssW / s.view.zoom,
      toast: (title, description) => toast({ title, description, tone: "warning" }),
      drawingTarget() {
        const st = useStudio.getState();
        let l = findLayer(st.spec!, st.selected);
        if (!l || l.type !== "drawing") {
          // painting with no drawing layer selected makes one, like starting a new sheet
          const r = newDrawingLayer(st.spec!, st.selected);
          st.commit("New drawing layer", r.spec);
          st.set({ selected: r.id });
          l = findLayer(r.spec, r.id)!;
        }
        if (st.locked[l.id]) {
          toast({ title: "Layer is locked", description: "Unlock it in the Layers docker to draw on it.", tone: "warning" });
          return null;
        }
        if (st.hidden[l.id]) {
          toast({ title: "Layer is hidden", description: "Show it in the Layers docker to draw on it.", tone: "warning" });
          return null;
        }
        return l.id;
      },
      pickColor() {
        const c = canvas.current;
        if (!c || !scene) return null;
        const k = c.width / sp.meta.width;
        const d = c.getContext("2d")!.getImageData(Math.floor(scene[0] * k), Math.floor(scene[1] * k), 1, 1).data;
        return toHex(d[0], d[1], d[2]);
      },
    };
  };

  // --- rendering ---
  const renderMain = () => {
    const s = useStudio.getState();
    if (!renderer.current || !s.spec) return;
    // show exactly what export will show: time snapped to the frame grid
    const t = frameOf(s.t, s.spec) / s.spec.meta.fps;
    const onion = s.onion.on && !s.playing ? { before: s.onion.before, after: s.onion.after, opacity: s.onion.opacity, beforeColor: cssVar("--onion-before"), afterColor: cssVar("--onion-after") } : undefined;
    renderer.current.render(t, { onion });
  };

  const drawOverlay = () => {
    const o = overlay.current, s = useStudio.getState();
    if (!o || !s.spec) return;
    const g = o.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, o.width, o.height);
    if (s.playing) return;
    const k = o.width / s.spec.meta.width;
    g.setTransform(k, 0, 0, k, 0, 0);
    const c = context(hover.current);
    if (!c) return;
    // selection outline (the transform tool draws its own handles)
    const sel = s.selection;
    const l = sel && findLayer(s.spec, sel.layer);
    if (sel && l && s.tool !== "transform" && heldIndexAt(s.spec, l, c.frame) === sel.frame) {
      const strokes = l.frames![sel.frame].strokes;
      const b = bbox(sel.indices.flatMap((i) => (strokes[i] ? strokePoints(strokes[i]) : [])));
      if (b) dashedPath(g, ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] as Pt[]).map((p) => c.fromLayer(l.id, p)), c.unitsPerPx);
    }
    drawRig(g, c, s.spec, s.selected, s.hidden);
    if (!drag.current) TOOLS[s.tool].overlay(g, c);
  };

  useEffect(() => {
    if (!canvas.current || !spec) return;
    const vs = visibleSpec(spec, hidden);
    if (!renderer.current) renderer.current = createRenderer(canvas.current, vs);
    else renderer.current.setSpec(vs);
    renderMain();
    loadSpecImages(vs).then(renderMain);
    drawOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderMain/drawOverlay read fresh state from the store
  }, [spec, hidden, cssW, cssH]);

  useEffect(() => {
    const unsub = useStudio.subscribe((s, p) => {
      if (s.t !== p.t || s.onion !== p.onion || s.playing !== p.playing) renderMain();
      if (s.t !== p.t || s.selection !== p.selection || s.tool !== p.tool || s.playing !== p.playing || s.brush !== p.brush || s.eraserSize !== p.eraserSize || s.spec !== p.spec || s.selected !== p.selected) drawOverlay();
    });
    Promise.allSettled(ENGINE_FONTS.map((f) => document.fonts.load(f))).then(renderMain);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof Element && e.target.closest("input,textarea,button,[role=slider],[role=menuitem]"))) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
    };
  }, []);

  // native listener so preventDefault works on wheel (React's is passive)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { view, set } = useStudio.getState();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
      const zoom = Math.min(16, Math.max(0.1, view.zoom * Math.exp(-e.deltaY * 0.002)));
      const k = zoom / view.zoom;
      // keep the point under the cursor fixed
      set({ view: { ...view, zoom, panX: cx - (cx - view.panX) * k, panY: cy - (cy - view.panY) * k } });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const canvasStyle = {
    width: cssW,
    height: cssH,
    transform: `translate(-50%, -50%) translate(${view.panX}px, ${view.panY}px) rotate(${view.rotation}deg) scale(${view.zoom})`,
  };

  return (
    <div
      ref={wrap}
      data-testid="canvas-area"
      className="relative h-full w-full touch-none overflow-hidden bg-surround select-none"
      style={{ cursor: dragging ? "grabbing" : space ? "grab" : (TOOLS[tool].cursor ?? "default") }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        if (space || e.button === 1) {
          drag.current = { x: e.clientX, y: e.clientY, mode: e.shiftKey ? "rotate" : "pan" };
          setDragging(true);
          return;
        }
        if (e.button !== 0) return;
        const s = useStudio.getState();
        if (s.playing) s.set({ playing: false });
        const c = context(sceneAt(e.clientX, e.clientY));
        if (!c) return;
        toolDown.current = true;
        TOOLS[s.tool].down(e.nativeEvent, c as ToolContext);
        drawOverlay();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) {
          const { view, set } = useStudio.getState();
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          d.x = e.clientX;
          d.y = e.clientY;
          set({ view: d.mode === "rotate" ? { ...view, rotation: view.rotation + dx * 0.4 } : { ...view, panX: view.panX + dx, panY: view.panY + dy } });
          return;
        }
        if (!useStudio.getState().spec) return;
        hover.current = sceneAt(e.clientX, e.clientY);
        if (toolDown.current) {
          const c = context(hover.current);
          if (c) TOOLS[useStudio.getState().tool].move(e.nativeEvent, c as ToolContext);
        }
        drawOverlay();
      }}
      onPointerUp={(e) => {
        if (drag.current) {
          drag.current = null;
          setDragging(false);
          return;
        }
        if (!toolDown.current) return;
        toolDown.current = false;
        const c = context(sceneAt(e.clientX, e.clientY));
        if (c) TOOLS[useStudio.getState().tool].up(e.nativeEvent, c as ToolContext);
        drawOverlay();
      }}
      onPointerLeave={() => {
        hover.current = null;
        drawOverlay();
      }}
    >
      {spec && (
        <>
          <canvas ref={canvas} width={Math.round(cssW * dpr)} height={Math.round(cssH * dpr)} aria-label={`Scene canvas: ${spec.meta.title}`} role="img" className="absolute top-1/2 left-1/2" style={canvasStyle} />
          <canvas ref={overlay} width={Math.round(cssW * dpr)} height={Math.round(cssH * dpr)} aria-hidden className="pointer-events-none absolute top-1/2 left-1/2" style={canvasStyle} />
        </>
      )}
    </div>
  );
}
