import * as T from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export function Tabs({ tabs, defaultValue, label }: { tabs: { value: string; label: string; content: ReactNode }[]; defaultValue?: string; label: string }) {
  return (
    <T.Root defaultValue={defaultValue ?? tabs[0]?.value} className="flex min-h-0 flex-col">
      <T.List aria-label={label} className="flex h-8 shrink-0 gap-1 border-b border-line px-1">
        {tabs.map((t) => (
          <T.Trigger key={t.value} value={t.value} className="relative px-2 text-sm text-fg-3 transition-ui hover:text-fg data-[state=active]:text-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent">
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
      {tabs.map((t) => (
        <T.Content key={t.value} value={t.value} className="min-h-0 flex-1 overflow-auto outline-none">
          {t.content}
        </T.Content>
      ))}
    </T.Root>
  );
}
