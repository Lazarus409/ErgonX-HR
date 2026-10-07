/**
 * Chart formatters. Presentation only: values arrive from authoritative
 * backend rollups and are never re-derived here beyond display scaling.
 */
import { formatAmount } from "@/lib/format";

export type ValueFormat = "currency" | "number" | "percent" | "minutes" | "days";

const currencySymbols: Record<string, string> = { GHS: "GH₵", USD: "$", EUR: "€", GBP: "£", NGN: "₦", KES: "KSh" };

export function toNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** True when at least one row has a non-zero value for any of `keys`. An all-zero series renders as an empty state, not blank axes. */
export function hasValues(rows: ReadonlyArray<object>, keys: string[]): boolean {
  return rows.some((row) => keys.some((key) => toNumber((row as Record<string, unknown>)[key]) !== 0));
}

/** Compact axis label: 1.2k, 3.4M. Keeps the currency symbol for money. */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}${Math.round(abs * 100) / 100}`;
}

export function currencyAxisFormatter(currency?: string) {
  const symbol = currency ? currencySymbols[currency.toUpperCase()] ?? currency.toUpperCase() : "";
  return (value: unknown) => `${symbol}${symbol.length > 1 ? " " : ""}${compactNumber(toNumber(value))}`;
}

export function percentageFormatter(value: unknown, digits = 0): string {
  return `${toNumber(value).toFixed(digits)}%`;
}

/** Month axis from `YYYY-MM` / ISO dates: "Jan 26". Falls back to the raw label. */
export function dateAxisFormatter(granularity: "month" | "day" | "weekday" = "month") {
  return (value: unknown) => {
    if (typeof value !== "string") return String(value ?? "");
    const parsed = new Date(value.length === 7 ? `${value}-01` : value);
    if (Number.isNaN(parsed.getTime())) return value;
    if (granularity === "weekday") return parsed.toLocaleDateString("en-GB", { weekday: "short" });
    if (granularity === "day") return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    return parsed.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  };
}

/** Full-precision value for tooltips and accessible tables. */
export function formatValue(value: unknown, format: ValueFormat = "number", currency?: string): string {
  const numeric = toNumber(value);
  switch (format) {
    case "currency":
      return formatAmount(numeric, currency);
    case "percent":
      return percentageFormatter(numeric, 1);
    case "minutes":
      return numeric >= 60 ? `${Math.floor(numeric / 60)}h ${Math.round(numeric % 60)}m` : `${Math.round(numeric)}m`;
    case "days":
      return `${numeric.toLocaleString("en-GB", { maximumFractionDigits: 1 })} day${numeric === 1 ? "" : "s"}`;
    default:
      return numeric.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  }
}

export function axisFormatter(format: ValueFormat, currency?: string) {
  if (format === "currency") return currencyAxisFormatter(currency);
  if (format === "percent") return (value: unknown) => percentageFormatter(value);
  if (format === "minutes") return (value: unknown) => `${compactNumber(toNumber(value))}m`;
  return (value: unknown) => compactNumber(toNumber(value));
}

/** Ordered categorical series colours (see visualization-guidelines.md). */
export const seriesColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
