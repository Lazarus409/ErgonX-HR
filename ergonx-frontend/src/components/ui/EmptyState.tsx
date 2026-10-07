import type { ReactNode } from "react";
import { Inbox, Search, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { TechnicalDetails } from "@/components/ui/StateBanner";

import { cx } from "@/lib/cx";
import type { ModuleAccent } from "@/lib/moduleTheme";

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  /** Ignored since Phase 2: empty states use the neutral slate treatment. Kept so callers compile. */
  accent?: ModuleAccent;
  /** `compact` for use inside cards and tables. */
  size?: "default" | "compact";
  /** Shown in a collapsed "Technical details" disclosure. */
  details?: ReactNode;
  className?: string;
}

export default function EmptyState({ title, description, action, icon: Icon = Inbox, size = "default", details, className }: EmptyStateProps) {
  const compact = size === "compact";
  return (
    <div className={cx("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "rounded-2xl border border-line bg-surface px-6 py-14", className)}>
      {/* Concept governed empty state: soft circular halo around the icon. */}
      {/* Stitch governed empty state: 48px slate circle, 24px slate icon. */}
      <span className={cx("relative inline-flex items-center justify-center rounded-full bg-surface-muted text-ink-muted", compact ? "h-11 w-11" : "h-12 w-12")} aria-hidden="true">
        <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </span>
      <h3 className={cx("text-[0.9375rem] font-semibold text-ink-strong", compact ? "mt-3" : "mt-4")}>{title}</h3>
      {description && <p className="mt-1 max-w-md text-support text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
      {details && <TechnicalDetails>{details}</TechnicalDetails>}
    </div>
  );
}

/** Successful zero-result state: the query ran, nothing matched. */
export function NoResultsState({ noun = "records", query, onClear, clearLabel = "Clear filters", size, className }: { noun?: string; query?: string; onClear?: () => void; clearLabel?: string; size?: "default" | "compact"; className?: string }) {
  return (
    <EmptyState
      icon={Search}
      accent="attendance"
      size={size}
      className={className}
      title="No matching results"
      description={<>{query ? <>We couldn&apos;t find any {noun} matching &ldquo;{query}&rdquo;.</> : <>We couldn&apos;t find any {noun} matching your criteria.</>} Try adjusting your search or filters.</>}
      action={onClear ? <Button variant="secondary" onClick={onClear}>{clearLabel}</Button> : undefined}
    />
  );
}

export { EmptyState };
