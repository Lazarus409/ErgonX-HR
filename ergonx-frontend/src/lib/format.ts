import { getDisplayPreferences, numberLocale } from "@/lib/displayPreferences";

/**
 * Display formatting helpers.
 *
 * Presentation only. Business calculations stay on the backend, which is
 * authoritative for balances, payroll and accounting figures.
 */

export const EM_DASH = "—";

/**
 * Formats a Date as `YYYY-MM-DD` in local time.
 *
 * `toISOString()` converts to UTC first, which shifts a local midnight into
 * the previous day for any positive UTC offset. Calendar cells and date
 * filters must use the local calendar date.
 */
export function toISODate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/** Formats an ISO date (YYYY-MM-DD) as `12 Jan 2023`. */
export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return EM_DASH;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return datePart(parsed);
}

/** The member's date style (S050 personal preferences); default `12 Jan 2023`. */
function datePart(parsed: Date): string {
  const style = getDisplayPreferences().dateStyle;
  if (style === "iso") return toISODate(parsed);
  if (style === "numeric") return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return EM_DASH;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const time = parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: getDisplayPreferences().hour12 });
  return `${datePart(parsed)}, ${time}`;
}

/**
 * Formats a backend decimal string without re-deriving it. Decimal amounts
 * arrive as strings to preserve precision, so they are parsed for display
 * only.
 */
export function formatAmount(
  value: string | number | null | undefined,
  currency?: string,
): string {
  if (value === null || value === undefined || value === "") {
    return EM_DASH;
  }

  const numeric = typeof value === "number" ? value : Number(value);

  if (Number.isNaN(numeric)) {
    return String(value);
  }

  const formatted = Math.abs(numeric).toLocaleString(numberLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (!currency) {
    return numeric < 0 ? `-${formatted}` : formatted;
  }

  // Keep one presentation contract for all monetary UI. The backend remains
  // authoritative for the currency code; this map only controls its display
  // symbol and falls back to the ISO code for an unknown currency.
  const normalized = currency.toUpperCase();
  const symbols: Record<string, string> = {
    GHS: "GH₵",
    USD: "$",
    EUR: "€",
    GBP: "£",
    NGN: "₦",
    KES: "KSh",
  };
  const symbol = symbols[normalized] ?? normalized;
  const separator = symbol.length > 2 || normalized === "GHS" ? " " : "";
  return `${numeric < 0 ? "-" : ""}${symbol}${separator}${formatted}`;
}

export function formatNumber(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") {
    return EM_DASH;
  }

  const numeric = typeof value === "number" ? value : Number(value);

  return Number.isNaN(numeric) ? String(value) : numeric.toLocaleString(numberLocale());
}

/** Turns a backend enum such as `PART_PAID` into `Part Paid`. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) {
    return EM_DASH;
  }

  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** "1 record" / "3 records"; an unknown count renders as an em dash with the plural noun. */
export function formatCount(value: number | string | null | undefined, singular: string, plural = `${singular}s`): string {
  if (value === null || value === undefined || value === "") return `${EM_DASH} ${plural}`;
  return `${formatNumber(value)} ${Number(value) === 1 ? singular : plural}`;
}
