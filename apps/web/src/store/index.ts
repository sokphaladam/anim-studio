import type { SceneSpec } from "@anim/spec";
import type { Generation, ChatMessage } from "./ai";
import { create } from "zustand";

export type Tool = "brush" | "eraser" | "fill" | "shapes" | "transform" | "select" | "eyedropper";
export type BrushPreset = "pencil" | "ink" | "marker" | "airbrush";
export type Selection = { layer: string; frame: number; indices: number[] } | null;

const HISTORY_LIMIT = 200;
let lastCommit = { label: "", at: 0 };
type Entry = { spec: SceneSpec; label: string };

export interface StudioState {
  screen: "welcome" | "editor";
  spec: SceneSpec | null;
  /** States before each action (label = that action). */
  past: Entry[];
  /** Undone actions, most recent last. */
  future: Entry[];
  /** Spec at the start of a drag; the whole drag becomes one history step. */
  gestureBase: SceneSpec | null;
  t: number;
  playing: boolean;
  loop: boolean;
  /** Play range in frames, inclusive. */
  range: { start: number; end: number } | null;
  tool: Tool;
  color: string;
  brush: { preset: BrushPreset; size: number; opacity: number; smoothing: number };
  eraserSize: number;
  shape: "line" | "rect" | "ellipse";
  selectMode: "rect" | "lasso";
  autoFrame: boolean;
  autoKey: boolean;
  onion: { on: boolean; before: number; after: number; opacity: number };
  selection: Selection;
  hidden: Record<string, boolean>;
  locked: Record<string, boolean>;
  selected: string | null;
  view: { zoom: number; panX: number; panY: number; rotation: number };
  /** Timeline frame cell width in px. */
  frameWidth: number;
  ui: { palette: boolean; shortcuts: boolean };
  /** The AI job in progress (or the last one that finished). */
  generation: Generation | null;
  chat: ChatMessage[];
  /** Row key → the exact layer/overlay object the AI produced; a row shows the AI spark while it is unchanged. */
  aiMarks: Record<string, unknown>;

  open(spec: SceneSpec, selected?: string | null): void;
  close(): void;
  /** Applies an edit as one undoable step. A null result (nothing to do) is ignored. `merge` folds quick repeats of the same edit (value scrubbing) into one step. */
  commit(label: string, next: SceneSpec | null, opts?: { merge?: boolean }): void;
  beginGesture(): void;
  /** Live update during a drag (not in history until endGesture). */
  preview(next: SceneSpec): void;
  endGesture(label: string): void;
  undo(): void;
  redo(): void;
  /** Jump to a history position: negative undoes, positive redoes that many steps. */
  travel(steps: number): void;
  setT(t: number): void;
  step(frames: number): void;
  togglePlay(): void;
  set(p: Partial<Omit<StudioState, "set">>): void;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const fpsOf = (s: SceneSpec | null) => s?.meta.fps ?? 24;
export const frameCount = (s: SceneSpec) => Math.max(1, Math.round(s.meta.duration * s.meta.fps));
export const frameOf = (t: number, s: SceneSpec) => Math.min(frameCount(s) - 1, Math.floor(t * s.meta.fps + 1e-6));

export const useStudio = create<StudioState>((set, get) => ({
  screen: "welcome",
  spec: null,
  past: [],
  future: [],
  gestureBase: null,
  t: 0,
  playing: false,
  loop: true,
  range: null,
  tool: "brush",
  // eslint-disable-next-line no-restricted-syntax -- default brush color is artwork data, not UI styling
  color: "#2b2130",
  brush: { preset: "ink", size: 6, opacity: 100, smoothing: 50 },
  eraserSize: 24,
  shape: "line",
  selectMode: "rect",
  autoFrame: true,
  autoKey: true,
  onion: { on: false, before: 2, after: 1, opacity: 0.35 },
  selection: null,
  hidden: {},
  locked: {},
  selected: null,
  view: { zoom: 1, panX: 0, panY: 0, rotation: 0 },
  frameWidth: 16,
  ui: { palette: false, shortcuts: false },
  generation: null,
  chat: [],
  aiMarks: {},

  open: (spec, selected = null) =>
    set({ spec, past: [], future: [], gestureBase: null, aiMarks: {}, screen: "editor", t: 0, playing: false, range: null, selection: null, hidden: {}, locked: {}, selected, view: { zoom: 1, panX: 0, panY: 0, rotation: 0 } }),
  close: () => set({ screen: "welcome", playing: false }),
  commit: (label, next, opts) => {
    const { spec, past } = get();
    if (!spec || !next || next === spec) return;
    // repeated edits of the same thing in quick succession (scrubbing a value) are one undo step
    const now = Date.now();
    const merge = !!opts?.merge && lastCommit.label === label && now - lastCommit.at < 800 && past.length > 0;
    lastCommit = { label, at: now };
    set({ spec: next, past: merge ? past : [...past, { spec, label }].slice(-HISTORY_LIMIT), future: [] });
  },
  beginGesture: () => set({ gestureBase: get().spec }),
  preview: (next) => set({ spec: next }),
  endGesture: (label) => {
    const { gestureBase, spec, past } = get();
    if (gestureBase && spec && gestureBase !== spec) set({ past: [...past, { spec: gestureBase, label }].slice(-HISTORY_LIMIT), future: [] });
    set({ gestureBase: null });
  },
  undo: () => get().travel(-1),
  redo: () => get().travel(1),
  travel: (steps) => {
    let { spec, past, future } = get();
    if (!spec) return;
    for (; steps < 0 && past.length; steps++) {
      const e = past[past.length - 1];
      past = past.slice(0, -1);
      future = [...future, { spec, label: e.label }];
      spec = e.spec;
    }
    for (; steps > 0 && future.length; steps--) {
      const e = future[future.length - 1];
      future = future.slice(0, -1);
      past = [...past, { spec, label: e.label }];
      spec = e.spec;
    }
    // a selection can point at strokes that no longer exist
    set({ spec, past, future, selection: null });
  },
  setT: (t) => {
    const s = get().spec;
    if (s) set({ t: clamp(t, 0, s.meta.duration) });
  },
  step: (n) => {
    const s = get().spec;
    if (!s) return;
    const f = clamp(frameOf(get().t, s) + n, 0, frameCount(s) - 1);
    set({ t: f / s.meta.fps, playing: false });
  },
  togglePlay: () => {
    const { playing, t, spec, range } = get();
    if (!spec) return;
    const end = range ? (range.end + 1) / spec.meta.fps : spec.meta.duration;
    const start = range ? range.start / spec.meta.fps : 0;
    set({ playing: !playing, t: !playing && (t >= end - 1e-3 || t < start) ? start : t });
  },
  set: (p) => set(p),
}));
