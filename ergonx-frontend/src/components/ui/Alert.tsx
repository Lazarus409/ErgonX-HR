import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from "lucide-react";

import { cx } from "@/lib/cx";

export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { box: string; icon: typeof Info; iconClass: string }> = {
  info: { box: "border-info/25 bg-info-soft", icon: Info, iconClass: "text-info" },
  success: { box: "border-success/25 bg-success-soft", icon: CheckCircle2, iconClass: "text-success" },
  warning: { box: "border-warning/30 bg-warning-soft", icon: AlertTriangle, iconClass: "text-warning" },
  danger: { box: "border-danger/25 bg-danger-soft", icon: XCircle, iconClass: "text-danger" },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** Inline, persistent feedback. Errors are announced assertively. */
export default function Alert({ tone = "info", title, children, actions, onDismiss, className }: AlertProps) {
  const style = tones[tone];
  const Icon = style.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-3 rounded-xl border p-4", style.box, className)}>
      <Icon className={cx("mt-0.5 h-5 w-5 shrink-0", style.iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold text-ink-strong">{title}</p>}
        {children && <div className={cx("text-support text-ink", title && "mt-0.5")}>{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded-lg p-1 text-ink-muted hover:bg-surface-hover hover:text-ink-strong">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export { Alert };
