"use client";

import type { ReactNode } from "react";
import { Line, LineChart } from "recharts";

import { useChartAnimation } from "@/components/charts/ChartCard";
import { formatValue, seriesColors, toNumber, type ValueFormat } from "@/components/charts/format";
import { cx } from "@/lib/cx";

/* -------------------------------------------------------------------------- */
/* Funnel                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Stage funnel with stage-to-stage conversion. Widths are proportional to the
 * first stage; conversion is shown only where the previous stage is non-zero.
 */
export function FunnelChart({ stages, color = "var(--mod-recruitment)", format = "number" }: { stages: Array<{ label: string; value: number | string }>; color?: string; format?: ValueFormat }) {
  const first = Math.max(toNumber(stages[0]?.value), 1);
  return (
    <ol className="space-y-2">
      {stages.map((stage, index) => {
        const value = toNumber(stage.value);
        const previous = index > 0 ? toNumber(stages[index - 1].value) : null;
        const width = Math.max((value / first) * 100, 6);
        return (
          <li key={`${stage.label}-${index}`} className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
            <span className="truncate text-support font-medium text-ink" title={stage.label}>{stage.label}</span>
            <span className="flex items-center gap-3">
              <span className="relative h-8 flex-1 overflow-hidden rounded-lg bg-surface-muted">
                <span className="absolute inset-y-0 left-0 rounded-lg transition-[width] duration-500 ease-standard" style={{ width: `${width}%`, background: color, opacity: 1 - index * (0.5 / Math.max(stages.length, 1)) }} />
                {width >= 18 ? (
                  <span className="relative flex h-full items-center px-2.5 text-caption font-semibold text-white drop-shadow-[0_1px_1px_rgb(0_0_0/0.25)] tabular-nums">{formatValue(value, format)}</span>
                ) : (
                  // Too narrow to hold the label: place it just past the bar end, in ink colour.
                  <span className="absolute inset-y-0 flex items-center text-caption font-semibold text-ink-strong tabular-nums" style={{ left: `calc(${width}% + 0.5rem)` }}>{formatValue(value, format)}</span>
                )}
              </span>
              <span className="w-12 shrink-0 text-right text-caption text-ink-muted tabular-nums" title="Conversion from previous stage">
                {previous ? `${Math.round((value / previous) * 100)}%` : index === 0 ? "" : "—"}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Horizontal ranking                                                          */
/* -------------------------------------------------------------------------- */

export function RankingBars({ items, format = "number", currency, color = "var(--chart-1)", limit = 8, secondary }: { items: Array<{ label: string; value: number | string; hint?: ReactNode }>; format?: ValueFormat; currency?: string; color?: string; limit?: number; secondary?: (item: { label: string; value: number | string }) => ReactNode }) {
  const sorted = [...items].sort((a, b) => toNumber(b.value) - toNumber(a.value)).slice(0, limit);
  const max = Math.max(...sorted.map((item) => toNumber(item.value)), 1);
  return (
    <ol className="space-y-3">
      {sorted.map((item, index) => (
        <li key={`${item.label}-${index}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-4 shrink-0 text-caption font-semibold text-ink-subtle tabular-nums">{index + 1}</span>
              <span className="truncate text-support font-medium text-ink" title={item.label}>{item.label}</span>
              {item.hint && <span className="hidden shrink-0 text-caption text-ink-subtle sm:inline">{item.hint}</span>}
            </span>
            <span className="shrink-0 text-support font-semibold text-ink-strong tabular-nums">{formatValue(item.value, format, currency)}{secondary && <span className="ml-1.5 font-normal text-ink-muted">{secondary(item)}</span>}</span>
          </div>
          <div className="ml-6 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div className="h-full rounded-full transition-[width] duration-500 ease-standard" style={{ width: `${Math.max((toNumber(item.value) / max) * 100, 2)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Heatmap / calendar grid                                                     */
/* -------------------------------------------------------------------------- */

export interface HeatmapCell {
  value: number;
  label?: string;
}

/**
 * Row × column intensity grid (e.g. department × weekday, month calendar).
 * Intensity is the value relative to the grid maximum; every cell carries a
 * text label so meaning never depends on colour alone.
 */
export function HeatmapGrid({ rows, columns, cells, color = "var(--mod-attendance)", format = "number", showValues = true }: { rows: string[]; columns: string[]; cells: HeatmapCell[][]; color?: string; format?: ValueFormat; showValues?: boolean }) {
  const max = Math.max(...cells.flat().map((cell) => cell.value), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 4 }}>
        <thead>
          <tr>
            <th className="w-28" />
            {columns.map((column) => <th key={column} scope="col" className="px-1 pb-1 text-center text-caption font-medium text-ink-muted">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row}-${rowIndex}`}>
              <th scope="row" className="max-w-28 truncate pr-2 text-left text-caption font-medium text-ink" title={row}>{row}</th>
              {columns.map((column, columnIndex) => {
                const cell = cells[rowIndex]?.[columnIndex] ?? { value: 0 };
                const intensity = cell.value / max;
                return (
                  <td key={column} className="p-0">
                    <span
                      title={cell.label ?? `${row}, ${column}: ${formatValue(cell.value, format)}`}
                      className={cx("flex h-9 min-w-9 items-center justify-center rounded-md text-caption font-semibold tabular-nums", intensity > 0.55 ? "text-white" : "text-ink")}
                      style={{ background: cell.value ? `color-mix(in srgb, ${color} ${Math.round(12 + intensity * 78)}%, var(--surface-muted))` : "var(--surface-muted)" }}
                    >
                      {showValues ? (cell.value ? formatValue(cell.value, format) : "·") : <span className="sr-only">{formatValue(cell.value, format)}</span>}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented bar (composition / progress)                                      */
/* -------------------------------------------------------------------------- */

export function SegmentedBar({ segments, format = "number", currency, height = "h-3", showLegend = true }: { segments: Array<{ label: string; value: number | string; color?: string }>; format?: ValueFormat; currency?: string; height?: string; showLegend?: boolean }) {
  const total = segments.reduce((sum, item) => sum + toNumber(item.value), 0);
  return (
    <div>
      <div className={cx("flex w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted", height)} role="img" aria-label={segments.map((item) => `${item.label} ${formatValue(item.value, format, currency)}`).join(", ")}>
        {total > 0 && segments.map((item, index) => {
          const share = (toNumber(item.value) / total) * 100;
          return share > 0 ? <span key={item.label} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${share}%`, background: item.color ?? seriesColors[index % seriesColors.length] }} /> : null;
        })}
      </div>
      {showLegend && (
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {segments.map((item, index) => (
            <li key={item.label} className="min-w-0">
              <span className="flex items-center gap-1.5 text-caption text-ink-muted"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color ?? seriesColors[index % seriesColors.length] }} /><span className="truncate">{item.label}</span></span>
              <span className="mt-0.5 block text-sm font-semibold text-ink-strong tabular-nums">{formatValue(item.value, format, currency)}{total > 0 && <span className="ml-1 text-caption font-normal text-ink-subtle">{Math.round((toNumber(item.value) / total) * 100)}%</span>}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Single-value progress meter (e.g. leave utilisation). */
export function ProgressMeter({ value, max = 100, label, color = "var(--primary)", detail }: { value: number; max?: number; label: string; color?: string; detail?: ReactNode }) {
  const share = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-support font-medium text-ink">{label}</span>
        <span className="text-sm font-semibold text-ink-strong tabular-nums">{Math.round(share)}%</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)} aria-label={label}>
        <div className="h-full rounded-full transition-[width] duration-500 ease-standard" style={{ width: `${share}%`, background: color }} />
      </div>
      {detail && <p className="mt-1.5 text-caption text-ink-muted">{detail}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sparkline                                                                   */
/* -------------------------------------------------------------------------- */

export function Sparkline({ values, color = "var(--chart-1)", height = 36, label }: { values: Array<number | string>; color?: string; height?: number; label: string }) {
  const animate = useChartAnimation();
  const data = values.map((value, index) => ({ index, value: toNumber(value) }));
  if (data.length < 2) return null;
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <LineChart data={data} responsive style={{ width: "100%", height }} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={animate} />
      </LineChart>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

export function Timeline({ items }: { items: Array<{ id: string; title: ReactNode; time?: ReactNode; description?: ReactNode; tone?: "brand" | "success" | "warning" | "danger" | "neutral"; href?: string }> }) {
  const dot = { brand: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger", neutral: "bg-line-strong" };
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line">
      {items.map((item) => (
        <li key={item.id} className="relative pl-6">
          <span aria-hidden="true" className={cx("absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-surface", dot[item.tone ?? "brand"])} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-semibold text-ink-strong">{item.title}</p>
            {item.time && <p className="text-caption text-ink-subtle">{item.time}</p>}
          </div>
          {item.description && <p className="mt-0.5 text-support text-ink-muted">{item.description}</p>}
        </li>
      ))}
    </ol>
  );
}
