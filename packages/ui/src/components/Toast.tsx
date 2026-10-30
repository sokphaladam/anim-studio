import * as T from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cx } from "./cx";

type Tone = "info" | "success" | "warning" | "danger";
type Toast = { id: number; title: string; description?: string; tone: Tone };
const Ctx = createContext<(t: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => void>(() => {});
const toneCls: Record<Tone, string> = { info: "border-l-fg-3", success: "border-l-success", warning: "border-l-warning", danger: "border-l-danger" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => setToasts((l) => [...l, { tone: "info", ...t, id: Date.now() + Math.random() }]), []);
  return (
    <T.Provider swipeDirection="right" duration={4000}>
      <Ctx.Provider value={push}>{children}</Ctx.Provider>
      {toasts.map((t) => (
        <T.Root key={t.id} onOpenChange={(o) => !o && setToasts((l) => l.filter((x) => x.id !== t.id))} className={cx("float rounded-md! border-l-4 p-3 data-[state=open]:animate-[dialog-in_var(--dur-panel)_var(--ease)]", toneCls[t.tone])}>
          <T.Title className="text-base font-semibold">{t.title}</T.Title>
          {t.description && <T.Description className="mt-1 text-sm text-fg-2">{t.description}</T.Description>}
        </T.Root>
      ))}
      <T.Viewport className="fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2 outline-none" />
    </T.Provider>
  );
}

export const useToast = () => useContext(Ctx);
