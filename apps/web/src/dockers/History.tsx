import { EmptyState, cx } from "@anim/ui";
import { History as HistoryIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStudio } from "../store";

/** Every undoable step; click one to jump there. */
export function HistoryDocker() {
  const { past, future, travel } = useStudio(useShallow((s) => ({ past: s.past, future: s.future, travel: s.travel })));
  if (!past.length && !future.length) return <EmptyState icon={<HistoryIcon size={20} strokeWidth={1.5} />} title="No changes yet">Every drawing and edit appears here; Ctrl+Z undoes it.</EmptyState>;
  const items = [{ label: "Opened scene", pos: -past.length }, ...past.map((e, i) => ({ label: e.label, pos: i + 1 - past.length })), ...[...future].reverse().map((e, i) => ({ label: e.label, pos: i + 1 }))];
  return (
    <ol aria-label="History" className="py-1">
      {items.map((it, i) => (
        <li key={i}>
          <button
            type="button"
            aria-current={it.pos === 0 ? "step" : undefined}
            onClick={() => travel(it.pos)}
            className={cx("flex h-7 w-full items-center truncate px-3 text-left text-sm transition-ui hover:bg-hover", it.pos === 0 ? "bg-accent-soft text-fg" : it.pos > 0 ? "text-fg-3 italic" : "text-fg-2")}
            title={it.label}
          >
            {it.label}
          </button>
        </li>
      ))}
    </ol>
  );
}
