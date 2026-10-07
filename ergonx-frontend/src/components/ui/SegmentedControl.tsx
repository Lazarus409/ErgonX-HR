"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "@/lib/cx";

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: ReactNode;
}

/**
 * Compact single-choice filter for a handful of options (status, period,
 * view). A radio group underneath: one tab stop, arrow keys move and select.
 * Use a <Select> once there are more than about five options.
 */
export function SegmentedControl<Value extends string>({ value, onChange, options, label, className }: { value: Value; onChange: (value: Value) => void; options: SegmentedOption<Value>[]; label: string; className?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex h-9 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-surface-muted p-0.5", className)}>
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cx(
              "h-[30px] shrink-0 whitespace-nowrap rounded-md px-3 text-support font-medium transition-[background-color,color,box-shadow] duration-150 ease-standard",
              active ? "bg-surface text-ink-strong shadow-elevation-1 ring-1 ring-line" : "text-ink-muted hover:text-ink-strong",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
