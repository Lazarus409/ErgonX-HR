"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, FileText, Info, Maximize2, Pencil, Play, Settings2, ShieldCheck, UsersRound, ZoomIn } from "lucide-react";

import ReportFormDialog, { type ReportDialogMode } from "@/components/accounting/ReportFormDialog";
import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import type { ReportRuns, SavedReport } from "@/types/accounting";

type Tab = "report" | "summary" | "notes";
type Side = "details" | "parameters" | "access" | "versions";

/** Concept "Financial report detail". */
export default function FinancialReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAccess();
  const [report, setReport] = useState<SavedReport | null>(null);
  const [runs, setRuns] = useState<ReportRuns | null>(null);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("report");
  const [side, setSide] = useState<Side>("details");
  const [dialog, setDialog] = useState<ReportDialogMode | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState(100);
  const [running, setRunning] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([accountingApi.getSavedReport(id), accountingApi.getSavedReportRuns(id, runId)])
      .then(([nextReport, nextRuns]) => { if (active) { setReport(nextReport); setRuns(nextRuns); } })
      .catch((caught) => { if (active) setError(getApiErrorMessage(caught)); });
    return () => { active = false; };
  }, [id, runId, attempt]);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); refresh(); }} />;
  if (!report || !runs) return <LoadingState />;
  const run = runs.run;
  const result = run?.result;
  const canManage = can("financial_report.manage");
  const execute = async () => {
    setRunning(true);
    setProblem(null);
    try { const next = await accountingApi.runSavedReport(report.id); setRunId(next.id); refresh(); } catch (caught) { setProblem(getApiErrorMessage(caught)); } finally { setRunning(false); }
  };
  const exportCsv = () => {
    if (!result) return;
    const lines: string[][] = [[result.title, result.subtitle], [`Version ${run?.version}`, `Generated ${run?.created_at ?? ""}`], [], ["Code", "Line item", ...result.columns, ...(result.bucket_columns ?? [])]];
    result.sections.forEach((section) => {
      lines.push([section.title]);
      section.rows.forEach((row) => lines.push([row.code, row.label, row.current, ...(row.comparative !== null ? [row.comparative] : []), ...(result.bucket_columns ?? []).map((name) => row.buckets?.[name] ?? "")]));
      lines.push(["", `Total ${section.title.toLowerCase()}`, section.total, ...(section.total_comparative !== null ? [section.total_comparative] : []), ...(result.bucket_columns ?? []).map((name) => section.bucket_totals?.[name] ?? "")]);
    });
    result.totals.forEach((total) => lines.push(["", total.label, total.current, ...(total.comparative !== null ? [total.comparative] : [])]));
    const url = URL.createObjectURL(new Blob([lines.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `${report.code || report.name}-v${run?.version ?? 0}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const saveNotes = async () => {
    if (notes === null) return;
    try { const saved = await accountingApi.updateSavedReport(report.id, { notes }); setReport(saved); setNotes(null); } catch (caught) { setProblem(getApiErrorMessage(caught)); }
  };
  const columns = result?.columns ?? [];
  const buckets = result?.bucket_columns ?? [];
  const period = result?.subtitle ?? EM_DASH;

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted print:hidden"><Link href="/accounting/dashboard" className="hover:underline">Home</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><Link href="/accounting/reports" className="hover:underline">Financial Reports</Link><ChevronRight className="mx-1 inline h-4 w-4" aria-hidden="true" /><span className="font-medium text-ink-strong">{report.name}</span></nav>
      <div className="print:hidden"><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">{report.name}</h1><p className="mt-1.5 text-[1.0625rem] text-heading-support">{report.description || report.report_type_label}</p></div>

      <div className="flex flex-col gap-4 border-b border-line-soft pb-4 xl:flex-row xl:items-end xl:justify-between print:hidden">
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          {([["Report type", report.report_type_label], ["Reporting period", period], ["Institution", runs.institution.name], ["Owner", report.owner_name ?? "System"]] as const).map(([label, value]) => <div key={label}><dt className="font-semibold text-ink-strong">{label}</dt><dd className="mt-0.5 text-ink">{value}</dd></div>)}
          <div><dt className="font-semibold text-ink-strong">Status</dt><dd className="mt-0.5"><StatusBadge status={run?.status === "COMPLETED" ? "GENERATED" : run?.status ?? report.status} size="sm" /></dd><dd className="text-caption text-ink-muted">{run ? `Generated on ${formatDateTime(run.created_at)}` : "Not run yet"}</dd></div>
        </dl>
        <div className="flex gap-2">
          <Menu label="More" trigger={(props) => <Button {...props} variant="secondary" size="lg" aria-label="More actions">⋮</Button>}>
            {(close) => (
              <div className="p-1.5">
                {canManage && <MenuItem icon={<UsersRound className="h-4 w-4" />} onSelect={() => { close(); setDialog("access"); }}>Access controls</MenuItem>}
                <MenuItem icon={<Download className="h-4 w-4" />} onSelect={() => { close(); exportCsv(); }}>Export CSV</MenuItem>
              </div>
            )}
          </Menu>
          <Button size="lg" loading={running} leadingIcon={<Play className="h-5 w-5" />} onClick={() => void execute()}>Run report</Button>
        </div>
      </div>

      {problem && <ErrorState variant="inline" title="Report not run" message={problem} />}
      {run?.status === "FAILED" && <ErrorState variant="inline" title="This run failed" message={run.error} />}

      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <Tabs label="Report sections" value={tab} onChange={(value) => setTab(value as Tab)} items={[{ value: "report", label: "Report" }, { value: "summary", label: "Summary" }, { value: "notes", label: "Notes" }]} />
        <div className="flex flex-wrap gap-2 pb-2">
          <Button variant="secondary" leadingIcon={<Eye className="h-4 w-4" />} disabled={!result} onClick={() => window.print()}>Preview</Button>
          <Button variant="secondary" leadingIcon={<Download className="h-4 w-4" />} trailingIcon={<ChevronDown className="h-4 w-4" />} disabled={!result} onClick={exportCsv}>Export</Button>
          {canManage && <Button variant="secondary" leadingIcon={<CalendarClock className="h-4 w-4" />} onClick={() => setDialog("schedule")}>Schedule</Button>}
          {canManage && <Button variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />} onClick={() => setDialog("edit")}>Edit</Button>}
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {tab === "report" && (
            <section className="overflow-hidden rounded-2xl border border-line bg-surface-muted shadow-elevation-1 print:border-0 print:shadow-none">
              <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 print:hidden">
                <span className="text-sm text-ink-muted">Version {run?.version ?? EM_DASH}</span>
                <span className="flex-1" />
                <select aria-label="Zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm">{[80, 90, 100, 110, 125].map((value) => <option key={value} value={value}>{value}%</option>)}</select>
                <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(125, value + 10))} className="rounded p-1.5 hover:bg-surface-hover"><ZoomIn className="h-4 w-4" /></button>
                <button type="button" aria-label="Print" onClick={() => window.print()} className="rounded p-1.5 hover:bg-surface-hover"><Maximize2 className="h-4 w-4" /></button>
              </div>
              <div className="overflow-auto p-4 print:p-0">
                {!result ? (
                  <div className="flex flex-col items-center rounded-xl bg-surface py-14 text-center"><FileText className="h-10 w-10 text-ink-subtle" aria-hidden="true" /><p className="mt-2 font-bold text-headline">Run the report to generate it</p><p className="text-support text-ink-muted">Each run is kept as a version you can return to.</p></div>
                ) : (
                  <article className="mx-auto bg-surface p-7 text-ink shadow-elevation-1 print:shadow-none" style={{ width: `${zoom}%`, minWidth: zoom > 100 ? `${zoom}%` : undefined, fontSize: `${(zoom / 100) * 0.875}rem` }}>
                    <div className="flex flex-wrap justify-between gap-4 border-b border-line pb-4">
                      <div><p className="font-semibold">{runs.institution.name}</p><p className="text-[1.5em] font-bold text-ink-strong">{result.title}</p><p className="text-ink-muted">{result.subtitle}</p>{runs.institution.currency && <p className="text-caption text-ink-muted">All amounts are in {runs.institution.currency}.</p>}</div>
                      <div className="text-right text-caption text-ink-muted"><p>Generated: {formatDateTime(run?.created_at)}</p><p>Report ID: {report.code || EM_DASH} · v{run?.version}</p><p>Prepared by: {run?.run_by ?? "Scheduled run"}</p></div>
                    </div>
                    <table className="mt-4 w-full">
                      <thead className="text-left text-caption font-semibold"><tr><th className="py-2">Line item</th>{columns.map((column) => <th key={column} className="py-2 text-right">{column}</th>)}{buckets.map((column) => <th key={column} className="py-2 text-right">{column}</th>)}</tr></thead>
                      <tbody>
                        {result.sections.map((section) => {
                          const closed = collapsed[section.title];
                          return [
                            <tr key={`${section.title}-head`} className="bg-primary-soft/50"><td colSpan={1 + columns.length + buckets.length} className="px-2 py-1.5"><button type="button" onClick={() => setCollapsed((current) => ({ ...current, [section.title]: !closed }))} className="flex items-center gap-1.5 font-bold text-ink-strong" aria-expanded={!closed}><ChevronDown className={cx("h-4 w-4 transition", closed && "-rotate-90")} aria-hidden="true" />{section.title}</button></td></tr>,
                            ...(closed ? [] : section.rows.map((row, index) => (
                              <tr key={`${section.title}-${index}`} className="border-b border-line-soft"><td className="py-1.5 pl-7">{row.code && <span className="mr-2 text-ink-muted">{row.code}</span>}{row.label}</td><td className="py-1.5 text-right tabular-nums">{formatAmount(row.current)}</td>{row.comparative !== null && columns.length > 1 && <td className="py-1.5 text-right tabular-nums text-ink-muted">{formatAmount(row.comparative)}</td>}{buckets.map((name) => <td key={name} className="py-1.5 text-right tabular-nums">{formatAmount(row.buckets?.[name] ?? 0)}</td>)}</tr>
                            ))),
                            <tr key={`${section.title}-total`} className="font-semibold"><td className="py-1.5 pl-3">Total {section.title.toLowerCase()}</td><td className="py-1.5 text-right tabular-nums">{formatAmount(section.total)}</td>{section.total_comparative !== null && columns.length > 1 && <td className="py-1.5 text-right tabular-nums">{formatAmount(section.total_comparative)}</td>}{buckets.map((name) => <td key={name} className="py-1.5 text-right tabular-nums">{formatAmount(section.bucket_totals?.[name] ?? 0)}</td>)}</tr>,
                          ];
                        })}
                        {result.totals.map((total) => <tr key={total.label} className="bg-surface-muted font-bold text-ink-strong"><td className="px-2 py-2">{total.label}</td><td className="py-2 text-right tabular-nums">{formatAmount(total.current)}</td>{total.comparative !== null && columns.length > 1 && <td className="py-2 text-right tabular-nums">{formatAmount(total.comparative)}</td>}</tr>)}
                      </tbody>
                    </table>
                    {result.sections.every((section) => !section.rows.length) && <p className="py-6 text-center text-ink-muted">No posted activity for these parameters.</p>}
                    {"balanced" in result.checks && <p className={cx("mt-4 text-caption font-semibold", result.checks.balanced ? "text-success-ink" : "text-danger-ink")}>{result.checks.balanced ? "✓ The statement balances." : "The statement does not balance; review the ledger."}</p>}
                  </article>
                )}
              </div>
            </section>
          )}
          {tab === "summary" && (
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <h2 className="text-heading font-bold text-headline">Summary</h2>
              {result ? <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{result.summary.map((item) => <div key={item.label} className="rounded-xl bg-surface-muted p-3"><dt className="text-caption text-ink-muted">{item.label}</dt><dd className="text-heading font-bold tabular-nums">{/^-?\d/.test(item.value) ? formatAmount(item.value) : item.value}</dd></div>)}</dl> : <p className="mt-2 text-support text-ink-muted">Run the report to see its summary.</p>}
            </section>
          )}
          {tab === "notes" && (
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <h2 className="text-heading font-bold text-headline">Notes</h2>
              <p className="text-support text-ink-muted">Commentary shown alongside this report (for example, for the board pack).</p>
              <textarea rows={8} value={notes ?? report.notes} disabled={!canManage} onChange={(event) => setNotes(event.target.value)} className="mt-3 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" aria-label="Report notes" />
              {canManage && <div className="mt-2 flex justify-end"><Button disabled={notes === null} onClick={() => void saveNotes()}>Save notes</Button></div>}
            </section>
          )}
        </div>

        <aside className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 print:hidden">
          <Tabs label="Report information" value={side} onChange={(value) => setSide(value as Side)} items={[{ value: "details", label: "Details" }, { value: "parameters", label: "Parameters" }, { value: "access", label: "Access" }, { value: "versions", label: "Versions", count: runs.versions.length }]} />
          <div className="mt-4 space-y-5 text-sm">
            {side === "details" && (
              <>
                <InfoBlock icon={FileText} title="Report information" rows={[["Report name", report.name], ["Report type", report.report_type_label], ["Reporting period", period], ["Institution", runs.institution.name], ["Owner", report.owner_name ?? "System"], ["Generated on", run ? formatDateTime(run.created_at) : "Not run"], ["Report ID", report.code || "Standard report"], ["Description", report.description || EM_DASH]]} />
                <InfoBlock icon={ShieldCheck} title="Audit information" rows={[["Created on", formatDateTime(report.created_at)], ["Last modified on", formatDateTime(report.updated_at)], ["Last activity", runs.audit[0] ? `${humanizeEnum(runs.audit[0].action.split(".").slice(-1)[0])} by ${runs.audit[0].actor}` : EM_DASH]]} />
              </>
            )}
            {side === "parameters" && (
              <>
                <InfoBlock icon={Settings2} title="Report parameters" rows={Object.keys(run?.parameters ?? report.parameters).length ? Object.entries(run?.parameters ?? report.parameters).map(([key, value]) => [humanizeEnum(key), typeof value === "boolean" ? (value ? "Yes" : "No") : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatDate(String(value)) : String(value)]) : [["Defaults", "Run date / year to date"]]} />
                <InfoBlock icon={CalendarClock} title="Schedule" rows={[["Frequency", humanizeEnum(report.schedule_frequency)], ["Next run", report.next_run_on ? formatDate(report.next_run_on) : EM_DASH]]} />
                {canManage && <button type="button" onClick={() => setDialog("edit")} className="inline-flex items-center gap-1 font-semibold text-primary-ink hover:underline">Edit parameters<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}
              </>
            )}
            {side === "access" && (
              <>
                <InfoBlock icon={UsersRound} title="Access controls" rows={[["Visibility", report.allowed_roles.length ? "Restricted" : "Everyone with financial report access"], ["Allowed roles", report.allowed_roles.length ? report.allowed_roles.map((role) => humanizeEnum(role)).join(", ") : "All finance roles"]]} />
                {canManage && <button type="button" onClick={() => setDialog("access")} className="inline-flex items-center gap-1 font-semibold text-primary-ink hover:underline">Manage access<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>}
              </>
            )}
            {side === "versions" && (
              runs.versions.length ? <ul className="divide-y divide-line-soft">{runs.versions.map((version) => <li key={version.id}><button type="button" onClick={() => setRunId(version.id)} className={cx("flex w-full items-center justify-between py-2 text-left hover:bg-surface-hover", version.id === run?.id && "font-semibold text-primary-ink")}><span>v{version.version} · {formatDateTime(version.created_at)}<span className="block text-caption text-ink-muted">{version.scheduled ? "Scheduled run" : version.run_by ?? EM_DASH}</span></span><StatusBadge status={version.status === "COMPLETED" ? "GENERATED" : version.status} size="sm" /></button></li>)}</ul> : <p className="text-ink-muted">No versions yet. Run the report to create version 1.</p>
            )}
            <p className="flex gap-2 rounded-lg bg-surface-muted p-2.5 text-caption text-ink-muted"><Info className="h-4 w-4 shrink-0" aria-hidden="true" />Figures come from posted ledger entries at the time of each run; earlier versions stay unchanged.</p>
          </div>
        </aside>
      </div>
      <Link href="/accounting/reports" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-ink hover:underline print:hidden"><ChevronLeft className="h-4 w-4" aria-hidden="true" />All financial reports</Link>

      {dialog && <ReportFormDialog mode={dialog} report={report} onClose={() => setDialog(null)} onSaved={(saved) => { setReport(saved); setDialog(null); }} />}
    </div>
  );
}

function InfoBlock({ icon: Icon, title, rows }: { icon: typeof FileText; title: string; rows: Array<[string, string] | string[]> }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 font-bold text-headline"><Icon className="h-5 w-5 text-section-icon" aria-hidden="true" />{title}</h3>
      <dl className="mt-2 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-y-1.5">{rows.map(([label, value]) => [<dt key={`${label}-t`} className="text-ink-muted">{label}</dt>, <dd key={`${label}-d`} className="break-words text-ink-strong">{value}</dd>])}</dl>
    </div>
  );
}
