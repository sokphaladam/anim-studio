import { IconButton } from "@anim/ui";
import { useStudio } from "../store";
import { TOOLS } from "./tools";

export function Toolbox() {
  const tool = useStudio((s) => s.tool);
  const set = useStudio((s) => s.set);
  return (
    <nav aria-label="Tools" className="flex w-(--toolbox-w) shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-1">
      {TOOLS.map((t) => (
        <IconButton key={t.id} size={36} tooltipSide="right" label={t.label} shortcut={t.key} active={tool === t.id} icon={<t.icon size={20} strokeWidth={1.5} />} onClick={() => set({ tool: t.id })} />
      ))}
    </nav>
  );
}
