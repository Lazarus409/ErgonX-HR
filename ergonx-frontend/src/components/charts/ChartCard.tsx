"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { BarChart3, type LucideIcon } from "lucide-react";

import { ChartSkeleton } from "@/components/ui/Skeleton";
import { cx } from "@/lib/cx";
import type { ModuleAccent } from "@/lib/moduleTheme";
import { formatValue, type ValueFormat } from "@/components/charts/format";

/* -------------------------------------------------------------------------- */
/* Reduced motion                                                              */
/* -------------------------------------------------------------------------- */

function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Chart entrance animation is disabled for users who prefer reduced motion. */
export function useChartAnimation(): boolean {
  return useSyncExternalStore(subscribeMotion, () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false);
}

/* -------------------------------------------------------------------------- */
/* Legend / tooltip                                                            */
/* -------------------------------------------------------------------------- */

export interface LegendItem {
  label: string;
  color: string;
  value?: ReactNode;
  /** Line series render as a short stroke rather than a dot. */
  shape?: "dot" | "line" | "square";
}

export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  if (!items.length) return null;
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)} aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5 text-caption text-ink-muted">
          <span aria-hidden="true" className={cx("shrink-0", item.shape === "line" ? "h-0.5 w-3.5 rounded-full" : item.shape === "square" ? "h-2.5 w-2.5 rounded-[3px]" : "h-2 w-2 rounded-full")} style={{ background: item.color }} />
          <span className="font-medium text-ink">{item.label}</span>
          {item.value !== undefined && <span className="font-semibold text-ink-strong tabular-nums">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

interface TooltipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
  payload?: Record<string, unknown>;
}

/** Token-styled Recharts tooltip content. */
export function ChartTooltip({ active, payload, label, format = "number", currency, labelFormat }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: unknown; format?: ValueFormat; currency?: string; labelFormat?: (value: unknown) => string }) {
  if (!active || !payload?.length) return null;
  const heading = labelFormat ? labelFormat(label) : label !== undefined ? String(label) : undefined;
  return (
    <div className="min-w-40 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-overlay">
      {heading && <p className="mb-1.5 text-caption font-semibold text-ink-strong">{heading}</p>}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li key={`${String(entry.dataKey ?? entry.name)}-${index}`} className="flex items-center justify-between gap-4 text-caption">
            <span className="inline-flex items-center gap-1.5 text-ink-muted">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="font-semibold text-ink-strong tabular-nums">{formatValue(entry.value, format, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty chart                                                                 */
/* -------------------------------------------------------------------------- */

export function EmptyChartState({ title = "No data yet", description, height = 220, icon: Icon = BarChart3 }: { title?: string; description?: ReactNode; height?: number; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: height }}>
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-soft text-primary-ink ring-8 ring-primary-soft/40" aria-hidden="true"><Icon className="h-8 w-8" /></span>
      <p className="mt-5 text-[0.9375rem] font-bold text-ink-strong">{title}</p>
      {description && <p className="mt-1 max-w-xs text-caption text-ink-muted">{description}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ChartCard                                                                   */
/* -------------------------------------------------------------------------- */

export interface ChartDataSummary {
  /** Column headers for the accessible data table. */
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface ChartCardProps {
  title: string;
  description?: ReactNode;
  /** One-sentence plain-language takeaway, read by assistive technology. */
  summary?: string;
  /** Tabular equivalent of the chart for screen readers. */
  data?: ChartDataSummary;
  actions?: ReactNode;
  legend?: LegendItem[];
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  height?: number;
  accent?: ModuleAccent;
  icon?: LucideIcon;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The single frame every visualization lives in: heading, legend, loading /
 * empty / error states and an accessible description plus data table.
 */
export default function ChartCard({ title, description, summary, data, actions, legend, loading, error, empty, emptyTitle, emptyDescription, height = 240, icon: Icon, footer, className, children }: ChartCardProps) {
  return (
    <figure className={cx("relative m-0 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-elevation-1", className)} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && <Icon className="mt-0.5 h-6 w-6 shrink-0 text-section-icon" strokeWidth={2} aria-hidden="true" />}
          <div className="min-w-0">
            <figcaption className="text-card-title font-bold text-headline">{title}</figcaption>
            {description && <p className="mt-0.5 text-support text-heading-support">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {legend && !loading && !empty && !error && <ChartLegend items={legend} className="mt-3" />}
      <div className="mt-4 min-w-0 flex-1">
        {loading ? (
          <ChartSkeleton height={height} />
        ) : error ? (
          <EmptyChartState title="Unable to load this chart" description={error} height={height} />
        ) : empty ? (
          <EmptyChartState title={emptyTitle} description={emptyDescription} height={height} />
        ) : (
          <div aria-hidden={data ? true : undefined}>{children}</div>
        )}
      </div>
      {summary && <p className="sr-only">{summary}</p>}
      {data && !loading && !empty && !error && (
        <table className="sr-only">
          <caption>{title}</caption>
          <thead><tr>{data.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{data.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
        </table>
      )}
      {footer && <div className="mt-4 border-t border-line-soft pt-3 text-support text-ink-muted">{footer}</div>}
    </figure>
  );
}

export { ChartCard };
