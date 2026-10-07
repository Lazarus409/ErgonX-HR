"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Overlay";
import { cx } from "@/lib/cx";

/**
 * Concept "Confirmation dialogs": neutral (non-destructive), approval (positive
 * decisions), warning (e.g. discarding unsaved changes) and destructive
 * (irreversible). Destructive dialogs can name the affected record and require
 * typing a word before the confirm button enables.
 */
export type ConfirmTone = "neutral" | "approval" | "warning" | "destructive";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Kept for existing callers; equivalent to tone="destructive". */
  destructive?: boolean;
  tone?: ConfirmTone;
  loading?: boolean;
  /** Record affected by the action, shown as a summary card. */
  record?: { name: string; detail?: string };
  /** Longer explanation of the consequences, shown under the record. */
  consequence?: string;
  /** Require typing this word (e.g. "DELETE") before confirming. */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONES: Record<ConfirmTone, { icon: typeof HelpCircle; badge: string; button: "primary" | "danger" }> = {
  neutral: { icon: HelpCircle, badge: "bg-primary-soft text-primary", button: "primary" },
  approval: { icon: CheckCircle2, badge: "bg-success-soft text-success", button: "primary" },
  warning: { icon: AlertTriangle, badge: "bg-warning-soft text-warning-ink", button: "primary" },
  destructive: { icon: Trash2, badge: "bg-danger-soft text-danger", button: "danger" },
};

export default function ConfirmDialog(props: ConfirmDialogProps) {
  // Remount per opening so the typed confirmation always starts empty.
  return props.open ? <ConfirmDialogBody key={`${props.title}-${props.record?.name ?? ""}`} {...props} /> : null;
}

function ConfirmDialogBody({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  tone,
  loading = false,
  record,
  consequence,
  typeToConfirm,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const resolved: ConfirmTone = tone ?? (destructive ? "destructive" : "neutral");
  const style = TONES[resolved];
  const Icon = style.icon;
  const blocked = Boolean(typeToConfirm) && typed.trim() !== typeToConfirm;
  const hasBody = Boolean(record || consequence || typeToConfirm);

  return (
    <Dialog
      open
      onClose={onCancel}
      dismissible={!loading}
      size="sm"
      title={title}
      description={description}
      icon={
        <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", style.badge)} aria-hidden="true">
          <Icon className="h-6 w-6" />
        </span>
      }
      footer={
        <div className="grid w-full grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button variant={style.button} size="lg" onClick={onConfirm} loading={loading} disabled={blocked} loadingLabel="Processing…" leadingIcon={resolved === "destructive" ? <Trash2 className="h-4 w-4" /> : undefined} data-autofocus={!typeToConfirm || undefined}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {hasBody && (
        <div className="space-y-3 text-sm">
          {record && (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-3">
              <Avatar name={record.name} />
              <div className="min-w-0"><p className="truncate font-semibold text-ink-strong">{record.name}</p>{record.detail && <p className="truncate text-caption text-ink-muted">{record.detail}</p>}</div>
            </div>
          )}
          {consequence && <p className="text-ink">{consequence}</p>}
          {typeToConfirm && (
            <label className="block">
              <span className="mb-1.5 block font-semibold text-ink-strong">Please type {typeToConfirm} to confirm<span className="text-danger-ink"> *</span></span>
              <input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={`Type ${typeToConfirm}`} className={cx("h-11 w-full rounded-lg border bg-surface px-3", blocked && typed ? "border-danger" : "border-line-strong")} aria-invalid={blocked && Boolean(typed)} />
            </label>
          )}
        </div>
      )}
    </Dialog>
  );
}
