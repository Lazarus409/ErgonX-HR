"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "strong" | "accent" | "secondary" | "ghost" | "danger" | "link" | "inverse";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-standard active:opacity-90 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  // Phase 2 (Stitch): page actions are midnight; royal blue is kept for focus,
  // links, selection and the active navigation item.
  primary: "bg-cta-strong text-white shadow-elevation-1 hover:bg-cta-strong-hover",
  strong: "bg-cta-strong text-white shadow-elevation-1 hover:bg-cta-strong-hover",
  // Conversion-funnel emphasis (e.g. "Save & post") where royal blue is wanted.
  accent: "bg-primary text-white shadow-elevation-1 hover:bg-primary-hover active:bg-primary-active",
  // White surface, slate border, dark text.
  secondary: "border border-line bg-surface text-ink-strong shadow-elevation-1 hover:border-line-strong hover:bg-surface-hover",
  ghost: "text-ink hover:bg-surface-hover hover:text-ink-strong",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-soft",
  link: "h-auto px-0 text-primary-ink underline-offset-4 hover:underline active:opacity-100",
  inverse: "bg-white/10 text-white ring-1 ring-inset ring-white/20 hover:bg-white/16",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 rounded-lg px-3 text-support font-semibold",
  md: "h-9 rounded-lg px-4 text-sm font-semibold",
  lg: "h-11 rounded-lg px-5 text-[0.9375rem] font-semibold",
};

export function buttonClasses({ variant = "primary", size = "md", block = false, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}): string {
  return cx(base, variants[variant], variant === "link" ? "text-sm" : sizes[size], block && "w-full", className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Replaces the label while `loading` (e.g. "Saving…"). */
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, loadingLabel, leadingIcon, trailingIcon, block, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-ui="button"
      className={buttonClasses({ variant, size, block, className })}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leadingIcon}
      {loading && loadingLabel ? loadingLabel : children}
      {!loading && trailingIcon}
    </button>
  );
});

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
}

/** A navigation link styled as a button. */
export function ButtonLink({ variant = "primary", size = "md", leadingIcon, trailingIcon, block, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link data-ui="button" className={buttonClasses({ variant, size, block, className })} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible name; also used as the tooltip. */
  label: string;
  variant?: "ghost" | "secondary" | "primary" | "danger" | "inverse";
  size?: ButtonSize;
  loading?: boolean;
  showTooltip?: boolean;
}

const iconSizes: Record<ButtonSize, string> = { sm: "h-8 w-8 rounded-lg", md: "h-10 w-10 rounded-lg", lg: "h-12 w-12 rounded-lg" };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", loading, showTooltip = false, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={showTooltip ? undefined : label}
      disabled={disabled || loading}
      data-ui="icon-button"
      className={cx(base, variants[variant], iconSizes[size], "group/icon relative px-0", variant === "ghost" && "text-ink-muted", className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : children}
      {showTooltip && (
        <span role="tooltip" className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-brand-navy-deep px-2.5 py-1.5 text-caption font-medium text-white opacity-0 shadow-elevation-2 transition-opacity duration-150 group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100">
          {label}
        </span>
      )}
    </button>
  );
});

export default Button;
