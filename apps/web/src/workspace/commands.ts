import { useToast, type MenuAction, type MenuGroup } from "@anim/ui";
import { useEffect, useMemo } from "react";
import { tinykeys } from "tinykeys";
import { useShallow } from "zustand/react/shallow";
import { frameOf, useStudio } from "../store";
import { deleteLayer, findLayer, heldIndexAt, moveLayer, setFps } from "../store/edit";
import { EXAMPLES, blankScene, overlayKey } from "../store/scenes";
import { deleteSelection } from "../tools/select";
import { addDrawingLayer, changeDuration, frameAction } from "./frameActions";
import { TOOLS } from "./tools";

/** A menu action plus its tinykeys binding(s). */
type Command = MenuAction & { keys?: string | string[] };
type Group = { label: string; items: (Command | "separator")[] };

const get = useStudio.getState;
const zoomBy = (f: number) => {
  const { view, set } = get();
  set({ view: { ...view, zoom: Math.min(16, Math.max(0.1, view.zoom * f)) } });
};
const sizeBy = (f: number) => {
  const { tool, brush, eraserSize, set } = get();
  if (tool === "eraser") set({ eraserSize: Math.max(1, Math.min(400, Math.round(eraserSize * f))) });
  else set({ brush: { ...brush, size: Math.max(1, Math.min(200, Math.round(brush.size * f) || 1)) } });
};

