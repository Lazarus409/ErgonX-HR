"use client";

import { Plus, Receipt } from "lucide-react";
import { useCallback, useState } from "react";

import ExpenseClaimDetail, { expenseTone } from "@/components/expenses/ExpenseClaimDetail";
import ExpenseClaimForm from "@/components/expenses/ExpenseClaimForm";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import ModuleDisabled from "@/components/ui/ModuleDisabled";
import { Drawer } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import { expensesApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { formatAmount, formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import { EXPENSE_STATUS_LABELS, type ExpenseCategory, type ExpenseClaim } from "@/types/expenses";

/** My expenses: the claimant's own claims (Expense Management 2.0, self-service). */
export default function MyExpensesPage() {
  const { user, can, moduleEnabled } = useAccess();
  const enabled = moduleEnabled("ACCOUNTING") && can("expense.claim_own");
  const load = useCallback(async () => {
    if (!enabled) return { claims: [] as ExpenseClaim[], categories: [] as ExpenseCategory[] };
    const [claims, categories] = await Promise.all([
      expensesApi.listExpenseClaims({ page_size: MAX_PAGE_SIZE, ordering: "-created_at" }),
      expensesApi.listExpenseCategories({ page_size: MAX_PAGE_SIZE, is_active: true }),
    ]);
    return { claims: claims.results, categories: categories.results };
  }, [enabled]);
  const { data, loading, error, reload } = useApiResource(load);
  const [editing, setEditing] = useState<ExpenseClaim | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!moduleEnabled("ACCOUNTING")) return <ModuleDisabled moduleName="Accounting" />;
  if (!enabled) return <ErrorState title="Expense claims are not available" message="Your role does not include claiming expenses. Ask your administrator." />;
  if (loading && !data) return <LoadingState variant="table" />;
  if (error || !data) return <ErrorState message={error ?? "Your expenses could not be loaded."} onRetry={reload} />;

  // Own claims only: claims you approve as a manager are in Approvals.
  const mine = data.claims.filter((claim) => claim.created_by === user?.id || claim.approvals.every((step) => step.approver !== user?.id));
  const open = mine.find((claim) => claim.id === openId) ?? null;
  const owed = mine.filter((claim) => claim.status === "POSTED" && claim.payment_method === "REIMBURSABLE").reduce((sum, claim) => sum + Number(claim.amount), 0);
  const inProgress = mine.filter((claim) => ["PENDING", "FINANCE_REVIEW", "APPROVED"].includes(claim.status)).length;
  const currency = mine[0]?.currency;

  const submit = async (claim: ExpenseClaim) => {
    setSubmitting(true); setActionError(null);
    try { await expensesApi.submitExpenseClaim(claim.id); reload(); setOpenId(null); }
    catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="My expenses" description="Claim work expenses, follow their approval, and see when settlement is recorded." icon={Receipt} accent="accounting" actions={<Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>New claim</Button>} />
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Summary">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-elevation-1"><p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">In progress</p><p className="mt-1 text-heading font-bold text-ink-strong">{inProgress}</p></div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-elevation-1"><p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Awaiting settlement</p><p className="mt-1 text-heading font-bold tabular-nums text-ink-strong">{currency ? formatAmount(owed.toFixed(2), currency) : "—"}</p></div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-elevation-1"><p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Needs your changes</p><p className="mt-1 text-heading font-bold text-ink-strong">{mine.filter((claim) => claim.status === "RETURNED").length}</p></div>
      </section>
      {actionError && <ErrorState variant="inline" title="Action failed" message={actionError} />}
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-elevation-1">
        {mine.length === 0 ? (
          <div className="p-6"><EmptyState icon={Receipt} title="No expense claims yet" description="Create a claim for work expenses you paid yourself." /></div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {mine.map((claim) => (
              <li key={claim.id}>
                <button type="button" onClick={() => setOpenId(claim.id)} className="flex w-full flex-wrap items-center gap-4 px-5 py-4 text-left hover:bg-surface-hover">
                  <span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{claim.description}</span><span className="block text-caption text-ink-muted">{formatDate(claim.expense_date)} · {claim.lines.length} item{claim.lines.length === 1 ? "" : "s"}</span></span>
                  <Badge tone={expenseTone(claim.status)} dot size="sm">{EXPENSE_STATUS_LABELS[claim.status] ?? claim.status_label}</Badge>
                  <span className="w-28 text-right font-semibold tabular-nums text-ink-strong">{formatAmount(claim.amount, claim.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && (
        <Drawer
          open
          onClose={() => setOpenId(null)}
          width="lg"
          title={open.description}
          description={`Claim dated ${formatDate(open.expense_date)}`}
          footer={["DRAFT", "RETURNED"].includes(open.status) ? <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setEditing(open); setOpenId(null); }}>Edit</Button><Button loading={submitting} loadingLabel="Submitting…" onClick={() => void submit(open)}>{open.status === "RETURNED" ? "Resubmit" : "Submit"}</Button></div> : undefined}
        >
          <ExpenseClaimDetail claim={open} />
        </Drawer>
      )}
      {editing && <ExpenseClaimForm claim={editing === "new" ? null : editing} categories={data.categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}
