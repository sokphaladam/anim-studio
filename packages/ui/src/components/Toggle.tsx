import * as T from "@radix-ui/react-toggle";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";

/** On/off button (loop, visibility, lock…). */
export function Toggle({ pressed, onPressedChange, label, shortcut, icon, children, disabled }: { pressed: boolean; onPressedChange: (p: boolean) => void; label: string; shortcut?: string; icon?: ReactNode; children?: ReactNode; disabled?: boolean }) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <T.Root
        pressed={pressed}
        onPressedChange={onPressedChange}
        disabled={disabled}
        aria-label={children ? undefined : label}
        className={cx(
          "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-sm px-1 text-sm transition-ui disabled:pointer-events-none disabled:opacity-40",
          pressed ? "bg-accent-soft text-accent" : "text-fg-3 hover:bg-hover hover:text-fg",
        )}
      >
        {icon}
        {children}
      </T.Root>
    </Tooltip>
  );
}
