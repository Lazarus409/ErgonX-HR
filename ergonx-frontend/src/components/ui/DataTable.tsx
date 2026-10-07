"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { cx } from "@/lib/cx";
import type { LucideIcon } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Column model                                                                */
/* -------------------------------------------------------------------------- */

export interface DataColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Right-aligns and applies tabular numerals (money, counts). */
  numeric?: boolean;
  /** Enables client-side sorting on the current page using this accessor. */
  sortValue?: (row: Row) => string | number | null | undefined;
  /** Hide below a breakpoint to keep narrow screens readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl" | "2xl";
  width?: string;
  className?: string;
}

const hideClasses = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell", "2xl": "hidden 2xl:table-cell" };

export interface DataTableProps<Row> {
  columns: DataColumn<Row>[];
  rows: Row[] | null | undefined;
  rowKey: (row: Row, index: number) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; description?: ReactNode; action?: ReactNode; icon?: LucideIcon };
  onRowClick?: (row: Row) => void;
  /** Highlights the row shown in an adjacent preview panel. */
  isRowSelected?: (row: Row) => boolean;
  /** Accessible table caption (visually hidden). */
  caption: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  density?: "comfortable" | "compact";
  /** Minimum table width before horizontal scroll takes over. */
  minWidth?: number;
  className?: string;
}

/**
 * Standard ErgonX data table: toolbar slot, sticky header, calm row hover,
 * numeric alignment, and built-in loading / empty / error states. Horizontal
 * scroll is contained inside the card so the page body never overflows.
 */
export function DataTable<Row>({ columns, rows, rowKey, loading, error, onRetry, empty, onRowClick, isRowSelected, caption, toolbar, footer, density = "comfortable", minWidth = 720, className }: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const sorted = useMemo(() => {
    if (!rows || !sort) return rows ?? [];
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (left === right) return 0;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      return (left > right ? 1 : -1) * factor;
    });
  }, [rows, sort, columns]);

  const cellPad = density === "compact" ? "px-4 py-2.5" : "px-5 py-3.5";

  return (
    <section className={cx("min-w-0 overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1", className)}>
      {toolbar && <div className="border-b border-line-soft p-4">{toolbar}</div>}
      {error ? (
        <div className="p-5"><ErrorState message={error} onRetry={onRetry} variant="inline" /></div>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth }}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((column) => {
                  const active = sort?.key === column.key;
                  const SortIcon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      style={column.width ? { width: column.width } : undefined}
                      className={cx(
                        "sticky top-0 z-10 border-b border-line bg-canvas/95 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-muted backdrop-blur",
                        density === "compact" ? "px-4 py-2.5" : "px-5 py-3",
                        column.numeric && "text-right",
                        column.hideBelow && hideClasses[column.hideBelow],
                      )}
                    >
                      {column.sortValue ? (
                        <button
                          type="button"
                          onClick={() => setSort((current) => current?.key === column.key ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" } : { key: column.key, direction: "asc" })}
                          className={cx("inline-flex items-center gap-1.5 rounded-md hover:text-ink-strong", column.numeric && "flex-row-reverse", active && "text-ink-strong")}
                        >
                          {column.header}
                          <SortIcon className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                        </button>
                      ) : column.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && !(rows && rows.length) ? (
                Array.from({ length: 6 }, (_, index) => (
                  <tr key={`skeleton-${index}`}>
                    {columns.map((column, columnIndex) => (
                      <td key={column.key} className={cx(cellPad, "border-b border-line-soft", column.hideBelow && hideClasses[column.hideBelow])}>
                        <Skeleton className={cx("h-4", columnIndex === 0 ? "w-4/5" : "w-3/5", column.numeric && "ml-auto")} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState size="compact" title={empty?.title ?? "No records found"} description={empty?.description} action={empty?.action} icon={empty?.icon} />
                  </td>
                </tr>
              ) : (
                sorted.map((row, rowIndex) => (
                  <tr
                    key={rowKey(row, rowIndex)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    aria-selected={isRowSelected ? isRowSelected(row) : undefined}
                    className={cx("group transition-colors duration-100 hover:bg-surface-hover", onRowClick && "cursor-pointer", isRowSelected?.(row) && "bg-primary-soft/60 hover:bg-primary-soft/70", loading && "opacity-60")}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cx(
                          cellPad,
                          "border-b border-line-soft align-middle text-ink group-last:border-b-0",
                          column.numeric && "text-right tabular-nums",
                          column.hideBelow && hideClasses[column.hideBelow],
                          column.className,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {footer && <div className="border-t border-line-soft px-5 py-3">{footer}</div>}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                     */
/* -------------------------------------------------------------------------- */

export function DataToolbar({ search, onSearchChange, searchPlaceholder = "Search…", filters, actions, onClear, className }: { search?: string; onSearchChange?: (value: string) => void; searchPlaceholder?: string; filters?: ReactNode; actions?: ReactNode; onClear?: () => void; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3 lg:flex-row lg:items-center", className)}>
      {onSearchChange && (
        <div className="relative w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
          <input
            type="search"
            data-ui="input"
            value={search ?? ""}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-9 text-sm text-ink-strong placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          {search && (
            <button type="button" onClick={() => onSearchChange("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-subtle hover:text-ink-strong">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {filters && <div className="flex flex-wrap items-center gap-2 [&_select]:w-auto [&>div:has(>select)]:w-auto">{filters}</div>}
      {onClear && <button type="button" onClick={onClear} className="text-support font-semibold text-primary-ink hover:underline">Clear filters</button>}
      {actions && <div className="flex flex-wrap items-center gap-2 lg:ml-auto">{actions}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

export function Pagination({ page, pageSize, total, onPageChange, className }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className={cx("flex flex-col items-center justify-between gap-3 text-support text-ink-muted sm:flex-row", className)}>
      <p>
        Showing <span className="font-semibold text-ink-strong tabular-nums">{from}–{to}</span> of <span className="font-semibold text-ink-strong tabular-nums">{total.toLocaleString("en-GB")}</span>
      </p>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 font-semibold text-ink hover:bg-surface-hover disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />Previous
        </button>
        <span className="px-2 tabular-nums" aria-current="page">Page {page} of {pages}</span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pages} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 font-semibold text-ink hover:bg-surface-hover disabled:opacity-40">
          Next<ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export default DataTable;
