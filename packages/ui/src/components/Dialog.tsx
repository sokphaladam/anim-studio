import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";
import { cx } from "./cx";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Modal dialog with title, close button, body and footer. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=open]:animate-[fade-in_var(--dur-dialog)_var(--ease)]" />
        <D.Content
          // focus the dialog itself, not the close button (which would pop its tooltip and eat the first Esc)
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          className={cx("float fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(560px,92vw)] -translate-1/2 flex-col outline-none data-[state=open]:animate-[dialog-in_var(--dur-dialog)_var(--ease)]", className)}>
          <header className="flex items-start gap-4 p-4 pb-2">
            <div className="min-w-0 flex-1">
              <D.Title className="text-dialog font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-base text-fg-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <IconButton label="Close" shortcut="Esc" icon={<X size={16} strokeWidth={1.5} />} />
            </D.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line p-3">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
