import { NumberField, Toggle, Tooltip } from "@anim/ui";
import { Circle, KeyRound, Lasso, Minus, Square, SquareDashed } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "../store";
import { PRESETS } from "../dockers/BrushPresets";
import { TOOLS } from "./tools";

const ICON = { size: 16, strokeWidth: 1.5 } as const;

function Swatch() {
  const color = useStudio((s) => s.color);
  return (
    <Tooltip label={`Current color ${color}`}>
      <span className="size-6 shrink-0 rounded-sm border border-line-strong" style={{ background: color }} role="img" aria-label={`Current color ${color}`} />
    </Tooltip>
  );
}

const Hint = ({ children }: { children: string }) => <span className="ml-auto truncate text-micro text-fg-3" title={children}>{children}</span>;

export function ToolOptionsBar() {
  const { tool, brush, eraserSize, shape, selectMode, autoKey, set } = useStudio(
    useShallow((s) => ({ tool: s.tool, brush: s.brush, eraserSize: s.eraserSize, shape: s.shape, selectMode: s.selectMode, autoKey: s.autoKey, set: s.set })),
  );
  const t = TOOLS.find((x) => x.id === tool)!;
  const setBrush = (p: Partial<typeof brush>) => set({ brush: { ...brush, ...p } });
  const brushFields = (
    <>
      <NumberField className="w-36" label="Size" value={brush.size} onChange={(v) => setBrush({ size: v })} min={1} max={200} unit="px" />
      <NumberField className="w-36" label="Opacity" value={brush.opacity} onChange={(v) => setBrush({ opacity: v })} min={1} max={100} unit="%" />
    </>
  );

  return (
    <div role="toolbar" aria-label="Tool options" className="flex h-(--options-h) shrink-0 items-center gap-4 overflow-x-auto border-b border-line bg-panel px-3">
      <span className="flex w-36 shrink-0 items-center gap-2 truncate text-sm font-semibold text-fg-2">
        <t.icon {...ICON} />
        {t.label}
      </span>
      {tool === "brush" && (
        <>
          <span className="shrink-0 text-sm text-fg-3">{PRESETS.find((p) => p.id === brush.preset)?.label}</span>
          {brushFields}
          <NumberField className="w-40" label="Smoothing" value={brush.smoothing} onChange={(v) => setBrush({ smoothing: v })} min={0} max={100} unit="%" />
          <Swatch />
          <Hint>Pen pressure supported · Ctrl+click picks a color · [ ] change size</Hint>
        </>
      )}
      {tool === "eraser" && (
        <>
          <NumberField className="w-36" label="Size" value={eraserSize} onChange={(v) => set({ eraserSize: v })} min={1} max={400} unit="px" />
          <NumberField className="w-40" label="Smoothing" value={brush.smoothing} onChange={(v) => setBrush({ smoothing: v })} min={0} max={100} unit="%" />
          <Hint>Erases on the selected drawing layer only</Hint>
        </>
      )}
      {tool === "fill" && (
        <>
          <Swatch />
          <Hint>Click inside a closed shape to fill it</Hint>
        </>
      )}
      {tool === "shapes" && (
        <>
          <div role="radiogroup" aria-label="Shape" className="flex shrink-0 gap-0.5">
            {([["line", "Line", Minus], ["rect", "Rectangle", Square], ["ellipse", "Ellipse", Circle]] as const).map(([id, label, Icon]) => (
              <Toggle key={id} pressed={shape === id} onPressedChange={() => set({ shape: id })} label={label} icon={<Icon {...ICON} />} />
            ))}
          </div>
          {brushFields}
          <Swatch />
          <Hint>Hold Shift for squares, circles and 45° lines</Hint>
        </>
      )}
      {tool === "select" && (
        <>
          <div role="radiogroup" aria-label="Selection shape" className="flex shrink-0 gap-0.5">
            <Toggle pressed={selectMode === "rect"} onPressedChange={() => set({ selectMode: "rect" })} label="Rectangle selection" icon={<SquareDashed {...ICON} />} />
            <Toggle pressed={selectMode === "lasso"} onPressedChange={() => set({ selectMode: "lasso" })} label="Lasso selection" icon={<Lasso {...ICON} />} />
          </div>
          <Hint>Selects strokes on the current frame · Delete removes · T to move · Esc deselects</Hint>
        </>
      )}
      {tool === "transform" && (
        <>
          <Toggle pressed={autoKey} onPressedChange={(v) => set({ autoKey: v })} label="Auto-key: moving a layer adds a keyframe at the current frame" icon={<KeyRound {...ICON} />}>
            Auto-key
          </Toggle>
          <Hint>Drag to move · corners scale · top handle rotates · works on the selection, else the layer</Hint>
        </>
      )}
      {tool === "eyedropper" && (
        <>
          <Swatch />
          <Hint>Click the canvas to pick a color</Hint>
        </>
      )}
    </div>
  );
}
