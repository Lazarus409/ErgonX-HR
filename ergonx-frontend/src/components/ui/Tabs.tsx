"use client";

import Link from "next/link";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "@/lib/cx";

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
  href?: string;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange?: (value: string) => void;
  /** `underline` for page sections, `pill` for compact segmented filters. */
  variant?: "underline" | "pill";
  label: string;
  className?: string;
}

/**
 * Accessible tab list (roving focus, arrow keys). Items with `href` render
 * as links for route-based tabs; others call `onChange` for in-page panels.
 */
export default function Tabs({ items, value, onChange, variant = "underline", label, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"])') ?? []);
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    tabs[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx(
        "flex max-w-full overflow-x-auto",
        variant === "underline" ? "gap-6 border-b border-line" : "w-fit gap-1 rounded-xl bg-surface-muted p-1",
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const classes = cx(
          "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold outline-none transition-colors duration-150",
          variant === "underline"
            ? cx("h-12 px-1 text-[0.9375rem]", selected ? "text-primary-ink" : "text-ink-muted hover:text-ink-strong")
            : cx("h-8 rounded-lg px-3", selected ? "bg-surface text-ink-strong shadow-elevation-1" : "text-ink-muted hover:text-ink-strong"),
          item.disabled && "pointer-events-none opacity-50",
        );
        const inner = (
          <>
            {item.label}
            {item.count !== undefined && (
              <span className={cx("rounded-full px-1.5 py-px text-caption tabular-nums", selected ? "bg-primary-soft text-primary-ink" : "bg-surface-muted text-ink-muted")}>{item.count}</span>
            )}
            {variant === "underline" && (
              <span aria-hidden="true" className={cx("absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary transition-transform duration-200 ease-standard", selected ? "scale-x-100" : "scale-x-0")} />
            )}
          </>
        );
        const common = {
          role: "tab" as const,
          id: `${baseId}-${item.value}`,
          "aria-selected": selected,
          "aria-disabled": item.disabled || undefined,
          tabIndex: selected ? 0 : -1,
          className: classes,
        };
        return item.href ? (
          <Link key={item.value} href={item.href} {...common}>{inner}</Link>
        ) : (
          <button key={item.value} type="button" onClick={() => onChange?.(item.value)} {...common}>{inner}</button>
        );
      })}
    </div>
  );
}

export { Tabs };
