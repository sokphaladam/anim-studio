import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";

type Variant = "primary" | "secondary" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover active:brightness-90",
  secondary: "bg-raised text-fg hover:bg-hover active:bg-line-strong",
  ghost: "bg-transparent text-fg-2 hover:bg-hover hover:text-fg active:bg-raised",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 28 | 32;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = 32, icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm font-semibold whitespace-nowrap select-none transition-ui",
        "disabled:pointer-events-none disabled:opacity-40",
        size === 28 ? "h-7 px-2 text-sm" : "h-8 px-3 text-base",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  /** Selected state (e.g. the current tool). */
  active?: boolean;
  size?: 28 | 32 | 36;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

/** Square icon button; always has a tooltip with its name and shortcut. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, shortcut, icon, active, size = 28, tooltipSide, className, ...rest }, ref) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cx(
          "inline-flex shrink-0 items-center justify-center rounded-sm transition-ui disabled:pointer-events-none disabled:opacity-40",
          size === 36 ? "size-9" : size === 32 ? "size-8" : "size-7",
          active ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-hover hover:text-fg active:bg-raised",
          className,
        )}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  );
});
