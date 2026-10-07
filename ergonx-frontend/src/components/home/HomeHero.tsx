import type { ReactNode } from "react";

import { textOf } from "@/components/ui/Card";
import { cx } from "@/lib/cx";

/**
 * Greeting header for Home / Employee Home / guided setup. Follows the
 * concept's light page header: date or context line, a large royal-blue title,
 * a blue supporting line, then compact stat tiles. `aside` renders as the soft
 * blue context panel on the right (e.g. "Continue where you left off").
 */
export default function HomeHero({ eyebrow, title, subtitle, children, aside, className }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; children?: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <section className={cx("relative grid gap-6", aside && "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-support font-semibold text-primary-ink">{eyebrow}</p>}
        <h1 className="mt-1 text-balance text-[2rem] font-bold leading-tight tracking-tight text-headline sm:text-display">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[1.0625rem] leading-7 text-heading-support">{subtitle}</p>}
        {children && <div className="mt-6">{children}</div>}
      </div>
      {aside && <div className="min-w-0">{aside}</div>}
    </section>
  );
}

/** Soft blue context panel used as a HomeHero aside. */
export const heroPanelClass = "block rounded-2xl border border-primary/15 bg-primary-soft/70 p-5 text-ink";

/** Compact stat tile shown under the greeting. */
export function HeroStat({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "attention" }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-elevation-1">
      <p className={cx("font-bold tabular-nums", textOf(value).length > 9 ? "break-words text-[0.9375rem] leading-6 sm:whitespace-nowrap sm:text-heading sm:leading-7" : "text-heading sm:text-kpi-sm", tone === "attention" ? "text-warning-ink" : "text-headline")}>{value}</p>
      <p className="mt-0.5 line-clamp-2 text-caption leading-tight text-ink-muted">{label}</p>
    </div>
  );
}
