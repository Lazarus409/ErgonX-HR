"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { formatAmount } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { BUDGET_CATEGORIES, BUDGET_TYPES, type BudgetRecord } from "@/types/accounting";

type Line = { category: string; account: string; description: string; initiative: string; allocated: string };
const inputClass = "h-10 w-full rounded-lg border border-line-strong bg-surface px-2.5 text-sm";
const emptyLine = (): Line => ({ category: "OPERATING", account: "", description: "", initiative: "", allocated: "" });

/** Create or edit a budget; lines can be typed or imported from a CSV template. */
export default function BudgetForm({ budget }: { budget?: BudgetRecord }) {
  const router = useRouter();
  const { user } = useAccess();
  const load = useCallback(async () => {
    const options = await accountingApi.getBudgetOptions();
    return { years: options.fiscal_years, departments: options.departments, accounts: options.accounts };
  }, []);
  const { data, loading, error } = useApiResource(load);
  const [form, setForm] = useState({ name: budget?.name ?? "", fiscal_year: budget?.fiscal_year ?? "", department: budget?.department ?? "", budget_type: budget?.budget_type ?? "OPERATING", description: budget?.description ?? "" });
  const [lines, setLines] = useState<Line[]>(() => budget?.lines.map((line) => ({ category: line.category, account: line.account ?? "", description: line.description, initiative: line.initiative, allocated: line.allocated })) ?? [emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const total = lines.reduce((sum, line) => sum + (Number(line.allocated) || 0), 0);
  const setLine = (index: number, patch: Partial<Line>) => { setDirty(true); return setLines((current) => current.map((line, position) => (position === index ? { ...line, ...patch } : line))); };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const [header, ...rows] = text.split(/\r?\n/).filter((row) => row.trim());
    const columns = header.split(",").map((cell) => cell.trim().toLowerCase());
    const at = (name: string) => columns.indexOf(name);
    if (at("category") < 0 || at("allocated") < 0) { setProblem("The template needs at least 'category' and 'allocated' columns (optional: account_code, description, initiative)."); return; }
    const categories = new Map(BUDGET_CATEGORIES.flatMap(([value, label]) => [[value.toLowerCase(), value], [label.toLowerCase(), value]]));
    const imported: Line[] = [];
    const skipped: number[] = [];
    rows.forEach((row, index) => {
      const cells = row.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
      const category = categories.get((cells[at("category")] ?? "").toLowerCase());
      const allocated = Number((cells[at("allocated")] ?? "").replace(/[^\d.]/g, ""));
      if (!category || !Number.isFinite(allocated)) { skipped.push(index + 2); return; }
      const code = at("account_code") >= 0 ? cells[at("account_code")] : "";
      imported.push({ category, allocated: allocated.toFixed(2), account: data?.accounts.find((account) => account.code === code)?.id ?? "", description: at("description") >= 0 ? cells[at("description")] ?? "" : "", initiative: at("initiative") >= 0 ? cells[at("initiative")] ?? "" : "" });
    });
    if (imported.length) setLines(imported);
    setNotice(`Imported ${imported.length} line(s)${skipped.length ? `; skipped rows ${skipped.join(", ")}` : ""}. Review before saving.`);
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    if (!form.name.trim() || !form.fiscal_year) { setProblem("Name and fiscal period are required."); return; }
    if (lines.some((line) => !line.allocated || Number(line.allocated) < 0)) { setProblem("Every line needs a non-negative allocation."); return; }
    setSaving(true);
    setProblem(null);
    try {
      const payload = {
        name: form.name.trim(), fiscal_year: form.fiscal_year, department: form.department || null, budget_type: form.budget_type,
        owner: budget?.owner ?? user?.id ?? null, description: form.description.trim(),
        lines: lines.map((line) => ({ category: line.category, account: line.account || null, description: line.description.trim(), initiative: line.initiative.trim(), allocated: Number(line.allocated).toFixed(2) })),
      };
      const saved = budget ? await accountingApi.updateBudget(budget.id, payload) : await accountingApi.createBudget(payload);
      router.push(`/accounting/budgets/${saved.id}`);
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load budget choices."} />;
  return (
    <div className="space-y-5">
      <Link href={budget ? `/accounting/budgets/${budget.id}` : "/accounting/budgets"} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to budgets</Link>
      <div><h1 className="text-[1.75rem] font-bold leading-9 text-headline sm:text-title">{budget ? "Edit budget" : "Create budget"}</h1><p className="mt-1.5 text-heading-support">{budget?.status === "APPROVED" ? "Saving changes to an approved budget starts a new version that needs approval." : "Allocate by category. Link an expense account to track actual spend from the ledger."}</p></div>
      {problem && <ErrorState variant="inline" title="Budget not saved" message={problem} />}
      {notice && <p className="rounded-xl bg-primary-soft/60 px-4 py-3 text-sm text-primary-ink">{notice}</p>}
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 sm:grid-cols-2 lg:grid-cols-4">
        <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Budget name <span className="text-danger-ink">*</span></span><input value={form.name} onChange={(event) => { setDirty(true); setForm({ ...form, name: event.target.value }); }} placeholder="e.g. FY2026 Operating Budget" className={inputClass} /></label>
        <label><span className="mb-1.5 block text-sm font-semibold">Fiscal period <span className="text-danger-ink">*</span></span><select value={form.fiscal_year} onChange={(event) => { setDirty(true); setForm({ ...form, fiscal_year: event.target.value }); }} className={inputClass}><option value="">Select a period</option>{data.years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
        <label><span className="mb-1.5 block text-sm font-semibold">Budget type</span><select value={form.budget_type} onChange={(event) => { setDirty(true); setForm({ ...form, budget_type: event.target.value }); }} className={inputClass}>{BUDGET_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Department / cost centre</span><select value={form.department} onChange={(event) => { setDirty(true); setForm({ ...form, department: event.target.value }); }} className={inputClass}><option value="">Institution-wide</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Description</span><input value={form.description} onChange={(event) => { setDirty(true); setForm({ ...form, description: event.target.value }); }} className={inputClass} /></label>
      </section>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-heading font-bold text-headline">Budget lines</h2><p className="text-support text-ink-muted">Total allocated: <strong className="tabular-nums">{formatAmount(total)}</strong></p></div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCsv(file); }} />
            <Button variant="secondary" leadingIcon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>Import budget template</Button>
            <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setLines((current) => [...current, emptyLine()])}>Add line</Button>
          </div>
        </div>
        <p className="mt-1 text-caption text-ink-muted">Template columns: category, allocated, and optionally account_code, description, initiative.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-surface-muted text-left text-caption font-semibold"><tr><th className="px-2 py-2">Category</th><th className="px-2 py-2">Ledger account (for actuals)</th><th className="px-2 py-2">Description</th><th className="px-2 py-2">Initiative</th><th className="px-2 py-2 text-right">Allocated</th><th className="w-10 px-2 py-2" /></tr></thead>
            <tbody className="divide-y divide-line-soft">
              {lines.map((line, index) => (
                <tr key={index}>
                  <td className="px-2 py-2"><select aria-label="Category" value={line.category} onChange={(event) => setLine(index, { category: event.target.value })} className={inputClass}>{BUDGET_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                  <td className="px-2 py-2"><select aria-label="Ledger account" value={line.account} onChange={(event) => setLine(index, { account: event.target.value })} className={inputClass}><option value="">Not linked</option>{data.accounts.map((account) => <option key={account.id} value={account.id}>{account.code} {account.name}</option>)}</select></td>
                  <td className="px-2 py-2"><input aria-label="Description" value={line.description} onChange={(event) => setLine(index, { description: event.target.value })} className={inputClass} /></td>
                  <td className="px-2 py-2"><input aria-label="Initiative" value={line.initiative} onChange={(event) => setLine(index, { initiative: event.target.value })} className={inputClass} /></td>
                  <td className="px-2 py-2"><input aria-label="Allocated" type="number" min={0} step="0.01" value={line.allocated} onChange={(event) => setLine(index, { allocated: event.target.value })} className={`${inputClass} text-right`} /></td>
                  <td className="px-2 py-2"><Button variant="ghost" size="sm" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="flex justify-end gap-2"><Button variant="ghost" size="lg" onClick={() => (dirty ? setLeaving(true) : router.push(budget ? `/accounting/budgets/${budget.id}` : "/accounting/budgets"))}>Cancel</Button><Button size="lg" loading={saving} leadingIcon={<Save className="h-5 w-5" />} onClick={() => void save()}>{budget ? "Save changes" : "Save as draft"}</Button></div>
      <ConfirmDialog open={leaving} tone="warning" title="Discard changes?" description="You have unsaved changes. If you leave now, your changes will be lost." cancelLabel="Keep editing" confirmLabel="Discard" onCancel={() => setLeaving(false)} onConfirm={() => router.push(budget ? `/accounting/budgets/${budget.id}` : "/accounting/budgets")} />
    </div>
  );
}
