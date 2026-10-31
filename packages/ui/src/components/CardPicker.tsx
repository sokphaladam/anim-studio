import type { ReactNode } from "react";
import { cx } from "./cx";

export interface PickerCard<V extends string> {
  value: V;
  label: string;
  /** Picture area: an <img>, a canvas, or a swatch. */
  art: ReactNode;
  note?: string;
}

/** A grid of picture cards where exactly one is chosen (art styles, templates). Arrow keys move between cards. */
export function CardPicker<V extends string>({ label, cards, value, onChange, columns = 4 }: { label: string; cards: PickerCard<V>[]; value: V; onChange: (v: V) => void; columns?: number }) {
  const move = (from: number, by: number) => {
    const next = cards[(from + by + cards.length) % cards.length];
    onChange(next.value);
    document.getElementById(`card-${next.value}`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {cards.map((c, i) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            id={`card-${c.value}`}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(c.value)}
            onKeyDown={(e) => {
              const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (by) {
                e.preventDefault();
                move(i, by);
              }
            }}
            className={cx("overflow-hidden rounded-md border-2 bg-panel text-left transition-ui", on ? "border-accent" : "border-line hover:border-line-strong")}
          >
            <div className="aspect-[16/10] overflow-hidden bg-surround">{c.art}</div>
            <div className="px-2 py-1.5">
              <div className="truncate text-sm font-semibold" title={c.label}>{c.label}</div>
              {c.note && <div className="truncate text-micro text-accent">{c.note}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
