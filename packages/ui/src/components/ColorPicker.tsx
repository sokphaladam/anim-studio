import { Pipette } from "lucide-react";
import { useState, type PointerEvent as RPE } from "react";
import { IconButton } from "./Button";
import { hexToHsv, hsvToHex, type HSV } from "./color";
import { cx } from "./cx";

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  recent?: string[];
  onEyedropper?: () => void;
  className?: string;
}

function useDrag(onMove: (x: number, y: number) => void) {
  const move = (e: RPE<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return {
    onPointerDown(e: RPE<HTMLDivElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e);
    },
    onPointerMove(e: RPE<HTMLDivElement>) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
    },
  };
}

/** HSV square, hue strip, hex input, recent colors and an eyedropper button. */
export function ColorPicker({ value, onChange, recent = [], onEyedropper, className }: ColorPickerProps) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [hex, setHex] = useState(value);
  const [error, setError] = useState(false);
  // resync when the value changes from outside (eyedropper, swatches)
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    const next = hexToHsv(value);
    if (next) setHsv((p) => ({ ...next, h: next.s === 0 ? p.h : next.h }));
    setHex(value);
  }

  const set = (next: HSV) => {
    setHsv(next);
    const h = hsvToHex(next);
    setLast(h);
    setHex(h);
    setError(false);
    onChange(h);
  };
  const sv = useDrag((x, y) => set({ ...hsv, s: x, v: 1 - y }));
  const hue = useDrag((x) => set({ ...hsv, h: x * 359.9 }));
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={hex}
        aria-valuenow={Math.round(hsv.s * 100)}
        tabIndex={0}
        className="relative aspect-[4/3] w-full cursor-crosshair touch-none rounded-sm"
        style={{ background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, ${hueColor})` }}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.1 : 0.02;
          const map: Record<string, Partial<HSV>> = { ArrowLeft: { s: hsv.s - d }, ArrowRight: { s: hsv.s + d }, ArrowUp: { v: hsv.v + d }, ArrowDown: { v: hsv.v - d } };
          const m = map[e.key];
          if (!m) return;
          e.preventDefault();
          const c = (n: number) => Math.min(1, Math.max(0, n));
          set({ ...hsv, s: c(m.s ?? hsv.s), v: c(m.v ?? hsv.v) });
        }}
        {...sv}
      >
        <span className="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-fg shadow-float" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        className="relative h-3 w-full cursor-ew-resize touch-none rounded-full"
        style={{ background: "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)" }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          set({ ...hsv, h: (hsv.h + (e.key === "ArrowRight" ? 5 : -5) + 360) % 360 });
        }}
        {...hue}
      >
        <span className="pointer-events-none absolute top-1/2 size-3.5 -translate-1/2 rounded-full border-2 border-fg" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="size-7 shrink-0 rounded-sm border border-line-strong" style={{ background: value }} aria-hidden />
        <input
          aria-label="Hex color"
          aria-invalid={error}
          className={cx("h-7 min-w-0 flex-1 rounded-sm border bg-raised px-2 font-mono text-sm outline-none focus:border-accent", error ? "border-danger" : "border-transparent")}
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
            const next = hexToHsv(v);
            setError(!next);
            if (next) {
              setHsv(next);
              setLast(v.toLowerCase());
              onChange(v.toLowerCase());
            }
          }}
        />
        {onEyedropper && <IconButton label="Pick from canvas" shortcut="P" icon={<Pipette size={16} strokeWidth={1.5} />} onClick={onEyedropper} />}
      </div>
      {error && <p role="alert" className="text-micro text-danger">Use a 6-digit hex like #f2a93b</p>}
      {recent.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Recent colors">
          {recent.map((c) => (
            <button key={c} type="button" aria-label={`Use ${c}`} title={c} className="size-5 rounded-sm border border-line-strong transition-ui hover:scale-110" style={{ background: c }} onClick={() => onChange(c)} />
          ))}
        </div>
      )}
    </div>
  );
}
