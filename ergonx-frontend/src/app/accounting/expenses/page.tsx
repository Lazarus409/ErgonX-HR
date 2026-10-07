"use client";

import { Plus, Receipt, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import ExpenseClaimDetail, { expenseTone } from "@/components/expenses/ExpenseClaimDetail";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Drawer } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { accountingApi, expensesApi, getApiErrorMessage } from "@/lib/api";
import { formatAmount, formatDate, toISODate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { Account } from "@/types/accounting";
import { MAX_PAGE_SIZE } from "@/types/api";
import { EXPENSE_STATUS_LABELS, type ExpenseCategory, type ExpenseClaim } from "@/types/expenses";

type View = "review" | "post" | "settle" | "all" | "categories";
const fieldClass = "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong";

function initialReviewId() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("review");
}

/** Finance expenses: review, post, settle and reverse claims; configure categories (Expense Management 2.0). */
export default function ExpensesPage() {
  const { user } = useAuth();
  const can = (permission: string) => Boolean(user?.permissions.includes("*") || user?.permissions.includes(permission));
  const [view, setView] = useState<View>(() => (initialReviewId() ? "all" : can("expense.finance_review") ? "review" : "all"));
  const [openId, setOpenId] = useState<string | null>(initialReviewId);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [claims, accounts, categories] = await Promise.all([
      expensesApi.listExpenseClaims({ page_size: MAX_PAGE_SIZE, ordering: "-expense_date" }),
      accountingApi.listAccounts({ page_size: MAX_PAGE_SIZE, is_active: true, is_postable: true }).catch(() => ({ results: [] as Account[] })),
      expensesApi.listExpenseCategories({ page_size: MAX_PAGE_SIZE }).catch(() => ({ results: [] as ExpenseCategory[] })),
    ]);
    return { claims: claims.results, accounts: accounts.results, categories: categories.results };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);

  const claims = useMemo(() => data?.claims ?? [], [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return claims.filter((claim) => {
      const inView = view === "review" ? claim.status === "FINANCE_REVIEW" : view === "post" ? claim.status === "APPROVED" : view === "settle" ? claim.status === "POSTED" && claim.payment_method === "REIMBURSABLE" : true;
      return inView && (!query || `${claim.description} ${claim.claimant_name ?? ""}`.toLowerCase().includes(query));
    });
  }, [claims, view, search]);

  if (loading && !data) return <LoadingState variant="table" />;
  if (error || !data) return <ErrorState message={error ?? "Expenses could not be loaded."} onRetry={reload} />;
  const open = claims.find((claim) => claim.id === openId) ?? null;
  const count = (predicate: (claim: ExpenseClaim) => boolean) => claims.filter(predicate).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Review staff claims, post them to the ledger, and record settlements. Claimants submit from My expenses."
        icon={Receipt}
        accent="accounting"
        actions={can("expense.create") ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Petty-cash expense</Button> : undefined}
      />
      <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-elevation-1">
        <div className="border-b border-line-soft px-4 pt-2">
          <Tabs label="Expense views" value={view} onChange={(value) => setView(value as View)} items={[
            ...(can("expense.finance_review") ? [{ value: "review", label: "Finance review", count: count((claim) => claim.status === "FINANCE_REVIEW") }] : []),
            ...(can("expense.post") ? [{ value: "post", label: "To post", count: count((claim) => claim.status === "APPROVED") }] : []),
            ...(can("expense.settle") ? [{ value: "settle", label: "To settle", count: count((claim) => claim.status === "POSTED" && claim.payment_method === "REIMBURSABLE") }] : []),
            { value: "all", label: "All expenses" },
            ...(can("accounting.configure") ? [{ value: "categories", label: "Categories" }] : []),
          ]} />
        </div>
        {view === "categories" ? (
          <CategoryManager categories={data.categories} accounts={data.accounts.filter((account) => account.account_type === "EXPENSE")} onChanged={reload} />
        ) : (
          <>
            <div className="border-b border-line-soft p-4"><label className="relative block max-w-md"><span className="sr-only">Search</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by purpose or claimant…" className={`${fieldClass} pl-9`} /></label></div>
            {filtered.length === 0 ? <div className="p-6"><EmptyState icon={Receipt} title="Nothing here" description={view === "review" ? "No claims are waiting for finance review." : "No expenses match."} /></div> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-left text-sm">
                  <thead className="bg-surface-muted/60 text-caption uppercase tracking-[0.06em] text-ink-muted"><tr><th className="px-4 py-2.5 font-semibold">Date</th><th className="px-4 py-2.5 font-semibold">Claimant</th><th className="px-4 py-2.5 font-semibold">Purpose</th><th className="px-4 py-2.5 font-semibold">Payment</th><th className="px-4 py-2.5 text-right font-semibold">Amount</th><th className="px-4 py-2.5 font-semibold">Status</th></tr></thead>
                  <tbody className="divide-y divide-line-soft">
                    {filtered.map((claim) => (
                      <tr key={claim.id} className="cursor-pointer hover:bg-surface-hover" onClick={() => setOpenId(claim.id)}>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{formatDate(claim.expense_date)}</td>
                        <td className="px-4 py-3">{claim.claimant_name ?? <span className="text-ink-muted">Finance entry</span>}</td>
                        <td className="px-4 py-3"><button type="button" className="text-left font-semibold text-ink-strong hover:text-primary" onClick={() => setOpenId(claim.id)}>{claim.description}</button></td>
                        <td className="px-4 py-3 text-ink-muted">{claim.payment_method === "REIMBURSABLE" ? "Reimburse" : "Petty cash"}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatAmount(claim.amount, claim.currency)}</td>
                        <td className="px-4 py-3"><Badge size="sm" dot tone={expenseTone(claim.status)}>{EXPENSE_STATUS_LABELS[claim.status] ?? claim.status_label}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
      {open && <FinanceDrawer claim={open} accounts={data.accounts} can={can} userId={user?.id} onClose={() => setOpenId(null)} onChanged={() => { reload(); }} />}
      {creating && <PettyCashDialog accounts={data.accounts.filter((account) => account.account_type === "EXPENSE")} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(); }} />}
    </div>
  );
}

function FinanceDrawer({ claim, accounts, can, userId, onClose, onChanged }: { claim: ExpenseClaim; accounts: Account[]; can: (code: string) => boolean; userId?: string; onClose: () => void; onChanged: () => void }) {
  const [comment, setComment] = useState("");
  const [recodes, setRecodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);
  const [reversing, setReversing] = useState(false);
  const expenseAccounts = accounts.filter((account) => account.account_type === "EXPENSE");
  const own = claim.created_by === userId;

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await action(); onChanged(); onClose(); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setBusy(null); }
  };
  const changedRecodes = Object.fromEntries(Object.entries(recodes).filter(([lineId, accountId]) => claim.lines.find((line) => line.id === lineId)?.account !== accountId));

  const footer = (() => {
    if (claim.status === "FINANCE_REVIEW" && can("expense.finance_review")) {
      return (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-ink-strong">Comment for the claimant<textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Required to return or reject; also justifies accepting a missing receipt." className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-sm" /></label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="danger" disabled={!comment.trim() || busy !== null} loading={busy === "reject"} onClick={() => void run("reject", () => expensesApi.financeReviewExpense(claim.id, "reject", comment))}>Reject</Button>
            <Button variant="secondary" disabled={!comment.trim() || busy !== null} loading={busy === "return"} onClick={() => void run("return", () => expensesApi.financeReviewExpense(claim.id, "return", comment))}>Return</Button>
            <Button disabled={busy !== null} loading={busy === "approve"} onClick={() => void run("approve", () => expensesApi.financeReviewExpense(claim.id, "approve", comment, changedRecodes))}>Approve{Object.keys(changedRecodes).length ? " with recoding" : ""}</Button>
          </div>
        </div>
      );
    }
    if (claim.status === "APPROVED" && can("expense.post")) return <div className="flex justify-end"><Button loading={busy === "post"} onClick={() => void run("post", () => expensesApi.postExpenseClaim(claim.id))}>Post to ledger</Button></div>;
    if (claim.status === "POSTED") {
      return (
        <div className="flex flex-wrap justify-end gap-2">
          {can("expense.post") && <Button variant="ghost" onClick={() => setReversing(true)}>Reverse</Button>}
          {claim.payment_method === "REIMBURSABLE" && can("expense.settle") && <Button onClick={() => setSettling(true)}>Record settlement</Button>}
        </div>
      );
    }
    if (claim.status === "PENDING" && !claim.claimant && can("expense.approve")) {
      return <div className="flex justify-end gap-2">{own && <p className="mr-auto self-center text-caption text-ink-muted">You entered this expense; another approver must decide it.</p>}<Button variant="secondary" disabled={own} loading={busy === "reject"} onClick={() => void run("reject", () => accountingApi.rejectExpense(claim.id))}>Reject</Button><Button disabled={own} loading={busy === "approve"} onClick={() => void run("approve", () => accountingApi.approveExpense(claim.id))}>Approve</Button></div>;
    }
    if (claim.status === "DRAFT" && !claim.claimant && can("expense.create")) return <div className="flex justify-end"><Button loading={busy === "submit"} onClick={() => void run("submit", () => expensesApi.submitExpenseClaim(claim.id))}>Submit for approval</Button></div>;
    return undefined;
  })();

  return (
    <Drawer open onClose={onClose} width="lg" title={claim.description} description={claim.claimant_name ? `Claimed by ${claim.claimant_name}` : "Entered by finance"} footer={footer}>
      {error && <div className="mb-4"><ErrorState variant="inline" title="Action failed" message={error} /></div>}
      <ExpenseClaimDetail
        claim={claim}
        lineExtra={claim.status === "FINANCE_REVIEW" && can("expense.finance_review") ? (line) => (
          <label className="mt-2 block text-caption font-medium text-ink-muted">Expense account
            <select value={recodes[line.id ?? ""] ?? line.account ?? ""} onChange={(event) => setRecodes((current) => ({ ...current, [line.id ?? ""]: event.target.value }))} className="mt-1 h-8 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm text-ink-strong">
              {expenseAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
            </select>
          </label>
        ) : undefined}
      />
      {settling && <SettleDialog claim={claim} accounts={accounts.filter((account) => account.account_type === "ASSET")} onClose={() => setSettling(false)} onDone={() => { setSettling(false); onChanged(); onClose(); }} />}
      {reversing && <ReverseDialog claim={claim} onClose={() => setReversing(false)} onDone={() => { setReversing(false); onChanged(); onClose(); }} />}
    </Drawer>
  );
}

