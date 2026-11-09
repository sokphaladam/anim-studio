import { CommandPalette, MenuBar, ShortcutSheet, useToast } from "@anim/ui";
import type { DockviewApi, IDockviewPanelProps } from "dockview-react";
import { useEffect, useMemo, useRef, type FunctionComponent } from "react";
import { CanvasView } from "../canvas/CanvasView";
import { ExportDialog } from "../components/ExportDialog";
import { AIAssistantDocker } from "../dockers/AIAssistant";
import { BrushPresetsDocker } from "../dockers/BrushPresets";
import { ColorDocker } from "../dockers/ColorDocker";
import { HistoryDocker } from "../dockers/History";
import { PartCheckDocker } from "../dockers/PartCheck";
import { RigDocker } from "../dockers/Rig";
import { LayersDocker } from "../dockers/Layers";
import { Timeline } from "../dockers/Timeline";
import { useStudio } from "../store";
import { saveProject } from "../store/projects";
import { useCommands } from "../workspace/commands";
import { Dock, defaultLayout } from "../workspace/Dock";
import { ToolOptionsBar } from "../workspace/ToolOptionsBar";
import { Toolbox } from "../workspace/Toolbox";

export const AUTOSAVE_KEY = "anim-studio.autosave";

/**
 * Saves the scene as a project version every 30 s when it changed (an untouched, never-saved scene is not saved).
 * If the server can't be reached, keeps a backup in localStorage that the welcome screen offers to restore.
 */
function useAutosave() {
  const toast = useToast();
  useEffect(() => {
    let saved: unknown = null;
    let warned = false;
    const id = setInterval(async () => {
      const { spec, past, projectId } = useStudio.getState();
      if (!spec || spec === saved || (!projectId && !past.length)) return;
      try {
        await saveProject("Autosave");
        saved = spec;
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch {
        try {
          localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), spec }));
        } catch {
          // too large for browser storage
        }
        if (!warned) toast({ title: "Autosave failed", description: "Can't reach the server (is pnpm dev running?). A backup is kept in this browser.", tone: "warning" });
        warned = true;
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [toast]);
}

/** Advances time from requestAnimationFrame while playing; the engine itself has no clock. */
function usePlayback() {
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { playing, t, loop, spec, range, set } = useStudio.getState();
      if (playing && spec) {
        const fps = spec.meta.fps;
        const start = range ? range.start / fps : 0, end = range ? (range.end + 1) / fps : spec.meta.duration;
        let next = t + dt;
        if (next >= end) next = loop ? start + ((next - start) % (end - start)) : end - 1 / fps;
        set({ t: next, playing: loop || next < end - 1 / fps });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export function Editor() {
  usePlayback();
  useAutosave();
  const api = useRef<DockviewApi | null>(null);
  const aiInput = useRef<HTMLTextAreaElement>(null);
  const title = useStudio((s) => s.spec?.meta.title ?? "Untitled");
  const zoom = useStudio((s) => s.view.zoom);
  const ui = useStudio((s) => s.ui);
  const set = useStudio((s) => s.set);

  const extra = useMemo(
    () => ({
      resetLayout: () => api.current && defaultLayout(api.current, useStudio.getState().spec?.meta.title ?? "Canvas"),
      focusAI: () => {
        api.current?.getPanel("ai")?.api.setActive();
        setTimeout(() => aiInput.current?.focus(), 0);
      },
    }),
    [],
  );
  const menus = useCommands(extra);

  const components = useMemo<Record<string, FunctionComponent<IDockviewPanelProps>>>(
    () => ({
      canvas: () => <CanvasView />,
      timeline: () => <Timeline onAskAI={extra.focusAI} />,
      color: () => <div className="h-full overflow-auto bg-panel"><ColorDocker /></div>,
      brushes: () => <div className="h-full overflow-auto bg-panel"><BrushPresetsDocker /></div>,
      layers: () => <div className="h-full bg-panel"><LayersDocker /></div>,
      history: () => <div className="h-full overflow-auto bg-panel"><HistoryDocker /></div>,
      parts: () => <div className="h-full overflow-auto bg-panel"><PartCheckDocker /></div>,
      rig: () => <div className="h-full overflow-auto bg-panel"><RigDocker /></div>,
      ai: () => <div className="h-full bg-panel"><AIAssistantDocker ref={aiInput} /></div>,
    }),
    [extra],
  );

  useEffect(() => {
    api.current?.getPanel("canvas")?.api.setTitle(title);
  }, [title]);

  return (
    <div className="flex h-full flex-col bg-app">
      <MenuBar menus={menus} end={<span className="font-mono text-micro text-fg-3">{Math.round(zoom * 100)}%</span>} />
      <ToolOptionsBar />
      <div className="flex min-h-0 flex-1">
        <Toolbox />
        <main className="isolate min-w-0 flex-1">
          <Dock components={components} title={title} onApi={(a) => (api.current = a)} />
        </main>
      </div>
      <CommandPalette open={ui.palette} onOpenChange={(o) => set({ ui: { ...ui, palette: o } })} menus={menus} />
      <ExportDialog open={ui.export} onOpenChange={(o) => set({ ui: { ...ui, export: o } })} />
      <ShortcutSheet
        open={ui.shortcuts}
        onOpenChange={(o) => set({ ui: { ...ui, shortcuts: o } })}
        menus={menus}
        extra={[
          { label: "Pick a color while brushing", keys: "Ctrl+click" },
          { label: "Erase with the pen", keys: "Pen eraser end" },
          { label: "Pan canvas", keys: "Space+drag" },
          { label: "Zoom canvas", keys: "Ctrl+wheel" },
          { label: "Rotate canvas", keys: "Shift+Space+drag" },
          { label: "Zoom timeline", keys: "Ctrl+wheel" },
        ]}
      />
    </div>
  );
}