/** Every action in the app. Menus, the command palette and shortcuts all read this list. */
export function useCommands(extra: { resetLayout: () => void; focusAI: () => void }): MenuGroup[] {
  const toast = useToast();
  // only the fields that change labels/checked/disabled; actions read fresh state via get()
  const v = useStudio(
    useShallow((s) => ({ tool: s.tool, loop: s.loop, playing: s.playing, fps: s.spec?.meta.fps, duration: s.spec?.meta.duration, selected: s.selected, layers: s.spec?.layers, canUndo: s.past.length > 0, canRedo: s.future.length > 0, onion: s.onion.on, autoFrame: s.autoFrame, autoKey: s.autoKey, hasSelection: !!s.selection })),
  );
  const groups = useMemo<Group[]>(() => {
    const s = get();
    const later = (m: number) => ({ disabled: true, hint: `Milestone ${m}` });
    const sel = v.selected;
    const selIndex = v.layers?.findIndex((l) => l.id === sel) ?? -1;
    return [
      {
        label: "File",
        items: [
          { id: "file.new", label: "New blank scene", shortcut: "Ctrl+Alt+N", keys: "$mod+Alt+KeyN", run: () => s.open(blankScene("16:9"), "drawing-1") },
          ...EXAMPLES.map((e) => ({ id: `file.example.${e.id}`, label: `Open example: ${e.title}`, run: () => s.open(e.load()) })),
          "separator",
          { id: "file.save", label: "Save project", shortcut: "Ctrl+S", ...later(4), run: () => {} },
          { id: "file.welcome", label: "Close to welcome screen", run: () => s.close() },
        ],
      },
      {
        label: "Edit",
        items: [
          { id: "edit.undo", label: "Undo", shortcut: "Ctrl+Z", keys: "$mod+KeyZ", disabled: !v.canUndo, run: s.undo },
          { id: "edit.redo", label: "Redo", shortcut: "Ctrl+Shift+Z", keys: ["$mod+Shift+KeyZ", "$mod+KeyY"], disabled: !v.canRedo, run: s.redo },
          "separator",
          { id: "edit.selectAll", label: "Select all strokes", shortcut: "Ctrl+A", keys: "$mod+KeyA", run: selectAll },
          { id: "edit.deselect", label: "Deselect", shortcut: "Ctrl+Shift+A", keys: ["$mod+Shift+KeyA", "Escape"], disabled: !v.hasSelection, run: () => s.set({ selection: null }) },
          { id: "edit.deleteSel", label: "Delete selection", shortcut: "Delete", keys: ["Delete", "Backspace"], disabled: !v.hasSelection, run: deleteSelection },
          "separator",
          ...TOOLS.map((t) => ({ id: `tool.${t.id}`, label: `${t.label} tool`, shortcut: t.key, keys: t.key.toLowerCase(), checked: v.tool === t.id, run: () => s.set({ tool: t.id }) })),
          { id: "brush.smaller", label: "Smaller brush", shortcut: "[", keys: "BracketLeft", run: () => sizeBy(0.8) },
          { id: "brush.bigger", label: "Bigger brush", shortcut: "]", keys: "BracketRight", run: () => sizeBy(1.25) },
        ],
      },
      {
        label: "View",
        items: [
          { id: "view.zoomIn", label: "Zoom in", shortcut: "Ctrl+=", keys: "$mod+Equal", run: () => zoomBy(1.25) },
          { id: "view.zoomOut", label: "Zoom out", shortcut: "Ctrl+-", keys: "$mod+Minus", run: () => zoomBy(0.8) },
          { id: "view.fit", label: "Fit canvas", shortcut: "Ctrl+0", keys: "$mod+Digit0", run: () => s.set({ view: { zoom: 1, panX: 0, panY: 0, rotation: 0 } }) },
          { id: "view.resetRotation", label: "Reset rotation", run: () => s.set({ view: { ...get().view, rotation: 0 } }) },
          "separator",
          { id: "view.palette", label: "Command palette", shortcut: "Ctrl+K", keys: "$mod+KeyK", run: () => s.set({ ui: { ...get().ui, palette: true } }) },
          { id: "view.shortcuts", label: "Keyboard shortcuts", shortcut: "?", keys: "Shift+?", run: () => s.set({ ui: { ...get().ui, shortcuts: true } }) },
          { id: "view.resetLayout", label: "Reset panel layout", run: extra.resetLayout },
        ],
      },
      {
        label: "Layer",
        items: [
          { id: "layer.new", label: "New drawing layer", shortcut: "Ctrl+Shift+N", keys: "$mod+Shift+KeyN", run: addDrawingLayer },
          { id: "layer.delete", label: "Delete layer", disabled: selIndex < 0, run: () => sel && (s.commit(`Delete ${sel}`, deleteLayer(get().spec!, sel)), s.set({ selected: null })) },
          "separator",
          { id: "layer.toggle", label: "Show / hide selected layer", shortcut: "H", keys: "h", disabled: !sel, run: () => sel && s.set({ hidden: { ...get().hidden, [sel]: !get().hidden[sel] } }) },
          { id: "layer.lock", label: "Lock / unlock selected layer", disabled: !sel, run: () => sel && s.set({ locked: { ...get().locked, [sel]: !get().locked[sel] } }) },
          { id: "layer.up", label: "Move layer up", shortcut: "Ctrl+]", keys: "$mod+BracketRight", disabled: selIndex < 0 || selIndex >= (v.layers?.length ?? 0) - 1, run: () => s.commit(`Move ${sel}`, moveLayer(get().spec!, sel!, selIndex + 1)) },
          { id: "layer.down", label: "Move layer down", shortcut: "Ctrl+[", keys: "$mod+BracketLeft", disabled: selIndex <= 0, run: () => s.commit(`Move ${sel}`, moveLayer(get().spec!, sel!, selIndex - 1)) },
          { id: "layer.showAll", label: "Show all layers", run: () => s.set({ hidden: {} }) },
        ],
      },
      {
        label: "Animation",
        items: [
          { id: "anim.play", label: v.playing ? "Pause" : "Play", shortcut: "Enter", keys: "Enter", run: s.togglePlay },
          { id: "anim.prev", label: "Previous frame", shortcut: ",", keys: "Comma", run: () => s.step(-1) },
          { id: "anim.next", label: "Next frame", shortcut: ".", keys: "Period", run: () => s.step(1) },
          { id: "anim.first", label: "First frame", shortcut: "Home", keys: "Home", run: () => s.set({ t: (get().range?.start ?? 0) / (get().spec?.meta.fps ?? 24), playing: false }) },
          { id: "anim.last", label: "Last frame", shortcut: "End", keys: "End", run: () => (get().range ? s.set({ t: get().range!.end / get().spec!.meta.fps, playing: false }) : s.step(1e9)) },
          { id: "anim.loop", label: "Loop playback", shortcut: "L", keys: "l", checked: v.loop, run: () => s.set({ loop: !get().loop }) },
          "separator",
          { id: "anim.insert", label: "Insert blank frame", shortcut: "Shift+N", keys: "Shift+KeyN", run: () => frameAction("insert", toast) },
          { id: "anim.duplicate", label: "Duplicate frame", shortcut: "Shift+D", keys: "Shift+KeyD", run: () => frameAction("duplicate", toast) },
          { id: "anim.delete", label: "Delete frame", shortcut: "Shift+Delete", keys: ["Shift+Delete", "Shift+Backspace"], run: () => frameAction("delete", toast) },
          { id: "anim.autoFrame", label: "Auto-frame (draw on empty frame = new drawing)", checked: v.autoFrame, run: () => s.set({ autoFrame: !get().autoFrame }) },
          { id: "anim.autoKey", label: "Auto-key transforms", checked: v.autoKey, run: () => s.set({ autoKey: !get().autoKey }) },
          { id: "anim.onion", label: "Onion skin", shortcut: "O", keys: "o", checked: v.onion, run: () => s.set({ onion: { ...get().onion, on: !get().onion.on } }) },
          { id: "anim.clearRange", label: "Play the whole scene (clear range)", run: () => s.set({ range: null }) },
          "separator",
          ...[5, 10, 12, 15, 30, 60].map((d) => ({ id: `anim.length.${d}`, label: `Scene length: ${d} s`, checked: v.duration === d, run: () => changeDuration(d) })),
          "separator",
          ...([12, 24, 30] as const).map((f) => ({ id: `anim.fps.${f}`, label: `${f} fps`, checked: v.fps === f, run: () => s.commit(`Set ${f} fps`, setFps(get().spec!, f)) })),
        ],
      },
      {
        label: "AI",
        items: [
          { id: "ai.focus", label: "Open AI assistant", run: extra.focusAI },
          { id: "ai.generate", label: "Generate scene from prompt…", ...later(3), run: () => {} },
        ],
      },
      { label: "Export", items: [{ id: "export.mp4", label: "Export MP4…", shortcut: "Ctrl+E", ...later(5), run: () => {} }] },
    ];
  }, [v, extra, toast]);

  useEffect(() => {
    const map: Record<string, (e: KeyboardEvent) => void> = {};
    for (const g of groups)
      for (const it of g.items)
        if (it !== "separator" && it.keys && !it.disabled)
          for (const k of [it.keys].flat())
            map[k] = (e) => {
              e.preventDefault();
              it.run();
            };
    return tinykeys(window, map, {
      // let typing, and Enter on focused controls, work normally; key repeat is allowed so held , and . scrub
      ignore: (e) => {
        const el = e.target instanceof Element ? e.target : null;
        return e.isComposing || !!el?.closest("[contenteditable],input,select,textarea,[role=dialog]") || (e.key === "Enter" && !!el?.closest('button,a,[role="button"],[role="menuitem"],[role="option"],[role="radio"],[role="slider"]'));
      },
    });
  }, [groups]);

  return groups;
}

/** Selects every stroke on the visible frame of the selected drawing layer. */
function selectAll() {
  const s = get();
  const l = s.spec && findLayer(s.spec, s.selected);
  if (!l || l.type !== "drawing") return;
  const frame = heldIndexAt(s.spec!, l, frameOf(s.t, s.spec!));
  if (frame < 0) return;
  s.set({ selection: { layer: l.id, frame, indices: l.frames![frame].strokes.map((_, i) => i) }, tool: s.tool === "select" ? "select" : s.tool });
}

export { overlayKey };
