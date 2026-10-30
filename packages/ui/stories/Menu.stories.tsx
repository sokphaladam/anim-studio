import type { Meta } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button, CommandPalette, ContextMenu, Dropdown, MenuBar, ShortcutSheet, type MenuGroup } from "../src";

export default { title: "Core/Menus" } satisfies Meta;

const noop = () => {};
const menus: MenuGroup[] = [
  { label: "File", items: [{ id: "new", label: "New scene", shortcut: "Ctrl+N", run: noop }, "separator", { id: "exp", label: "Export MP4…", disabled: true, hint: "Milestone 5", run: noop }] },
  { label: "Edit", items: [{ id: "undo", label: "Undo", shortcut: "Ctrl+Z", run: noop }, { id: "redo", label: "Redo", shortcut: "Ctrl+Shift+Z", run: noop }] },
  { label: "View", items: [{ id: "loop", label: "Loop playback", checked: true, run: noop }] },
];

export const Bar = () => <div className="w-[600px]"><MenuBar menus={menus} end={<span className="text-sm text-fg-3">end slot</span>} /></div>;
export const DropdownMenu = () => <Dropdown label="Options" trigger={<Button icon={<ChevronDown size={16} />}>Options</Button>} items={menus[0].items.filter((i) => i !== "separator")} />;
export const Context = () => (
  <ContextMenu items={[{ id: "r", label: "Rename", run: noop }, { id: "d", label: "Delete", shortcut: "Del", run: noop }]}>
    <div className="grid h-32 w-64 place-items-center rounded-md border border-dashed border-line-strong text-fg-3">Right-click here</div>
  </ContextMenu>
);
export const Palette = () => {
  const [o, setO] = useState(true);
  return <><Button onClick={() => setO(true)}>Open palette</Button><CommandPalette open={o} onOpenChange={setO} menus={menus} /></>;
};
export const Shortcuts = () => {
  const [o, setO] = useState(true);
  return <><Button onClick={() => setO(true)}>Open shortcuts</Button><ShortcutSheet open={o} onOpenChange={setO} menus={menus} extra={[{ label: "Pan", keys: "Space+drag" }]} /></>;
};
