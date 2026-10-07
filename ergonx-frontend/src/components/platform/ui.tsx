import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * Building blocks for the Super Admin console. The console keeps its own
 * look — floating cards, a navy hero, eyebrowed section titles — on top of
 * the shared semantic colour roles, so light and dark mode both work.
 */

/**
 * Small all-caps field label. Sized in rem on purpose: the design system's legacy
 * bridge turns `.text-xs.uppercase` inside <main> back into sentence case.
 */
export const platformFieldLabel = "mb-2 block text-[0.75rem] font-bold uppercase tracking-[0.12em] text-ink-muted";

/** Solid navy action surface; navy disappears on the dark canvas, so dark mode uses primary. */
export const platformSolid = "bg-brand-navy-deep text-white dark:bg-primary";

export const platformCard = "rounded-3xl border border-line bg-surface shadow-[0_12px_35px_rgb(15_23_42/0.04)]";

/** Applied to <DataTable> so console tables match the console cards. */
export const platformTable = cx(
  "rounded-3xl shadow-[0_12px_35px_rgb(15_23_42/0.04)]",
  "[&>div:first-child]:px-6 [&>div:first-child]:py-5",
  // Buttons (sortable headers) don't inherit text-transform, so they are targeted too.
  "[&_thead_th]:px-6 [&_thead_th]:py-4 [&_thead_th]:text-[0.6875rem] [&_thead_th]:font-bold [&_thead_th]:uppercase [&_thead_th]:tracking-[0.12em] [&_thead_th_button]:uppercase [&_thead_th]:whitespace-nowrap",
  "[&_tbody_td]:px-6 [&_tbody_td]:py-4",
);

export function PlatformHero({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-brand-navy-deep px-6 py-8 text-white shadow-[0_24px_55px_rgb(15_23_42/0.18)] sm:px-9 lg:py-10">
      <div aria-hidden="true" className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-sky/20 blur-3xl" />
      <div aria-hidden="true" className="absolute bottom-0 right-28 h-36 w-36 rounded-full border border-accent-sky/20" />
      <div className="relative">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">{subtitle}</p>}
        {children}
      </div>
    </section>
  );
}

const statTones = {
  sky: "bg-info-soft text-info-ink",
  amber: "bg-warning-soft text-warning-ink",
  emerald: "bg-success-soft text-success-ink",
  rose: "bg-danger-soft text-danger-ink",
  violet: "bg-mod-recruitment-soft text-mod-recruitment",
} as const;

export function StatTile({ label, value, icon: Icon, tone = "sky", hint }: { label: string; value: ReactNode; icon: LucideIcon; tone?: keyof typeof statTones; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-[0_10px_25px_rgb(15_23_42/0.035)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-ink-muted">{label}</p>
        <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", statTones[tone])} aria-hidden="true"><Icon className="h-5 w-5" /></span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-ink-strong tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-caption text-ink-muted">{hint}</p>}
    </div>
  );
}

/** Eyebrow + title block used at the top of console cards and table toolbars. */
export function SectionTitle({ eyebrow, title, description, meta, className }: { eyebrow: ReactNode; title: ReactNode; description?: ReactNode; meta?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col justify-between gap-3 sm:flex-row sm:items-center", className)}>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-primary-ink">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-headline">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-ink-muted">{description}</p>}
      </div>
      {meta && <div className="shrink-0 text-sm text-ink-muted">{meta}</div>}
    </div>
  );
}

export function PlatformCard({ eyebrow, title, description, icon: Icon, actions, children, className }: { eyebrow: ReactNode; title: ReactNode; description?: ReactNode; icon?: LucideIcon; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cx(platformCard, "p-5 sm:p-7", className)}>
      <div className="flex items-start gap-4">
        {Icon && <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-navy-deep text-accent-sky dark:bg-primary-soft dark:text-primary-ink" aria-hidden="true"><Icon className="h-5 w-5" /></span>}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-primary-ink">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-headline">{title}</h2>
          {description && <p className="mt-1 text-sm leading-6 text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}
