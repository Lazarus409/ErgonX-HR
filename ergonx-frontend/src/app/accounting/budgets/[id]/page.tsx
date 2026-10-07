"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { BarChart3, Building2, CalendarDays, CheckCircle2, ChevronRight, Clock3, Download, Folder, Info, ListTree, MoreHorizontal, Pencil, Send, ShieldCheck, Undo2, UserRound } from "lucide-react";

import { AttachmentsPanel, Empty, Panel } from "@/components/accounting/RecordPanels";
import { Button, ButtonLink } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

type Tab = "overview" | "breakdown" | "initiatives" | "documents" | "notes";
const AUDIT_LABELS: Record<string, string> = {
  "accounting.budget.created": "Budget created",
  "accounting.budget.updated": "Budget updated",
  "accounting.budget.submitted": "Submitted for approval",
  "accounting.budget.approved": "Approved",
  "accounting.budget.returned": "Returned for changes",
  "accounting.budget.note_added": "Note added",
};

/** Concept "Budget detail". */
export default function BudgetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAccess();
  const load = useCallback(() => accountingApi.getBudgetDetail(id), [id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<Tab>("overview");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<"submit" | "approve" | "return" | null>(null);
  const [note, setNote] = useState("");
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Budget not found."} onRetry={reload} />;
  const { budget, totals } = data;
  const editable = can("budget.manage") && ["DRAFT", "RETURNED", "APPROVED"].includes(budget.status);
  const approver = can("budget.approve") && budget.status === "PENDING_APPROVAL" && data.people.submitted_by_id !== user?.id;
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try { await work(); setDialog(null); setNote(""); reload(); } catch (caught) { setProblem(getApiErrorMessage(caught)); setDialog(null); } finally { setBusy(false); }
  };
  const exportCsv = () => {
    const rows = [["Category", "Line", "Account", "Initiative", "Allocated", "Committed", "Actual", "Variance"], ...data.categories.flatMap((category) => category.lines.map((line) => [category.label, line.description, line.account ?? "", line.initiative, line.allocated, line.committed, line.actual, line.variance])), ["Total", "", "", "", totals.allocated, totals.committed, totals.actual, totals.variance]];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `${budget.code}-budget-vs-actual.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const summary: Array<[string, string, string]> = [["Allocated", totals.allocated, "Total allocation"], ["Committed", totals.committed, "Pending or approved bills"], ["Actual", totals.actual, "Posted to the ledger"], ["Remaining", totals.remaining, "Allocated − committed − actual"], ["Variance", totals.variance, "Allocated − actual"]];

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted"><Link href="/accounting/budgets" className="hover:underline">Budgets</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><span>Department / Functional Area budgets</span><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><span className="font-medium text-ink-strong">{budget.department_name ?? "Institution-wide"}</span></nav>
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-section-icon"><Folder className="h-8 w-8" aria-hidden="true" /></span>
          <div><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline">{budget.department_name ?? "Institution-wide"}</h1><p className="text-[1.125rem] text-heading-support">{budget.name}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(approver || editable) && (
            <Menu label="More actions" trigger={(props) => <Button {...props} variant="secondary" size="lg" aria-label="More actions"><MoreHorizontal className="h-5 w-5" /></Button>}>
              {(close) => (
                <div className="p-1.5">
                  {approver && <MenuItem icon={<CheckCircle2 className="h-4 w-4" />} onSelect={() => { close(); setDialog("approve"); }}>Approve budget</MenuItem>}
                  {approver && <MenuItem icon={<Undo2 className="h-4 w-4" />} onSelect={() => { close(); setDialog("return"); }}>Return for changes</MenuItem>}
                  <MenuItem icon={<Download className="h-4 w-4" />} onSelect={() => { close(); exportCsv(); }}>Export budget vs actual</MenuItem>
                </div>
              )}
            </Menu>
          )}
          {editable && <ButtonLink href={`/accounting/budgets/${budget.id}/edit`} size="lg" variant="secondary" leadingIcon={<Pencil className="h-5 w-5" />}>Edit</ButtonLink>}
          {can("budget.manage") && ["DRAFT", "RETURNED"].includes(budget.status) && <Button size="lg" leadingIcon={<Send className="h-5 w-5" />} onClick={() => setDialog("submit")}>Submit for approval</Button>}
          {approver && <Button size="lg" leadingIcon={<CheckCircle2 className="h-5 w-5" />} onClick={() => setDialog("approve")}>Approve</Button>}
        </div>
      </header>

      <div className="flex flex-wrap gap-6 border-b border-line-soft pb-4 text-sm">
        <div><p className="font-semibold text-ink-strong">Fiscal period</p><p className="mt-1 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-ink-muted" aria-hidden="true" />{formatDate(budget.period_start)} – {formatDate(budget.period_end)}</p></div>
        <div className="border-l border-line-soft pl-6"><p className="font-semibold text-ink-strong">Owner</p><p className="mt-1 flex items-center gap-2"><UserRound className="h-5 w-5 text-ink-muted" aria-hidden="true" />{budget.owner_name ?? EM_DASH}</p></div>
        <div className="border-l border-line-soft pl-6"><p className="font-semibold text-ink-strong">Status</p><div className="mt-1 flex gap-1"><StatusBadge status={budget.status} /><StatusBadge status={data.health} /></div></div>
      </div>

      {problem && <ErrorState variant="inline" title="Action not completed" message={problem} />}
      {budget.status === "RETURNED" && budget.approval_note && <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-ink"><p className="font-semibold">Returned for changes</p><p>{budget.approval_note}</p></div>}

      <Tabs label="Budget sections" value={tab} onChange={(value) => setTab(value as Tab)} items={[{ value: "overview", label: "Overview" }, { value: "breakdown", label: "Budget breakdown" }, { value: "initiatives", label: "Initiatives", count: data.initiatives.length }, { value: "documents", label: "Documents", count: data.attachments.length }, { value: "notes", label: "Notes", count: data.notes.length }]} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {(tab === "overview" || tab === "breakdown") && (
            <>
              {tab === "overview" && (
                <Panel icon={BarChart3} title="Budget summary">
                  <dl className="grid gap-4 sm:grid-cols-5 sm:divide-x sm:divide-line-soft">
                    {summary.map(([label, value, hint]) => <div key={label} className="sm:pl-4 first:sm:pl-0"><dt className="flex items-center gap-1 text-sm text-ink-muted" title={hint}>{label}<Info className="h-3.5 w-3.5" aria-hidden="true" /></dt><dd className={cx("mt-1 text-heading font-bold tabular-nums", (label === "Remaining" || label === "Variance") && Number(value) < 0 ? "text-danger-ink" : "text-ink-strong")}>{formatAmount(value)}</dd><p className="text-caption text-ink-muted">{hint}</p></div>)}
                  </dl>
                </Panel>
              )}
              <Panel icon={ListTree} title="Actual vs budget by category" action={<Button variant="secondary" leadingIcon={<Download className="h-4 w-4" />} disabled={!data.categories.length} onClick={exportCsv}>Export</Button>}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-sm">
                    <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Committed</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Variance</th><th className="px-3 py-2 text-right">% of budget</th></tr></thead>
                    <tbody className="divide-y divide-line-soft">
                      {data.categories.map((category) => {
                        const expanded = tab === "breakdown" || open[category.category];
                        return [
                          <tr key={category.category} className="hover:bg-surface-hover">
                            <td className="px-3 py-2"><button type="button" onClick={() => setOpen((current) => ({ ...current, [category.category]: !current[category.category] }))} aria-expanded={expanded} className="flex items-center gap-1.5 font-medium"><ChevronRight className={cx("h-4 w-4 transition", expanded && "rotate-90")} aria-hidden="true" />{category.label}</button></td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatAmount(category.allocated)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(category.committed)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(category.actual)}</td><td className={cx("px-3 py-2 text-right tabular-nums", Number(category.variance) < 0 && "text-danger-ink")}>{formatAmount(category.variance)}</td><td className="px-3 py-2 text-right tabular-nums">{category.percent_of_budget}%</td>
                          </tr>,
                          ...(expanded ? category.lines.map((line) => (
                            <tr key={line.id} className="bg-surface-muted/40 text-ink">
                              <td className="py-1.5 pl-10 pr-3"><span className="block">{line.description || EM_DASH}</span><span className="text-caption text-ink-muted">{line.account ?? "No ledger account (no actuals tracked)"}{line.initiative ? ` · ${line.initiative}` : ""}</span></td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{formatAmount(line.allocated)}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatAmount(line.committed)}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatAmount(line.actual)}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatAmount(line.variance)}</td><td />
                            </tr>
                          )) : []),
                        ];
                      })}
                      <tr className="bg-surface-muted font-bold"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(totals.allocated)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(totals.committed)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(totals.actual)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(totals.variance)}</td><td className="px-3 py-2 text-right">100%</td></tr>
                    </tbody>
                  </table>
                </div>
                {!data.categories.length && <Empty icon={ListTree} title="No budget data available" text="Budget allocations and actuals will appear here when lines are added." />}
              </Panel>
            </>
          )}
          {tab === "initiatives" && (
            <Panel icon={ListTree} title="Initiatives" description="Allocations grouped by initiative.">
              {data.initiatives.length ? <table className="w-full text-sm"><thead className="bg-surface-muted text-left text-caption font-semibold"><tr><th className="px-3 py-2">Initiative</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Committed</th><th className="px-3 py-2 text-right">Actual</th></tr></thead><tbody className="divide-y divide-line-soft">{data.initiatives.map((row) => <tr key={row.initiative}><td className="px-3 py-2 font-medium">{row.initiative}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.allocated)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.committed)}</td><td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.actual)}</td></tr>)}</tbody></table> : <Empty icon={ListTree} title="No initiatives" text="Tag budget lines with an initiative to group them here." />}
            </Panel>
          )}
          {tab === "documents" && <AttachmentsPanel resource="budgets" recordId={budget.id} attachments={data.attachments} canUpload={can("budget.manage")} onChanged={reload} />}
          {tab === "notes" && (
            <Panel icon={Info} title="Notes" description="Assumptions and discussion. Notes are added to the audit trail.">
              <div className="mb-4 space-y-2"><textarea rows={3} value={newNote} maxLength={4000} onChange={(event) => setNewNote(event.target.value)} placeholder="Add a note…" aria-label="New note" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /><div className="flex justify-end"><Button disabled={!newNote.trim()} onClick={() => void run(() => accountingApi.addBudgetNote(budget.id, newNote.trim()).then(() => setNewNote("")))}>Add note</Button></div></div>
              {data.notes.length ? <ul className="space-y-3">{data.notes.map((row) => <li key={row.id} className="rounded-xl bg-surface-muted p-3 text-sm"><p className="whitespace-pre-wrap">{row.body}</p><p className="mt-1 text-caption text-ink-muted">{row.author} · {formatDateTime(row.created_at)}</p></li>)}</ul> : <Empty icon={Info} title="No notes yet" text="Record assumptions behind the allocations." />}
            </Panel>
          )}
        </div>

        <aside className="space-y-5">
          <Panel icon={Clock3} title="Approval history">
            {budget.submitted_at || budget.status !== "DRAFT" ? (
              <ol className="space-y-3 text-sm">
                <Step done={Boolean(budget.submitted_at)} title="Submitted for approval" detail={budget.submitted_at ? `${data.people.submitted_by ?? EM_DASH} · ${formatDateTime(budget.submitted_at)}` : "Not submitted"} />
                {budget.status === "RETURNED" ? <Step done danger title="Returned for changes" detail={budget.approval_note} /> : <Step done={Boolean(budget.approved_at)} title="Approved" detail={budget.approved_at ? `${data.people.approved_by ?? EM_DASH} · ${formatDateTime(budget.approved_at)}${budget.approval_note ? ` · “${budget.approval_note}”` : ""}` : "Awaiting approver"} />}
              </ol>
            ) : <Empty icon={Clock3} title="No approvals yet" text="This budget has not been submitted for approval." />}
          </Panel>
          <Panel icon={Info} title="Budget information">
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 text-sm">
              {([["Budget ID", budget.code], ["Department", budget.department_name ?? "Institution-wide"], ["Budget type", humanizeEnum(budget.budget_type)], ["Fiscal period", `${formatDate(budget.period_start)} – ${formatDate(budget.period_end)}`], ["Created on", formatDate(budget.created_at)], ["Last updated", formatDateTime(budget.updated_at)], ["Created by", data.people.created_by ?? EM_DASH]] as const).map(([label, value]) => [<dt key={`${label}-t`} className="text-ink-muted">{label}</dt>, <dd key={`${label}-d`} className="font-medium text-ink-strong">{value}</dd>])}
            </dl>
          </Panel>
          <Panel icon={ShieldCheck} title="Audit information">
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-2 text-sm">
              <dt className="text-ink-muted">Last activity</dt><dd className="font-medium">{data.audit[0] ? `${AUDIT_LABELS[data.audit[0].action] ?? humanizeEnum(data.audit[0].action.split(".").slice(-1)[0])} · ${formatDateTime(data.audit[0].created_at)}` : EM_DASH}</dd>
              <dt className="text-ink-muted">Last modified by</dt><dd className="font-medium">{data.audit[0]?.actor ?? EM_DASH}</dd>
              <dt className="text-ink-muted">Version</dt><dd className="font-medium">{budget.version}</dd>
            </dl>
          </Panel>
          <Panel icon={Building2} title="How actuals are measured">
            <p className="text-sm text-ink-muted">Actual spend is posted ledger activity on each line&apos;s account within the fiscal period{budget.department_name ? `, tagged to ${budget.department_name}` : ""}. Committed spend is vendor bills pending or approved but not yet posted.</p>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog open={dialog === "submit"} title="Submit budget for approval?" description="Approvers are notified. The budget can't be edited while pending." confirmLabel="Submit" loading={busy} onCancel={() => setDialog(null)} onConfirm={() => void run(() => accountingApi.submitBudget(budget.id))} />
      <Dialog open={dialog === "approve" || dialog === "return"} onClose={() => setDialog(null)} title={dialog === "approve" ? "Approve budget" : "Return for changes"} description={dialog === "approve" ? "Approval locks this version of the budget." : "The owner can revise and resubmit."}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={dialog === "return" && !note.trim()} onClick={() => void run(() => dialog === "approve" ? accountingApi.approveBudget(budget.id, note.trim()) : accountingApi.returnBudget(budget.id, note.trim()))}>{dialog === "approve" ? "Approve" : "Return"}</Button></>}>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">{dialog === "approve" ? "Comment (optional)" : "What needs to change?"}</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
      </Dialog>
    </div>
  );
}

function Step({ done, danger, title, detail }: { done: boolean; danger?: boolean; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", danger ? "bg-warning text-white" : done ? "bg-success text-white" : "border-2 border-line-strong")}>{done && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}</span>
      <span><span className="block font-semibold text-ink-strong">{title}</span><span className="text-caption text-ink-muted">{detail}</span></span>
    </li>
  );
}

