import * as DM from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cx } from "./cx";
import { menuContentCls, menuItemCls } from "./Menu";

export interface PanelProps {
  title: string;
  children: ReactNode;
  /** Items for the overflow (…) menu. */
  menu?: { label: string; onSelect: () => void }[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** Hide the header when a host (e.g. the dock) already shows the title. */
  headless?: boolean;
  className?: string;
}

/** Docker surface: header with title, collapse chevron and overflow menu, then a scrolling body. */
export function Panel({ title, children, menu, collapsible = true, defaultCollapsed, headless, className }: PanelProps) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  return (
    <section aria-label={title} className={cx("flex min-h-0 flex-col bg-panel", !collapsed && "h-full", className)}>
      {!headless && (
        <header className="flex h-8 shrink-0 items-center gap-1 border-b border-line pr-1 pl-2">
          {collapsible && (
            <button type="button" aria-expanded={!collapsed} aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`} onClick={() => setCollapsed(!collapsed)} className="rounded-sm text-fg-3 transition-ui hover:text-fg">
              <ChevronDown size={16} strokeWidth={1.5} className={cx("transition-transform duration-(--dur-panel)", collapsed && "-rotate-90")} />
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-2" title={title}>
            {title}
          </h2>
          {menu && (
            <DM.Root>
              <DM.Trigger aria-label={`${title} options`} className="rounded-sm p-1 text-fg-3 transition-ui hover:bg-hover hover:text-fg">
                <MoreHorizontal size={16} strokeWidth={1.5} />
              </DM.Trigger>
              <DM.Portal>
                <DM.Content sideOffset={4} align="end" className={menuContentCls}>
                  {menu.map((m) => (
                    <DM.Item className={menuItemCls} key={m.label} onSelect={m.onSelect}>
                      {m.label}
                    </DM.Item>
                  ))}
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          )}
        </header>
      )}
      {!collapsed && <div className="min-h-0 flex-1 overflow-auto">{children}</div>}
    </section>
  );
}
