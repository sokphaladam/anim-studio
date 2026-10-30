import { Dialog } from "./Dialog";
import type { MenuGroup } from "./Menu";

export const Kbd = ({ children }: { children: string }) => <kbd className="rounded-sm border border-line-strong bg-raised px-1.5 py-0.5 font-mono text-micro text-fg-2">{children}</kbd>;

/** "?" sheet listing every action that has a shortcut, plus extra view gestures. */
export function ShortcutSheet({ open, onOpenChange, menus, extra = [] }: { open: boolean; onOpenChange: (o: boolean) => void; menus: MenuGroup[]; extra?: { label: string; keys: string }[] }) {
  const groups = [...menus.map((m) => ({ label: m.label, rows: m.items.flatMap((i) => (i !== "separator" && i.shortcut && !i.disabled ? [{ label: i.label, keys: i.shortcut }] : [])) })), { label: "Canvas", rows: extra }].filter((g) => g.rows.length);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="mb-1 text-sm font-semibold text-fg-2">{g.label}</h3>
            <ul>
              {g.rows.map((r) => (
                <li key={r.label} className="flex h-7 items-center justify-between gap-4 text-base">
                  <span className="truncate">{r.label}</span>
                  <Kbd>{r.keys}</Kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