function SettleDialog({ claim, accounts, onClose, onDone }: { claim: ExpenseClaim; accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const [account, setAccount] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setError(null);
    try { await expensesApi.settleExpenseClaim(claim.id, { settlement_account: account, settlement_date: date, reference }); onDone(); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Record settlement" description={`Record that ${formatAmount(claim.amount, claim.currency)} was paid to ${claim.claimant_name ?? "the claimant"}. This posts Dr employee payable / Cr the account below. It does not send money.`}
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!account} loading={saving} onClick={() => void save()}>Record settlement</Button></div>}>
      {error && <ErrorState variant="inline" title="Settlement not recorded" message={error} />}
      <div className="grid gap-3">
        <label className="text-sm font-medium text-ink-strong">Paid from<select value={account} onChange={(event) => setAccount(event.target.value)} className={`mt-1 ${fieldClass}`}><option value="">Choose a bank or cash account</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label className="text-sm font-medium text-ink-strong">Settlement date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`mt-1 ${fieldClass}`} /></label>
        <label className="text-sm font-medium text-ink-strong">Reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Transfer or voucher reference" className={`mt-1 ${fieldClass}`} /></label>
      </div>
    </Dialog>
  );
}

function ReverseDialog({ claim, onClose, onDone }: { claim: ExpenseClaim; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(toISODate(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setSaving(true); setError(null);
    try { await expensesApi.reverseExpenseClaim(claim.id, { reason, reversal_date: date }); onDone(); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Reverse posted expense" description="Posts a reversing journal linked to this claim. The claim ends as Reversed and cannot be edited."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} loading={saving} onClick={() => void save()}>Reverse</Button></div>}>
      {error && <ErrorState variant="inline" title="Reversal failed" message={error} />}
      <div className="grid gap-3">
        <label className="text-sm font-medium text-ink-strong">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} className={`mt-1 ${fieldClass}`} /></label>
        <label className="text-sm font-medium text-ink-strong">Reversal date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`mt-1 ${fieldClass}`} /></label>
      </div>
    </Dialog>
  );
}

function CategoryManager({ categories, accounts, onChanged }: { categories: ExpenseCategory[]; accounts: Account[]; onChanged: () => void }) {
  const [draft, setDraft] = useState({ code: "", name: "", expense_account: "", max_amount: "", receipt_required_over: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountName = (id: string) => { const account = accounts.find((item) => item.id === id); return account ? `${account.code} — ${account.name}` : "—"; };
  const create = async () => {
    setSaving(true); setError(null);
    try {
      await expensesApi.createExpenseCategory({ code: draft.code.trim().toUpperCase(), name: draft.name.trim(), expense_account: draft.expense_account, max_amount: draft.max_amount || null, receipt_required_over: draft.receipt_required_over || null, is_active: true });
      setDraft({ code: "", name: "", expense_account: "", max_amount: "", receipt_required_over: "" });
      onChanged();
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const toggle = async (category: ExpenseCategory) => {
    try { await expensesApi.updateExpenseCategory(category.id, { is_active: !category.is_active }); onChanged(); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
  };
  return (
    <div className="space-y-5 p-4">
      <p className="text-support text-ink-muted">Claimants choose a category; its expense account is used at posting (finance may recode during review). Limits and receipt thresholds drive the policy checks.</p>
      {error && <ErrorState variant="inline" title="Category not saved" message={error} />}
      <div className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-2 lg:grid-cols-6">
        <input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="Code" className={fieldClass} />
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Name" className={`${fieldClass} lg:col-span-2`} />
        <select value={draft.expense_account} onChange={(event) => setDraft({ ...draft, expense_account: event.target.value })} className={fieldClass}><option value="">Expense account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select>
        <input inputMode="decimal" value={draft.max_amount} onChange={(event) => setDraft({ ...draft, max_amount: event.target.value })} placeholder="Limit per item" className={fieldClass} />
        <input inputMode="decimal" value={draft.receipt_required_over} onChange={(event) => setDraft({ ...draft, receipt_required_over: event.target.value })} placeholder="Receipt above" className={fieldClass} />
        <div className="sm:col-span-2 lg:col-span-6"><Button size="sm" disabled={!draft.code.trim() || !draft.name.trim() || !draft.expense_account} loading={saving} onClick={() => void create()}>Add category</Button></div>
      </div>
      {categories.length === 0 ? <EmptyState icon={Receipt} title="No categories yet" description="Staff cannot claim expenses until at least one category exists." /> : (
        <table className="w-full text-left text-sm">
          <thead className="text-caption uppercase tracking-[0.06em] text-ink-muted"><tr><th className="py-2 font-semibold">Category</th><th className="py-2 font-semibold">Expense account</th><th className="py-2 text-right font-semibold">Limit</th><th className="py-2 text-right font-semibold">Receipt above</th><th className="py-2 font-semibold">Status</th></tr></thead>
          <tbody className="divide-y divide-line-soft">
            {categories.map((category) => (
              <tr key={category.id}>
                <td className="py-2.5"><span className="font-semibold text-ink-strong">{category.name}</span><span className="ml-2 text-caption text-ink-muted">{category.code}</span></td>
                <td className="py-2.5 text-ink-muted">{accountName(category.expense_account)}</td>
                <td className="py-2.5 text-right tabular-nums">{category.max_amount ?? "—"}</td>
                <td className="py-2.5 text-right tabular-nums">{category.receipt_required_over ?? "—"}</td>
                <td className="py-2.5"><button type="button" onClick={() => void toggle(category)} className="text-caption font-semibold text-primary-ink hover:underline">{category.is_active ? "Active · deactivate" : "Inactive · activate"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PettyCashDialog({ accounts, onClose, onSaved }: { accounts: Account[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ expense_date: toISODate(new Date()), account: "", amount: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true); setError(null);
    try { await accountingApi.createExpense(form); onSaved(); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Petty-cash expense" description="An expense already paid out of petty cash. It needs approval by someone else, then posts against the CASH mapping."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!form.account || !(Number(form.amount) > 0) || !form.description.trim()} loading={saving} onClick={() => void save()}>Create draft</Button></div>}>
      {error && <ErrorState variant="inline" title="Expense not created" message={error} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-ink-strong">Date<input type="date" value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} className={`mt-1 ${fieldClass}`} /></label>
        <label className="text-sm font-medium text-ink-strong">Amount<input inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className={`mt-1 ${fieldClass}`} /></label>
        <label className="text-sm font-medium text-ink-strong sm:col-span-2">Expense account<select value={form.account} onChange={(event) => setForm({ ...form, account: event.target.value })} className={`mt-1 ${fieldClass}`}><option value="">Choose…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select></label>
        <label className="text-sm font-medium text-ink-strong sm:col-span-2">Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={`mt-1 ${fieldClass}`} /></label>
      </div>
    </Dialog>
  );
}
