import * as D from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import type { MenuGroup } from "./Menu";
import { Shortcut } from "./Menu";

/** Ctrl+K palette: runs any menu action by name. */
export function CommandPalette({ open, onOpenChange, menus }: { open: boolean; onOpenChange: (o: boolean) => void; menus: MenuGroup[] }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <D.Content className="float fixed top-[20vh] left-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden outline-none">
          <D.Title className="sr-only">Command palette</D.Title>
          <D.Description className="sr-only">Type to search every action</D.Description>
          <Command label="Command palette" loop>
            <Command.Input autoFocus placeholder="Type a command…" className="h-11 w-full border-b border-line bg-transparent px-4 text-title outline-none placeholder:text-fg-3" />
            <Command.List className="max-h-80 overflow-auto p-1">
              <Command.Empty className="p-4 text-center text-fg-3">No matching command</Command.Empty>
              {menus.map((g) => (
                <Command.Group key={g.label} heading={g.label} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:text-fg-3">
                  {g.items.map((it) =>
                    it === "separator" ? null : (
                      <Command.Item
                        key={it.id}
                        value={`${g.label} ${it.label}`}
                        disabled={it.disabled}
                        onSelect={() => {
                          onOpenChange(false);
                          it.run();
                        }}
                        className="flex h-8 cursor-default items-center gap-2 rounded-sm px-2 data-[disabled=true]:opacity-40 data-[selected=true]:bg-hover"
                      >
                        {it.label}
                        {it.hint && <span className="text-micro text-fg-3">{it.hint}</span>}
                        {it.shortcut && <Shortcut>{it.shortcut}</Shortcut>}
                      </Command.Item>
                    ),
                  )}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
