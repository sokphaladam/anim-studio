import { cx } from "@anim/ui";
import { useStudio, type BrushPreset } from "../store";

export const PRESETS: { id: BrushPreset; label: string; size: number; opacity: number; smoothing: number }[] = [
  { id: "pencil", label: "Pencil", size: 3, opacity: 85, smoothing: 20 },
  { id: "ink", label: "Ink pen", size: 6, opacity: 100, smoothing: 50 },
  { id: "marker", label: "Marker", size: 16, opacity: 70, smoothing: 40 },
  { id: "airbrush", label: "Soft airbrush", size: 40, opacity: 25, smoothing: 30 },
];

export function BrushPresetsDocker() {
  const brush = useStudio((s) => s.brush);
  const set = useStudio((s) => s.set);
  return (
    <div role="radiogroup" aria-label="Brush presets" className="grid grid-cols-2 gap-2 p-3">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={brush.preset === p.id}
          onClick={() => set({ tool: "brush", brush: { preset: p.id, size: p.size, opacity: p.opacity, smoothing: p.smoothing } })}
          className={cx("flex h-16 flex-col justify-between rounded-md border p-2 text-left transition-ui", brush.preset === p.id ? "border-accent bg-accent-soft" : "border-line bg-raised hover:bg-hover")}
        >
          <svg viewBox="0 0 100 20" className="h-5 w-full text-fg" aria-hidden>
            <path d="M4 14 C 25 2, 45 18, 65 8 S 92 6, 96 10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={Math.min(10, p.size / 2.5)} opacity={p.opacity / 100} style={p.id === "airbrush" ? { filter: "blur(2px)" } : undefined} />
          </svg>
          <span className="truncate text-sm">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
