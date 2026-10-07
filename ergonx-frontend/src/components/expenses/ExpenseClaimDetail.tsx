"use client";

import { Check, Minus, Paperclip, X } from "lucide-react";
import { useCallback } from "react";

import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { expensesApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { EXPENSE_STAGES, EXPENSE_STATUS_LABELS, type ExpenseClaim, type ExpensePolicyCheck } from "@/types/expenses";

export function expenseTone(status: ExpenseClaim["status"]): "neutral" | "brand" | "warning" | "success" | "danger" {
  if (status === "RETURNED") return "warning";
  if (status === "REJECTED" || status === "REVERSED") return "danger";
  if (status === "SETTLED" || status === "POSTED" || status === "APPROVED") return "success";
  if (status === "DRAFT") return "neutral";
  return "brand";
}

/** Where the claim is in the locked lifecycle (returned/rejected/reversed shown as a note). */
export function ExpenseProgress({ claim }: { claim: ExpenseClaim }) {
  const index = EXPENSE_STAGES.findIndex((stage) => stage.status === claim.status);
  const reached = claim.status === "RETURNED" ? 0 : claim.status === "REVERSED" ? EXPENSE_STAGES.findIndex((stage) => stage.status === "POSTED") : index;
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Claim progress">
      {EXPENSE_STAGES.filter((stage) => stage.status !== "SETTLED" || claim.payment_method === "REIMBURSABLE").map((stage, position) => {
        const done = reached >= 0 && position < reached;
        const current = position === reached && !["REJECTED", "REVERSED"].includes(claim.status);
        return (
          <li key={stage.status} className="flex items-center gap-2">
            <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-[0.6875rem] font-bold", done ? "bg-success text-white" : current ? "bg-primary text-white" : "bg-surface-muted text-ink-muted")}>{done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : position + 1}</span>
            <span className={cx("text-caption", current ? "font-semibold text-ink-strong" : "text-ink-muted")}>{stage.label}</span>
            {position < EXPENSE_STAGES.length - 1 && <span className="hidden h-px w-4 bg-line sm:block" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function CheckIcon({ status }: { status: ExpensePolicyCheck["status"] }) {
  const style = status === "pass" ? "bg-success-soft text-success" : status === "warn" ? "bg-warning-soft text-warning-ink" : status === "fail" ? "bg-danger-soft text-danger" : "bg-surface-muted text-ink-muted";
  return <span className={cx("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full", style)} aria-hidden="true">{status === "pass" ? <Check className="h-3 w-3" /> : status === "fail" ? <X className="h-3 w-3" /> : <Minus className="h-3 w-3" />}</span>;
}

/** Lines, approvals and policy checks for one claim; shared by self-service and finance. */
export default function ExpenseClaimDetail({ claim, lineExtra }: { claim: ExpenseClaim; lineExtra?: (line: ExpenseClaim["lines"][number]) => React.ReactNode }) {
  const load = useCallback(() => expensesApi.getExpensePolicyChecks(claim.id), [claim.id]);
  const { data: checks, loading } = useApiResource(load);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone={expenseTone(claim.status)} dot>{EXPENSE_STATUS_LABELS[claim.status] ?? claim.status_label}</Badge>
        <span className="text-heading font-bold tabular-nums text-ink-strong">{formatAmount(claim.amount, claim.currency)}</span>
      </div>
      <ExpenseProgress claim={claim} />
      {claim.decision_note && <p className={cx("rounded-lg p-3 text-support", claim.status === "RETURNED" ? "bg-warning-soft text-warning-ink" : "bg-surface-muted text-ink")}><span className="font-semibold">Note: </span>{claim.decision_note}</p>}

      <section>
        <h3 className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Lines</h3>
        {claim.lines.length ? (
          <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line">
            {claim.lines.map((line) => (
              <li key={line.id ?? line.description} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-strong">{line.description}</p>
                  <p className="text-caption text-ink-muted">{line.category_name} · {formatDate(line.expense_date)}{line.account_code ? ` · ${line.account_code} ${line.account_name ?? ""}` : ""}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-caption text-ink-muted"><Paperclip className="h-3 w-3" aria-hidden="true" />{line.receipts.length ? `${line.receipts.length} receipt${line.receipts.length === 1 ? "" : "s"}` : "No receipt"}</p>
                  {lineExtra?.(line)}
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink-strong">{formatAmount(line.amount, claim.currency)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-support text-ink-muted">Single-amount expense entered by finance.</p>}
      </section>

      {claim.approvals.length > 0 && (
        <section>
          <h3 className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Approvals</h3>
          <ol className="mt-2 space-y-2">
            {claim.approvals.map((step) => (
              <li key={step.id} className="flex items-start justify-between gap-3 text-support">
                <span><span className="font-semibold text-ink-strong">{step.step_name}</span> · {step.approver_name}{step.comment ? <span className="block text-caption text-ink-muted">“{step.comment}”</span> : null}</span>
                <span className="shrink-0 text-right"><Badge size="sm" tone={step.status === "APPROVED" ? "success" : step.status === "PENDING" ? "brand" : step.status === "RETURNED" ? "warning" : "danger"}>{step.status.toLowerCase()}</Badge>{step.acted_at && <span className="block text-caption text-ink-subtle">{formatDateTime(step.acted_at)}</span>}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Policy checks</h3>
        {loading && !checks ? <Skeleton className="mt-2 h-24 rounded-lg" /> : (
          <ul className="mt-2 space-y-2">
            {(checks?.checks ?? []).map((check) => (
              <li key={check.code} className="flex items-start gap-2 text-support">
                <CheckIcon status={check.status} />
                <span><span className="font-semibold text-ink-strong">{check.label}</span>{check.status === "not_evaluated" && <span className="ml-1 text-caption text-ink-muted">(not evaluated)</span>}<span className="block text-caption text-ink-muted">{check.detail}</span></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {claim.status === "SETTLED" && <p className="rounded-lg bg-success-soft p-3 text-support text-success-ink">Settlement recorded on {claim.settlement_date ? formatDate(claim.settlement_date) : "—"}{claim.settlement_reference ? ` (ref. ${claim.settlement_reference})` : ""}. ErgonX records settlements; it does not transfer money.</p>}
    </div>
  );
}
