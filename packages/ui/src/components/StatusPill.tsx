import type { ReactNode } from "react";
import { cx } from "./cx";

const dot = { ok: "bg-success", warn: "bg-warning", error: "bg-danger", pending: "bg-fg-3 animate-pulse" } as const;

/** Small rounded status indicator, e.g. "Local AI ready: qwen2.5-coder:14b". */
export function StatusPill({ status, children, title }: { status: keyof typeof dot; children: ReactNode; title?: string }) {
  return (
    <span role="status" title={title} className="inline-flex h-6 max-w-full items-center gap-2 rounded-full border border-line bg-raised px-2.5 text-sm text-fg-2">
      <span className={cx("size-2 shrink-0 rounded-full", dot[status])} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}
