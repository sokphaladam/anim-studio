import * as Slider from "@radix-ui/react-slider";
import { useId, useRef, useState } from "react";
import { cx } from "./cx";

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Show a slider under the field. */
  slider?: boolean;
  disabled?: boolean;
  className?: string;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Numeric field: drag the label to scrub, type to set, optional slider. */
export function NumberField({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, slider, disabled, className }: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; v: number } | null>(null);
  // resync the text when the value changes from outside (drag, slider, arrows)
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(+value.toFixed(3)));
  }

  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "" || Number.isNaN(n)) return setError("Enter a number");
    if (n < min || n > max) return setError(`Use a value from ${min} to ${max}`);
    setError(null);
    onChange(n);
  };
  const round = (v: number) => +(Math.round(v / step) * step).toFixed(6);

  return (
    <div className={cx("flex min-w-0 flex-col gap-1", disabled && "pointer-events-none opacity-40", className)}>
      <div className="flex h-7 items-center gap-2">
        <label
          htmlFor={id}
          className="cursor-ew-resize truncate text-sm text-fg-2 select-none"
          title="Drag to change"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, v: value };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            onChange(clamp(round(drag.current.v + ((e.clientX - drag.current.x) / 4) * step), min, max));
          }}
          onPointerUp={() => (drag.current = null)}
        >
          {label}
        </label>
        <div className={cx("ml-auto flex h-7 items-center rounded-sm border bg-raised px-2 transition-ui focus-within:border-accent", error ? "border-danger" : "border-transparent")}>
          <input
            id={id}
            inputMode="decimal"
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            className="w-12 bg-transparent text-right font-mono text-sm outline-none"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                onChange(clamp(round(value + (e.key === "ArrowUp" ? step : -step)), min, max));
              }
            }}
          />
          {unit && <span className="ml-1 text-micro text-fg-3">{unit}</span>}
        </div>
      </div>
      {slider && Number.isFinite(min) && Number.isFinite(max) && (
        <Slider.Root className="relative flex h-4 touch-none items-center select-none" min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={label}>
          <Slider.Track className="relative h-1 grow rounded-full bg-raised">
            <Slider.Range className="absolute h-full rounded-full bg-fg-3" />
          </Slider.Track>
          <Slider.Thumb className="block size-3 rounded-full bg-fg transition-ui hover:bg-accent-hover" />
        </Slider.Root>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-micro text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
