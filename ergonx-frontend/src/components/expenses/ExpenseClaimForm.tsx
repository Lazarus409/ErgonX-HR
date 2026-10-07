"use client";

import { Paperclip, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import { Drawer } from "@/components/ui/Overlay";
import { expensesApi, getApiErrorMessage } from "@/lib/api";
import { toISODate } from "@/lib/format";
import type { ExpenseCategory, ExpenseClaim } from "@/types/expenses";

interface DraftLine { key: number; category: string; expense_date: string; description: string; amount: string; receipts: Array<{ id: string; name: string }> }

const fieldClass = "h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong";

function toDraft(claim: ExpenseClaim | null): DraftLine[] {
  if (!claim?.lines.length) return [{ key: 1, category: "", expense_date: toISODate(new Date()), description: "", amount: "", receipts: [] }];
  return claim.lines.map((line, index) => ({ key: index + 1, category: line.category, expense_date: line.expense_date, description: line.description, amount: line.amount, receipts: line.receipts.map((id) => ({ id, name: "Attached receipt" })) }));
}

/** Create or edit a claim (draft or returned). Claimants pick categories, never GL accounts. */
export default function ExpenseClaimForm({ claim, categories, onClose, onSaved }: { claim: ExpenseClaim | null; categories: ExpenseCategory[]; onClose: () => void; onSaved: (claim: ExpenseClaim) => void }) {
  const [description, setDescription] = useState(claim?.description ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => toDraft(claim));
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const update = (key: number, patch: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const ready = description.trim() && lines.every((line) => line.category && line.expense_date && Number(line.amount) > 0);

  const attach = async (key: number, file: File | undefined) => {
    if (!file) return;
    setUploading(key); setError(null);
    try {
      const document = await expensesApi.uploadExpenseReceipt(file);
      setLines((current) => current.map((line) => (line.key === key ? { ...line, receipts: [...line.receipts, { id: document.id, name: file.name }] } : line)));
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setUploading(null); }
  };

  const save = async (submit: boolean) => {
    setSaving(submit ? "submit" : "draft"); setError(null);
    const payload = {
      description: description.trim(),
      lines: lines.map((line) => ({ category: line.category, expense_date: line.expense_date, description: line.description.trim() || (categories.find((item) => item.id === line.category)?.name ?? "Expense"), amount: Number(line.amount).toFixed(2), receipts: line.receipts.map((receipt) => receipt.id) })),
    };
    try {
      let saved = claim ? await expensesApi.updateExpenseClaim(claim.id, payload) : await expensesApi.createExpenseClaim(payload);
      if (submit) saved = await expensesApi.submitExpenseClaim(saved.id);
      onSaved(saved);
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(null); }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="lg"
      title={claim ? "Edit expense claim" : "New expense claim"}
      description="Add each item with its category and a receipt where the category requires one. You are reimbursed after finance approves and records settlement."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">Total <span className="font-semibold tabular-nums text-ink-strong">{total.toFixed(2)}</span></span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!ready || saving !== null} loading={saving === "draft"} loadingLabel="Saving…" onClick={() => void save(false)}>Save draft</Button>
            <Button disabled={!ready || saving !== null} loading={saving === "submit"} loadingLabel="Submitting…" onClick={() => void save(true)}>Submit claim</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {error && <ErrorState variant="inline" title="Claim not saved" message={error} />}
        {categories.length === 0 && <p className="rounded-lg bg-warning-soft p-3 text-support text-warning-ink">Finance has not set up any expense categories yet, so claims cannot be created.</p>}
        <label className="block text-sm font-semibold text-ink-strong">Purpose<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. Client visit to Kumasi" className={`mt-1.5 ${fieldClass}`} /></label>
        <ul className="space-y-3">
          {lines.map((line, index) => {
            const category = categories.find((item) => item.id === line.category);
            const needsReceipt = category?.receipt_required_over != null && Number(line.amount) > Number(category.receipt_required_over);
            return (
              <li key={line.key} className="rounded-xl border border-line p-4">
                <div className="flex items-center justify-between"><p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Item {index + 1}</p>{lines.length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="rounded p-1 text-ink-muted hover:text-danger" aria-label={`Remove item ${index + 1}`}><Trash2 className="h-4 w-4" /></button>}</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-ink-strong">Category<select value={line.category} onChange={(event) => update(line.key, { category: event.target.value })} className={`mt-1 ${fieldClass}`}><option value="">Choose…</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label className="text-sm font-medium text-ink-strong">Date<input type="date" value={line.expense_date} max={toISODate(new Date())} onChange={(event) => update(line.key, { expense_date: event.target.value })} className={`mt-1 ${fieldClass}`} /></label>
                  <label className="text-sm font-medium text-ink-strong">Description<input value={line.description} onChange={(event) => update(line.key, { description: event.target.value })} placeholder="What was it for?" className={`mt-1 ${fieldClass}`} /></label>
                  <label className="text-sm font-medium text-ink-strong">Amount<input inputMode="decimal" value={line.amount} onChange={(event) => update(line.key, { amount: event.target.value.replace(/[^\d.]/g, "") })} placeholder="0.00" className={`mt-1 ${fieldClass} tabular-nums`} /></label>
                </div>
                {category?.max_amount && Number(line.amount) > Number(category.max_amount) && <p className="mt-2 text-caption text-danger-ink">Above the {category.name} limit of {category.max_amount}.</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {line.receipts.map((receipt) => <span key={receipt.id} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-caption text-ink"><Paperclip className="h-3 w-3" aria-hidden="true" />{receipt.name}<button type="button" onClick={() => update(line.key, { receipts: line.receipts.filter((item) => item.id !== receipt.id) })} className="ml-1 text-ink-muted hover:text-danger" aria-label={`Remove ${receipt.name}`}>×</button></span>)}
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-line-strong px-2.5 py-1 text-caption font-semibold text-primary-ink hover:bg-surface-muted">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />{uploading === line.key ? "Uploading…" : "Attach receipt"}
                    <input type="file" className="sr-only" disabled={uploading !== null} onChange={(event) => { void attach(line.key, event.target.files?.[0]); event.target.value = ""; }} />
                  </label>
                  {needsReceipt && !line.receipts.length && <span className="text-caption text-warning-ink">A receipt is required above {category?.receipt_required_over}.</span>}
                </div>
              </li>
            );
          })}
        </ul>
        <Button variant="ghost" size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setLines((current) => [...current, { key: Math.max(...current.map((line) => line.key)) + 1, category: "", expense_date: toISODate(new Date()), description: "", amount: "", receipts: [] }])}>Add item</Button>
      </div>
    </Drawer>
  );
}
