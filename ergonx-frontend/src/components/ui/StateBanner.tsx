import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info, Loader, Search, X, XCircle, type LucideIcon } from "lucide-react";

import { cx } from "@/lib/cx";

/** Concept "Governed empty, error and loading states": inline banners for a page section. */
export type StateBannerKind = "empty" | "permission" | "service" | "validation" | "loading" | "no-results";

const KINDS: Record<StateBannerKind, { icon: LucideIcon; frame: string; iconClass: string; title: string; message: string }> = {
  empty: { icon: Info, frame: "border-primary/20 bg-primary-soft/40", iconClass: "text-primary-ink", title: "No data available", message: "There are no records to display at the moment." },
  permission: { icon: AlertTriangle, frame: "border-warning/30 bg-warning-soft/60", iconClass: "text-warning", title: "You don't have permission", message: "You don't have access to view this information. Contact your administrator if you believe this is a mistake." },
  service: { icon: XCircle, frame: "border-danger/25 bg-danger-soft/60", iconClass: "text-danger", title: "Service unavailable", message: "We're unable to load this information right now. Please try again shortly." },
  validation: { icon: AlertCircle, frame: "border-danger/25 bg-danger-soft/60", iconClass: "text-danger", title: "Please correct the highlighted fields", message: "Some fields need your attention before you can continue." },
  loading: { icon: Loader, frame: "border-primary/20 bg-primary-soft/30", iconClass: "text-primary-ink animate-spin", title: "Loading", message: "Please wait while we retrieve your data…" },
  "no-results": { icon: Search, frame: "border-success/25 bg-success-soft/40", iconClass: "text-success-ink", title: "No results found", message: "Nothing matches your search or filters." },
};

export default function StateBanner({ kind, title, message, actions, onDismiss, className }: {
  kind: StateBannerKind;
  title?: ReactNode;
  message?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const style = KINDS[kind];
  const Icon = style.icon;
  const urgent = kind === "service" || kind === "validation";
  return (
    <div role={urgent ? "alert" : "status"} aria-live={urgent ? "assertive" : "polite"} className={cx("relative flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center", onDismiss && "pr-10 sm:pr-4", style.frame, className)}>
      <Icon className={cx("h-6 w-6 shrink-0", style.iconClass)} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-ink sm:flex sm:items-center sm:gap-6">
        <span className="block shrink-0 font-bold text-headline sm:w-56">{title ?? style.title}</span>
        <span className="block">{message ?? style.message}</span>
      </p>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="absolute right-2 top-2 rounded-lg p-1 text-ink-muted hover:bg-surface-hover hover:text-ink-strong sm:static sm:self-center">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Collapsed "Technical details (optional)" disclosure used under full-page states. */
export function TechnicalDetails({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <details className={cx("group mt-5 w-full max-w-md border-t border-line-soft pt-3 text-left text-sm", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-ink-muted hover:text-ink-strong">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>Technical details (optional)
      </summary>
      <div className="mt-2 break-words rounded-lg bg-surface-muted p-3 font-mono text-caption text-ink">{children}</div>
    </details>
  );
}

export { StateBanner };
