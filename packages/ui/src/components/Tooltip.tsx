import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={400} skipDelayDuration={200}>{children}</T.Provider>
);

/** Tooltip showing a name and an optional shortcut, e.g. "Brush (B)". */
export function Tooltip({ label, shortcut, side = "bottom", children }: { label: ReactNode; shortcut?: string; side?: "top" | "bottom" | "left" | "right"; children: ReactNode }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="float z-50 rounded-sm! px-2 py-1 text-sm text-fg shadow-float">
          {label}
          {shortcut && <span className="ml-2 font-mono text-micro text-fg-3">{shortcut}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
