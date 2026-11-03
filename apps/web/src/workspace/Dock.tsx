import { DockviewReact, themeDark, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import type { FunctionComponent } from "react";

const KEY = "anim-studio.layout.v2";
export const dockTheme = { ...themeDark, name: "anim", className: `${themeDark.className} anim-dock`, gap: 1 };

export function defaultLayout(api: DockviewApi, title: string) {
  api.clear();
  const canvas = api.addPanel({ id: "canvas", component: "canvas", title });
  const color = api.addPanel({ id: "color", component: "color", title: "Color", position: { referencePanel: canvas, direction: "right" } });
  api.addPanel({ id: "brushes", component: "brushes", title: "Brush presets", position: { referencePanel: color, direction: "within" } });
  const layers = api.addPanel({ id: "layers", component: "layers", title: "Layers", position: { referencePanel: color, direction: "below" } });
  api.addPanel({ id: "history", component: "history", title: "History", position: { referencePanel: layers, direction: "within" } });
  layers.api.setActive();
  api.addPanel({ id: "ai", component: "ai", title: "AI assistant", position: { referencePanel: layers, direction: "below" } });
  // under the canvas only, so the dockers on the right get the full height (at 1366×768 a full-width timeline left Layers ~3 rows)
  const timeline = api.addPanel({ id: "timeline", component: "timeline", title: "Timeline", position: { referencePanel: canvas, direction: "below" } });
  color.api.setActive();
  color.api.setSize({ width: 300 });
  timeline.api.setSize({ height: 260 });
  canvas.api.setActive();
}

/** Dockable panels; the layout is saved to localStorage and restored on the next visit. */
export function Dock({ components, title, onApi }: { components: Record<string, FunctionComponent<IDockviewPanelProps>>; title: string; onApi: (api: DockviewApi) => void }) {
  const onReady = (e: DockviewReadyEvent) => {
    const saved = localStorage.getItem(KEY);
    try {
      if (!saved) throw new Error("no layout");
      e.api.fromJSON(JSON.parse(saved));
      if (!e.api.getPanel("canvas")) throw new Error("bad layout");
    } catch {
      defaultLayout(e.api, title);
    }
    e.api.onDidLayoutChange(() => localStorage.setItem(KEY, JSON.stringify(e.api.toJSON())));
    onApi(e.api);
  };
  return <DockviewReact className="h-full" theme={dockTheme} components={components} onReady={onReady} />;
}
