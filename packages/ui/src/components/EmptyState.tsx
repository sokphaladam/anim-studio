import type { ReactNode } from "react";

/** Centered message with optional actions, for empty, loading and error panel states. */
export function EmptyState({ icon, title, children, actions, tone = "neutral" }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; tone?: "neutral" | "danger" }) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-4 text-center">
      {icon && <div className={tone === "danger" ? "text-danger" : "text-fg-3"}>{icon}</div>}
      <p className="text-base text-fg-2">{title}</p>
      {children && <p className="max-w-72 text-sm text-fg-3">{children}</p>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
