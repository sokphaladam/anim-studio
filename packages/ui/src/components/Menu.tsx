import * as MB from "@radix-ui/react-menubar";
import * as CM from "@radix-ui/react-context-menu";
import * as DM from "@radix-ui/react-dropdown-menu";
import { forwardRef, type ReactNode } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";

export const menuContentCls = "float z-50 min-w-48 p-1 text-base text-fg outline-none";
export const menuItemCls =
  "flex h-7 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40";

export const Shortcut = ({ children }: { children: ReactNode }) => <span className="ml-auto pl-6 font-mono text-micro text-fg-3">{children}</span>;

export interface MenuAction {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  /** Why the action is unavailable, shown next to it. */
  hint?: string;
  checked?: boolean;
  run: () => void;
}
export interface MenuGroup {
  label: string;
  items: (MenuAction | "separator")[];
}

/** The app menu bar: File, Edit, View… */
export function MenuBar({ menus, className, end }: { menus: MenuGroup[]; className?: string; end?: ReactNode }) {
  return (
    <MB.Root className={cx("flex h-8 shrink-0 items-center gap-0.5 border-b border-line bg-panel px-1", className)}>
      {menus.map((m) => (
        <MB.Menu key={m.label}>
          <MB.Trigger className="h-6 rounded-sm px-2 text-base text-fg-2 outline-none transition-ui select-none hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg">
            {m.label}
          </MB.Trigger>
          <MB.Portal>
            <MB.Content sideOffset={4} align="start" className={menuContentCls}>
              {m.items.map((it, i) =>
                it === "separator" ? (
                  <MB.Separator key={i} className="my-1 h-px bg-line" />
                ) : (
                  <MB.Item className={menuItemCls} key={it.id} disabled={it.disabled} onSelect={it.run}>
                    <span className="w-3 text-accent" aria-hidden>{it.checked ? "✓" : ""}</span>
                    <span className="truncate">{it.label}</span>
                    {it.hint && <span className="text-micro text-fg-3">{it.hint}</span>}
                    {it.shortcut && <Shortcut>{it.shortcut}</Shortcut>}
                  </MB.Item>
                ),
              )}
            </MB.Content>
          </MB.Portal>
        </MB.Menu>
      ))}
      {end && <div className="ml-auto flex items-center gap-2 pr-1">{end}</div>}
    </MB.Root>
  );
}

/** Right-click menu around any element. */
export function ContextMenu({ items, children }: { items: MenuAction[]; children: ReactNode }) {
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content sideOffset={4} className={menuContentCls}>
          {items.map((it) => (
            <CM.Item className={menuItemCls} key={it.id} disabled={it.disabled} onSelect={it.run}>
              {it.label}
              {it.shortcut && <Shortcut>{it.shortcut}</Shortcut>}
            </CM.Item>
          ))}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

/** Button that opens a list of actions. */
export const Dropdown = forwardRef<HTMLButtonElement, { trigger: ReactNode; items: MenuAction[]; label: string }>(function Dropdown({ trigger, items, label }, ref) {
  return (
    <DM.Root>
      <Tooltip label={label}>
        <DM.Trigger ref={ref} aria-label={label} asChild>
          {trigger}
        </DM.Trigger>
      </Tooltip>
      <DM.Portal>
        <DM.Content sideOffset={4} align="start" className={menuContentCls}>
          {items.map((it) => (
            <DM.Item className={menuItemCls} key={it.id} disabled={it.disabled} onSelect={it.run}>
              <span className="w-3 text-accent" aria-hidden>{it.checked ? "✓" : ""}</span>
              {it.label}
              {it.shortcut && <Shortcut>{it.shortcut}</Shortcut>}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
});
