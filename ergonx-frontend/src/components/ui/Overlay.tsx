"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cx } from "@/lib/cx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Traps focus inside `ref`, closes on Escape, locks body scroll, restores focus. */
function useModalBehaviour(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open, ref]);
}

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/* -------------------------------------------------------------------------- */
/* Dialog                                                                      */
/* -------------------------------------------------------------------------- */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Prevent closing via backdrop/Escape (e.g. while saving). */
  dismissible?: boolean;
  icon?: ReactNode;
}

const dialogSizes = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export function Dialog({ open, onClose, title, description, children, footer, size = "md", dismissible = true, icon }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = useCallback(() => { if (dismissible) onClose(); }, [dismissible, onClose]);
  useModalBehaviour(open, ref, close);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[150] flex items-end justify-center p-0 sm:items-center sm:p-4">
        <div className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]" onClick={close} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx("relative flex max-h-[92vh] w-full animate-slide-up flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-overlay outline-none sm:rounded-3xl", dialogSizes[size])}
        >
          <div className="flex items-start gap-4 px-6 pb-2 pt-6">
            {icon}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-heading font-bold text-headline">{title}</h2>
              {description && <p id={descriptionId} className="mt-1 text-support text-ink-muted">{description}</p>}
            </div>
            {dismissible && (
              <button type="button" onClick={onClose} aria-label="Close dialog" className="-mr-2 -mt-1 rounded-xl p-2 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-strong">
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
          {children && <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>}
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-line-soft bg-surface-muted/50 px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Drawer                                                                      */
/* -------------------------------------------------------------------------- */

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left";
  width?: "sm" | "md" | "lg";
}

export function Drawer({ open, onClose, title, description, children, footer, side = "right", width = "md" }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehaviour(open, ref, onClose);
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 z-[140]">
        <div className="absolute inset-0 animate-fade-in bg-overlay" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={cx(
            "absolute inset-y-0 flex w-full flex-col border-line bg-surface shadow-overlay outline-none",
            side === "right" ? "right-0 border-l" : "left-0 border-r",
            { sm: "max-w-sm", md: "max-w-md", lg: "max-w-2xl" }[width],
          )}
          style={{ animation: `${side === "right" ? "drawer-in-right" : "drawer-in-left"} var(--duration-emphasis) var(--ease-standard) both` }}
        >
          <div className="flex items-start gap-4 border-b border-line-soft px-6 py-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-heading font-bold text-headline">{title}</h2>
              {description && <p className="mt-1 text-support text-ink-muted">{description}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close panel" className="-mr-2 rounded-xl p-2 text-ink-muted hover:bg-surface-hover hover:text-ink-strong"><X className="h-5 w-5" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line-soft px-6 py-4">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/* -------------------------------------------------------------------------- */
/* Popover / Menu                                                              */
/* -------------------------------------------------------------------------- */

export interface PopoverProps {
  /** Render prop for the trigger; spread `props` onto the trigger button. */
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" | "dialog"; "aria-controls": string }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  width?: string;
  role?: "menu" | "dialog";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  label?: string;
}

export function Popover({ trigger, children, align = "end", width = "w-72", role = "dialog", className, open: controlledOpen, onOpenChange, label }: PopoverProps) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = useCallback((next: boolean) => { onOpenChange?.(next); if (controlledOpen === undefined) setUncontrolled(next); }, [controlledOpen, onOpenChange]);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); (rootRef.current?.querySelector("[aria-haspopup]") as HTMLElement | null)?.focus(); } };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, setOpen]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (role !== "menu" || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next].focus();
  };

  const close = () => setOpen(false);
  return (
    <div ref={rootRef} className="relative">
      {trigger({ onClick: () => setOpen(!open), "aria-expanded": open, "aria-haspopup": role, "aria-controls": panelId })}
      {open && (
        <div
          id={panelId}
          role={role}
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cx("absolute top-[calc(100%+8px)] z-50 origin-top animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay", align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left", width, className)}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function Menu(props: Omit<PopoverProps, "role">) {
  return <Popover {...props} role="menu" width={props.width ?? "w-56"} />;
}

export function MenuItem({ children, onSelect, icon, tone = "default", disabled, description }: { children: ReactNode; onSelect: () => void; icon?: ReactNode; tone?: "default" | "danger"; disabled?: boolean; description?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium outline-none transition-colors focus-visible:bg-surface-hover disabled:opacity-50",
        tone === "danger" ? "text-danger-ink hover:bg-danger-soft" : "text-ink hover:bg-surface-hover hover:text-ink-strong",
      )}
    >
      {icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current opacity-80 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && <span className="block truncate text-caption font-normal text-ink-muted">{description}</span>}
      </span>
    </button>
  );
}

export function MenuSection({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-line-soft p-1.5 first:border-t-0" role="none">
      {label && <p className="px-3 pb-1 pt-2 text-caption font-semibold text-ink-subtle" role="presentation">{label}</p>}
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Hover/focus tooltip. The trigger should already carry an accessible name;
 * the tooltip text is exposed via aria-describedby.
 */
export function Tooltip({ content, children, side = "top", className }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "right" | "left"; className?: string }) {
  const id = useId();
  const position = {
    top: "bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2",
    bottom: "top-[calc(100%+8px)] left-1/2 -translate-x-1/2",
    right: "left-[calc(100%+10px)] top-1/2 -translate-y-1/2",
    left: "right-[calc(100%+10px)] top-1/2 -translate-y-1/2",
  }[side];
  return (
    <span className={cx("group/tooltip relative inline-flex", className)} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cx("pointer-events-none absolute z-[160] w-max max-w-64 rounded-lg bg-brand-navy-deep px-2.5 py-1.5 text-caption font-medium text-white opacity-0 shadow-elevation-2 transition-opacity duration-150 group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100", position)}
      >
        {content}
      </span>
    </span>
  );
}

/** Truncates long text with the full value available as a tooltip. */
export function Truncate({ text, className }: { text: string; className?: string }) {
  return <span className={cx("block min-w-0 truncate", className)} title={text}>{text}</span>;
}
