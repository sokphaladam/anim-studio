import { collectRefs, type SceneSpec } from "@anim/spec";
import { Button, Dropdown, EmptyState, IconButton, NumberField, Toggle, cx, useToast } from "@anim/ui";
import { Brush, ChevronDown, Copy, Film, Flag, Layers2, SquareStack, Pause, Play, Plus, Repeat, Sparkles, SkipBack, SkipForward, StepBack, StepForward, Trash2, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { frameCount, frameOf, useStudio } from "../store";
import { findLayer, frameNo, moveFrame, setFps } from "../store/edit";
import { overlayKey } from "../store/scenes";
import { changeDuration, frameAction } from "../workspace/frameActions";

const ICON = { size: 16, strokeWidth: 1.5 } as const;

/** MM:SS:FF */
export function timecode(t: number, fps: number) {
  const f = Math.round(t * fps);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(f / fps / 60))}:${p(Math.floor(f / fps) % 60)}:${p(f % fps)}`;
}

export type Row = {
  key: string;
  label: string;
  type: string;
  overlay: boolean;
  /** Frames where a referenced track has a key (diamonds). */
  keyframes: number[];
  /** Drawing frames: start frame and whether it has strokes. */
  drawn: { frame: number; empty: boolean }[];
  /** The layer/overlay object itself (identity is used to tell whether the AI-made row was edited). */
  source: unknown;
};

/** AI-made and not edited since. */
export const isAIRow = (r: Row, marks: Record<string, unknown>) => marks[r.key] === r.source;

/** Timeline/layers rows, top of the stack first. */
export function rowsOf(spec: SceneSpec): Row[] {
  const fps = spec.meta.fps;
  const n = frameCount(spec);
  const keysFor = (value: unknown, params: Record<string, unknown>) => {
    const frames = new Set<number>();
    for (const { ref } of collectRefs(value)) if (ref[0] === "@") spec.tracks[ref.slice(1)]?.keys.forEach(([t]) => frames.add(Math.round(t * fps)));
    for (const k of ["start", "end"]) if (typeof params[k] === "number") frames.add(Math.round((params[k] as number) * fps));
    return [...frames].filter((f) => f < n).sort((a, b) => a - b);
  };
  return [
    ...spec.overlays.map((o, i) => ({ key: overlayKey(i), label: o.id ?? o.type, type: o.type, overlay: true, keyframes: keysFor(o.params, o.params), drawn: [], source: o })).reverse(),
    ...spec.layers
      .map((l) => ({
        key: l.id,
        label: l.id,
        type: l.type,
        overlay: false,
        // a layer's own keys plus those of the actions that move it (a loop shows its first cycle)
        keyframes: keysFor([l.params, l.transform, (spec.actions ?? []).filter((a) => a.part === l.id).flatMap((a) => Object.values(a.tracks ?? {}).map((n) => `@${n}`))], l.params),
        drawn: (l.frames ?? []).map((f) => ({ frame: frameNo(spec, f.start), empty: f.strokes.length === 0 })).filter((d) => d.frame < n),
        source: l,
      }))
      .reverse(),
  ];
}

function Transport({ spec }: { spec: SceneSpec }) {
  const toast = useToast();
  const { playing, loop, togglePlay, step, set, commit, autoFrame, onion, range } = useStudio(
    useShallow((s) => ({ playing: s.playing, loop: s.loop, togglePlay: s.togglePlay, step: s.step, set: s.set, commit: s.commit, autoFrame: s.autoFrame, onion: s.onion, range: s.range })),
  );
  const last = frameCount(spec) - 1;
  const r = range ?? { start: 0, end: last };
  const pick = (label: string, values: number[], cur: number, fmt: (v: number) => string, apply: (v: number) => void) =>
    values.map((v) => ({ id: `${label}${v}`, label: `${label}: ${fmt(v)}`, checked: cur === v, run: () => apply(v) }));
  return (
    // @container: the clock drops its secondary readouts when the timeline is narrow (small screens, display scaling)
    <div className="@container flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2">
      <IconButton label="First frame" shortcut="Home" icon={<SkipBack {...ICON} />} onClick={() => set({ t: r.start / spec.meta.fps, playing: false })} />
      <IconButton label="Previous frame" shortcut="," icon={<StepBack {...ICON} />} onClick={() => step(-1)} />
      <IconButton label={playing ? "Pause" : "Play"} shortcut="Enter" active={playing} icon={playing ? <Pause {...ICON} /> : <Play {...ICON} />} onClick={togglePlay} />
      <IconButton label="Next frame" shortcut="." icon={<StepForward {...ICON} />} onClick={() => step(1)} />
      <IconButton label="Last frame" shortcut="End" icon={<SkipForward {...ICON} />} onClick={() => set({ t: r.end / spec.meta.fps, playing: false })} />
      <Clock spec={spec} />
      <div className="mx-2 h-5 w-px shrink-0 bg-line" />
      <IconButton label="Insert blank frame" shortcut="Shift+N" icon={<Plus {...ICON} />} onClick={() => frameAction("insert", toast)} />
      <IconButton label="Duplicate frame" shortcut="Shift+D" icon={<Copy {...ICON} />} onClick={() => frameAction("duplicate", toast)} />
      <IconButton label="Delete frame" shortcut="Shift+Delete" icon={<Trash2 {...ICON} />} onClick={() => frameAction("delete", toast)} />
      <Toggle pressed={autoFrame} onPressedChange={(v) => set({ autoFrame: v })} label="Auto-frame: drawing on an empty frame starts a new drawing" icon={<Film {...ICON} />} />
      <Toggle pressed={onion.on} onPressedChange={(v) => set({ onion: { ...onion, on: v } })} label="Onion skin" shortcut="O" icon={<Layers2 {...ICON} />} />
      <Dropdown
        label="Onion skin settings"
        trigger={
          <button type="button" className="inline-flex h-7 items-center rounded-sm px-1 text-fg-3 transition-ui hover:bg-hover hover:text-fg">
            <ChevronDown {...ICON} />
          </button>
        }
        items={[
          ...pick("Frames before", [0, 1, 2, 3], onion.before, String, (v) => set({ onion: { ...onion, on: true, before: v } })),
          ...pick("Frames after", [0, 1, 2, 3], onion.after, String, (v) => set({ onion: { ...onion, on: true, after: v } })),
          ...pick("Opacity", [0.2, 0.35, 0.5, 0.7], onion.opacity, (v) => `${Math.round(v * 100)}%`, (v) => set({ onion: { ...onion, on: true, opacity: v } })),
        ]}
      />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <NumberField className="w-32" label="Length" unit="s" value={spec.meta.duration} min={1} max={60} step={0.5} onChange={changeDuration} />
        <div className="h-5 w-px shrink-0 bg-line" />
        <NumberField className="w-24" label="In" value={r.start} min={0} max={r.end} onChange={(v) => set({ range: { start: Math.round(v), end: r.end } })} />
        <NumberField className="w-24" label="Out" value={r.end} min={r.start} max={last} onChange={(v) => set({ range: { start: r.start, end: Math.round(v) } })} />
        {range && <IconButton label="Play the whole scene" icon={<X {...ICON} />} onClick={() => set({ range: null })} />}
        <Toggle pressed={loop} onPressedChange={(v) => set({ loop: v })} label="Loop" shortcut="L" icon={<Repeat {...ICON} />} />
        <Dropdown
          label="Frames per second"
          trigger={
            <Button size={28} variant="ghost" className="font-mono">
              {spec.meta.fps} fps <ChevronDown {...ICON} />
            </Button>
          }
          items={([12, 24, 30] as const).map((f) => ({ id: String(f), label: `${f} fps`, checked: spec.meta.fps === f, run: () => commit(`Set ${f} fps`, setFps(spec, f)) }))}
        />
      </div>
    </div>
  );
}

function Clock({ spec }: { spec: SceneSpec }) {
  const t = useStudio((s) => s.t);
  const fps = spec.meta.fps;
  return (
    <div className="ml-2 shrink-0 font-mono text-sm text-fg-2" aria-live="off">
      <span className="text-fg">{timecode(t, fps)}</span>
      {/* the total is also in the Length field, the frame number on the ruler */}
      <span className="hidden text-fg-3 @[68rem]:inline"> / {timecode(spec.meta.duration, fps)}</span>
      <span className="ml-3 hidden text-fg-3 @[58rem]:inline">frame </span>
      <span className="hidden text-fg @[58rem]:inline">{frameOf(t, spec)}</span>
    </div>
  );
}

const Diamond = ({ x }: { x: number }) => <span aria-hidden className="absolute top-1/2 size-2 -translate-1/2 rotate-45 rounded-[1px] bg-accent" style={{ left: x }} />;

type KeyDrag = { layer: string; from: number; to: number } | null;

/** Grid, rows and keyframes: memoized so playback only re-renders the playhead. */
const Grid = memo(function Grid({ spec, rows, fw, selected, keyDrag, range, aiMarks }: { spec: SceneSpec; rows: Row[]; fw: number; selected: string | null; keyDrag: KeyDrag; range: { start: number; end: number } | null; aiMarks: Record<string, unknown> }) {
  const fps = spec.meta.fps;
  const n = frameCount(spec);
  const labelEvery = [1, 2, 5, 6, 10, 12, 15, 24, 30, 60].find((k) => k * fw >= 36) ?? 60;
  const gridBg = `repeating-linear-gradient(to right, var(--grid-line-strong) 0 1px, transparent 1px ${fw * fps}px), repeating-linear-gradient(to right, var(--grid-line) 0 1px, transparent 1px ${fw}px)`;
  const outside = range && (
    <>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 bg-scrim" style={{ width: range.start * fw }} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 bg-scrim" style={{ left: (range.end + 1) * fw }} />
    </>
  );
  return (
    <>
      {/* beats */}
      <div className="sticky top-0 z-20 flex h-(--beats-h) bg-panel">
        <div className="sticky left-0 z-10 flex w-(--layer-label-w) shrink-0 items-center gap-1 border-r border-line bg-panel px-2 text-micro text-fg-3">
          <Flag size={12} strokeWidth={1.5} /> Beats
        </div>
        <div className="relative" style={{ width: n * fw }}>
          {spec.beats.map((b) => (
            <span key={`${b.at}-${b.label}`} title={b.note ? `${b.label}: ${b.note}` : b.label} className="absolute top-0.5 flex h-4 max-w-40 items-center gap-1 truncate rounded-sm border-l-2 border-accent bg-raised pr-1.5 pl-1 text-micro text-fg-2" style={{ left: Math.round(b.at * fps) * fw }}>
              {b.label}
            </span>
          ))}
        </div>
      </div>
      {/* ruler */}
      <div className="sticky top-(--beats-h) z-20 flex h-(--ruler-h) border-b border-line bg-panel">
        <div className="sticky left-0 z-10 w-(--layer-label-w) shrink-0 border-r border-line bg-panel" />
        <div className="relative cursor-ew-resize" data-scrub style={{ width: n * fw, backgroundImage: gridBg }}>
          {Array.from({ length: Math.ceil(n / labelEvery) }, (_, i) => i * labelEvery).map((f) => (
            <span key={f} className="absolute top-1 pl-1 font-mono text-micro text-fg-3" style={{ left: f * fw }}>
              {f}
            </span>
          ))}
          {outside}
        </div>
      </div>
      {/* rows */}
      {rows.map((r) => {
        const drawn = keyDrag?.layer === r.key ? r.drawn.map((d) => (d.frame === keyDrag.from ? { ...d, frame: keyDrag.to } : d)).sort((a, b) => a.frame - b.frame) : r.drawn;
        return (
          <div key={r.key} className="flex h-(--row-h) border-b border-line">
            <button
              type="button"
              data-select-row={r.key}
              title={`${r.label} (${r.type})`}
              className={cx("sticky left-0 z-10 flex w-(--layer-label-w) shrink-0 items-center gap-1.5 border-r border-line px-2 text-left text-sm transition-ui", selected === r.key ? "bg-accent-soft text-fg" : "bg-panel text-fg-2 hover:bg-hover")}
            >
              {r.overlay && <SquareStack size={12} strokeWidth={1.5} className="shrink-0 text-fg-3" aria-label="Overlay" />}
              {r.type === "drawing" && <Brush size={12} strokeWidth={1.5} className="shrink-0 text-fg-3" aria-label="Drawing layer" />}
              <span className="truncate">{r.label}</span>
              {isAIRow(r, aiMarks) && <Sparkles size={12} strokeWidth={1.5} className="ml-auto shrink-0 text-accent" aria-label="Made by AI" />}
            </button>
            <div data-scrub data-row={r.key} className={cx("relative", selected === r.key && "bg-accent-soft/40")} style={{ width: n * fw, backgroundImage: gridBg }}>
              {/* held exposures: a bar from each drawing until the next one */}
              {drawn.map((d, i) => (
                <span key={`h${d.frame}`} aria-hidden className="absolute inset-y-1.5 rounded-sm bg-raised" style={{ left: d.frame * fw + 1, width: ((drawn[i + 1]?.frame ?? n) - d.frame) * fw - 2 }} />
              ))}
              {drawn.map((d) => (
                <span
                  key={`d${d.frame}`}
                  data-key-layer={r.key}
                  data-key-frame={d.frame}
                  title={`Drawing at frame ${d.frame}${d.empty ? " (empty)" : ""}. Drag to retime.`}
                  className={cx("absolute top-1/2 size-2.5 -translate-1/2 cursor-grab rounded-full border-2", d.empty ? "border-fg-2 bg-transparent" : "border-fg bg-fg", keyDrag?.layer === r.key && keyDrag.to === d.frame && "border-accent bg-accent")}
                  style={{ left: d.frame * fw + fw / 2 }}
                />
              ))}
              {r.keyframes.map((f) => (
                <Diamond key={f} x={f * fw + fw / 2} />
              ))}
              {outside}
            </div>
          </div>
        );
      })}
    </>
  );
});

function Playhead({ spec, fw, rowCount }: { spec: SceneSpec; fw: number; rowCount: number }) {
  const t = useStudio((s) => s.t);
  const f = frameOf(t, spec);
  const x = `calc(var(--layer-label-w) + ${f * fw}px)`;
  return (
    <div className="pointer-events-none absolute top-0 z-30" style={{ left: x, width: fw, height: `calc(var(--beats-h) + var(--ruler-h) + ${rowCount} * var(--row-h))` }} aria-hidden>
      <div className="absolute inset-x-0 top-(--beats-h) bottom-0 bg-accent-soft" />
      <div className="absolute top-(--beats-h) bottom-0 left-1/2 w-px -translate-x-1/2 bg-accent" />
      <div className="absolute top-[calc(var(--beats-h)+2px)] left-1/2 -translate-x-1/2 rounded-sm bg-accent px-1 font-mono text-micro text-accent-ink">{timecode(t, spec.meta.fps)}</div>
    </div>
  );
}

export function Timeline({ onAskAI }: { onAskAI: () => void }) {
  const spec = useStudio((s) => s.spec);
  const fw = useStudio((s) => s.frameWidth);
  const selected = useStudio((s) => s.selected);
  const range = useStudio((s) => s.range);
  const aiMarks = useStudio((s) => s.aiMarks);
  const generating = useStudio((s) => s.generation?.status === "running");
  const set = useStudio((s) => s.set);
  const scroller = useRef<HTMLDivElement>(null);
  const [keyDrag, setKeyDrag] = useState<KeyDrag>(null);
  const rows = useMemo(() => (spec ? rowsOf(spec) : []), [spec]);

  // Ctrl+wheel zooms the frame grid
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { frameWidth } = useStudio.getState();
      set({ frameWidth: Math.min(24, Math.max(12, frameWidth - Math.sign(e.deltaY))) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [set, spec]);

  // keep the playhead in view while playing or stepping
  useEffect(
    () =>
      useStudio.subscribe((s, p) => {
        const el = scroller.current;
        if (!el || !s.spec || s.t === p.t) return;
        const label = el.querySelector<HTMLElement>("[data-label-col]")?.offsetWidth ?? 160;
        const x = frameOf(s.t, s.spec) * s.frameWidth;
        if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - label - 40) el.scrollLeft = Math.max(0, x - 40);
      }),
    [],
  );

  if (!spec) return null;
  if (rows.length === 0 && spec.beats.length === 0 && !generating)
    return (
      <div className="flex h-full flex-col bg-panel">
        <Transport spec={spec} />
        <EmptyState
          title="Draw on the canvas or ask the AI to start a scene"
          actions={
            <>
              <Button size={28} icon={<Brush {...ICON} />} onClick={() => set({ tool: "brush" })}>
                Start drawing
              </Button>
              <Button size={28} icon={<Sparkles {...ICON} />} onClick={onAskAI}>
                Ask the AI
              </Button>
            </>
          }
        />
      </div>
    );

  const frameAtX = (clientX: number) => {
    const el = scroller.current!;
    const label = el.querySelector<HTMLElement>("[data-label-col]")?.offsetWidth ?? 160;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - label;
    return Math.min(frameCount(spec) - 1, Math.max(0, Math.floor(x / fw)));
  };
  const scrubAt = (clientX: number) => set({ t: frameAtX(clientX) / spec.meta.fps, playing: false });

  return (
    <div className="flex h-full flex-col bg-panel">
      <Transport spec={spec} />
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        onPointerDown={(e) => {
          const el = e.target as HTMLElement;
          const sel = el.closest<HTMLElement>("[data-select-row]")?.dataset.selectRow;
          if (sel) return set({ selected: sel });
          const row = el.closest<HTMLElement>("[data-row]")?.dataset.row;
          if (row) set({ selected: row });
          if (!el.closest("[data-scrub]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const key = el.closest<HTMLElement>("[data-key-frame]");
          if (key && !useStudio.getState().locked[key.dataset.keyLayer!]) {
            const f = Number(key.dataset.keyFrame);
            setKeyDrag({ layer: key.dataset.keyLayer!, from: f, to: f });
          }
          scrubAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          if (keyDrag) setKeyDrag({ ...keyDrag, to: frameAtX(e.clientX) });
          scrubAt(e.clientX);
        }}
        onPointerUp={() => {
          if (!keyDrag) return;
          const s = useStudio.getState();
          if (keyDrag.to !== keyDrag.from && findLayer(s.spec!, keyDrag.layer)) s.commit("Move frame", moveFrame(s.spec!, keyDrag.layer, keyDrag.from, keyDrag.to));
          setKeyDrag(null);
        }}
      >
        <div className="relative w-max min-w-full">
          <span data-label-col className="pointer-events-none absolute w-(--layer-label-w)" />
          <Grid spec={spec} rows={rows} fw={fw} selected={selected} keyDrag={keyDrag} range={range} aiMarks={aiMarks} />
          <Playhead spec={spec} fw={fw} rowCount={rows.length} />
          {rows.length === 0 && (
            <p className="sticky left-0 w-max p-3 text-sm text-fg-3">{generating ? "Layers appear here when the AI finishes writing the scene…" : "No layers yet"}</p>
          )}
        </div>
      </div>
    </div>
  );
}
