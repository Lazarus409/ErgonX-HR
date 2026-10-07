"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { TechnicalDetails } from "@/components/ui/StateBanner";
import { cx } from "@/lib/cx";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  action?: ReactNode;
  /** `inline` renders a compact banner suitable above existing content. */
  variant?: "block" | "inline";
  /** Shown in a collapsed "Technical details" disclosure (block variant). */
  details?: ReactNode;
  className?: string;
}

export default function ErrorState({ title = "Unable to load data", message, onRetry, action, variant = "block", details, className }: ErrorStateProps) {
  if (variant === "inline") {
    return (
      <div role="alert" className={cx("flex flex-col gap-3 rounded-xl border border-danger/25 bg-danger-soft p-4 sm:flex-row sm:items-center", className)}>
        <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink-strong">{title}</p><p className="text-support text-ink">{message}</p></div>
        {onRetry && <Button variant="secondary" size="sm" onClick={onRetry} leadingIcon={<RefreshCw className="h-3.5 w-3.5" />}>Try again</Button>}
        {action}
      </div>
    );
  }
  return (
    <div role="alert" className={cx("flex flex-col items-center justify-center rounded-2xl border border-line bg-surface px-6 py-12 text-center shadow-elevation-1", className)}>
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-danger-soft ring-8 ring-danger-soft/40" aria-hidden="true">
        <AlertTriangle className="h-8 w-8 text-danger" />
      </span>
      <h2 className="mt-4 text-card-title font-bold text-headline">{title}</h2>
      <p className="mt-1.5 max-w-md text-support text-ink-muted">{message}</p>
      {(onRetry || action) && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {onRetry && <Button onClick={onRetry} leadingIcon={<RefreshCw className="h-4 w-4" />}>Try again</Button>}
          {action}
        </div>
      )}
      {details && <TechnicalDetails>{details}</TechnicalDetails>}
    </div>
  );
}
