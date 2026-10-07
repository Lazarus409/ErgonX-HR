"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { BookOpen, CalendarClock, Eye, FileText, Filter, Folder, Layers, Lock, Play, Plus, Search, Upload, UsersRound } from "lucide-react";

import ReportFormDialog, { type ReportDialogMode } from "@/components/accounting/ReportFormDialog";
import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { REPORT_CATEGORIES, REPORT_TYPES, type SavedReport } from "@/types/accounting";

const STATUSES: Array<[string, string]> = [["DRAFT", "Draft"], ["SCHEDULED", "Scheduled"], ["COMPLETED", "Completed"], ["FAILED", "Failed"]];

function periodOf(report: SavedReport) {
  const params = report.parameters;
  if (params.as_of) return `As at ${formatDate(String(params.as_of))}`;
  if (params.date_from || params.date_to) return `${params.date_from ? formatDate(String(params.date_from)) : "Year start"} – ${params.date_to ? formatDate(String(params.date_to)) : "run date"}`;
  return ["BALANCE_SHEET", "AR_AGING", "AP_AGING"].includes(report.report_type) ? "As at run date" : report.report_type === "BUDGET_VS_ACTUAL" ? "Latest fiscal year" : "Year to date";
}

/** Concept "Financial reports" (option 2). */
export default function FinancialReportsPage() {
  const router = useRouter();
  const { can } = useAccess();
  const load = useCallback(() => accountingApi.listSavedReports(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const [search, setSearch] = useState("");
  const [folder, setFolder] = useState<string>("ALL");
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ReportDialogMode | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reports = useMemo(() => data?.results ?? [], [data]);
  const rows = reports.filter((report) => (folder === "ALL" || (folder === "POPULAR" ? report.is_standard : report.category === folder))
    && (!types.length || types.includes(report.report_type)) && (!statuses.length || statuses.includes(report.status))
    && (!search.trim() || `${report.name} ${report.description}`.toLowerCase().includes(search.trim().toLowerCase())));
  const chosen = reports.find((report) => report.id === selected) ?? null;
  const canManage = can("financial_report.manage");
  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const run = async (report: SavedReport) => {
    setRunning(true);
    setProblem(null);
    try { await accountingApi.runSavedReport(report.id); router.push(`/accounting/reports/${report.id}`); } catch (caught) { setProblem(getApiErrorMessage(caught)); } finally { setRunning(false); }
  };
  const exportLatest = async (report: SavedReport) => {
    try {
      const { run: latest } = await accountingApi.getSavedReportRuns(report.id);
      const target = latest ?? await accountingApi.runSavedReport(report.id);
      const lines = [[target.result.title, target.result.subtitle], [], ["Code", "Line", ...target.result.columns]];
      target.result.sections.forEach((section) => { lines.push([section.title]); section.rows.forEach((row) => lines.push([row.code, row.label, row.current, ...(row.comparative !== null ? [row.comparative] : [])])); lines.push(["", `Total ${section.title.toLowerCase()}`, section.total, ...(section.total_comparative !== null ? [section.total_comparative] : [])]); });
      target.result.totals.forEach((total) => lines.push(["", total.label, total.current, ...(total.comparative !== null ? [total.comparative] : [])]));
      const url = URL.createObjectURL(new Blob([lines.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
      const link = document.createElement("a"); link.href = url; link.download = `${report.code || report.name}-v${target.version}.csv`; link.click(); URL.revokeObjectURL(url);
    } catch (caught) { setProblem(getApiErrorMessage(caught)); }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Financial Reports</h1><p className="mt-1.5 text-[1.0625rem] text-heading-support">Create, run and manage financial reports for informed decision making.</p></div>
        {canManage && <Button size="lg" leadingIcon={<Plus className="h-5 w-5" />} onClick={() => setDialog("create")}>Create report</Button>}
      </header>
      {(problem || error) && <ErrorState variant="inline" title="Something went wrong" message={problem ?? error ?? ""} onRetry={error ? reload : undefined} />}

      <div className="grid items-start gap-4 xl:grid-cols-[17rem_minmax(0,1fr)] 2xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:row-span-2 2xl:row-span-1">
          <div className="flex items-start gap-3"><Layers className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">Report library</h2><p className="text-support text-heading-support">Browse and filter available reports.</p></div></div>
          <label className="relative mt-3 block"><span className="sr-only">Search reports</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports" className="h-10 w-full rounded-lg border border-line bg-surface-muted pl-9 pr-3 text-sm" /></label>
          <ul className="mt-3 space-y-0.5 text-sm">
            {([["ALL", "All reports", reports.length], ["POPULAR", "Popular reports", reports.filter((report) => report.is_standard).length], ...REPORT_CATEGORIES.map(([value, label]) => [value, label, reports.filter((report) => report.category === value).length])] as Array<[string, string, number]>).map(([value, label, count]) => (
              <li key={value}><button type="button" onClick={() => setFolder(value)} className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-hover", folder === value && "bg-primary-soft font-semibold text-primary-ink")}>{value === "ALL" ? <Layers className="h-5 w-5" aria-hidden="true" /> : <Folder className="h-5 w-5 text-ink-muted" aria-hidden="true" />}<span className="flex-1">{label}</span><span className="rounded-full bg-surface-muted px-2 text-caption font-semibold">{count}</span></button></li>
            ))}
          </ul>
          <fieldset className="mt-4 border-t border-line-soft pt-3"><legend className="text-sm font-semibold text-ink-strong">Report type</legend><div className="mt-2 space-y-1.5">{REPORT_TYPES.map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={types.includes(value)} onChange={() => setTypes((current) => toggle(current, value))} className="h-4 w-4" />{label}</label>)}</div></fieldset>
          <fieldset className="mt-4 border-t border-line-soft pt-3"><legend className="text-sm font-semibold text-ink-strong">Status</legend><div className="mt-2 space-y-1.5">{STATUSES.map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={statuses.includes(value)} onChange={() => setStatuses((current) => toggle(current, value))} className="h-4 w-4" />{label}</label>)}</div></fieldset>
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:order-3 2xl:order-none">
          <div className="flex items-start justify-between gap-3"><div><h2 className="text-heading font-bold text-headline">Reports</h2><p className="text-support text-heading-support">View and manage your reports.</p></div><span className="inline-flex items-center gap-1.5 text-sm text-ink-muted"><Filter className="h-4 w-4" aria-hidden="true" />{rows.length} of {reports.length}</span></div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-surface-muted text-left text-caption font-semibold uppercase tracking-wide text-ink-strong"><tr><th className="px-3 py-2">Report name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
              <tbody className="divide-y divide-line-soft">
                {loading && !data && [0, 1, 2, 3].map((index) => <tr key={index}><td colSpan={6} className="px-3 py-2.5"><div className="skeleton h-7 rounded" /></td></tr>)}
                {rows.map((report) => (
                  <tr key={report.id} onClick={() => setSelected(report.id)} className={cx("cursor-pointer hover:bg-surface-hover", report.id === selected && "bg-primary-soft/40")}>
                    <td className="px-3 py-2.5"><Link href={`/accounting/reports/${report.id}`} onClick={(event) => event.stopPropagation()} className="font-semibold text-primary-ink hover:underline">{report.name}</Link><span className="block text-caption text-ink-muted">{report.is_standard ? "Standard" : report.code}</span></td>
                    <td className="px-3 py-2.5 text-ink-muted">{report.report_type_label}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{periodOf(report)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={report.status} size="sm" /></td>
                    <td className="px-3 py-2.5 text-ink-muted">{report.owner_name ?? "System"}</td>
                    <td className="px-3 py-2.5 text-right"><Button size="sm" variant="secondary" loading={running && selected === report.id} leadingIcon={<Play className="h-4 w-4" />} onClick={(event) => { event.stopPropagation(); setSelected(report.id); void run(report); }}>Run</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !rows.length && <div className="flex flex-col items-center py-12 text-center"><span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><FileText className="h-9 w-9" aria-hidden="true" /></span><p className="mt-3 text-heading font-bold text-headline">No reports match</p><p className="mt-1 text-support text-ink-muted">Adjust the library filters or create a report.</p>{canManage && <Button className="mt-3" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setDialog("create")}>Create report</Button>}</div>}
          </div>
        </section>

        <aside className="space-y-3 xl:order-2 xl:grid xl:grid-cols-2 xl:gap-3 xl:space-y-0 2xl:order-none 2xl:block 2xl:space-y-3">
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 xl:col-span-2">
            <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><FileText className="h-6 w-6 text-section-icon" aria-hidden="true" />Report details</h2>
            {chosen ? (
              <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-y-1.5 text-sm"><dt className="text-ink-muted">Name</dt><dd className="font-semibold">{chosen.name}</dd><dt className="text-ink-muted">Type</dt><dd>{chosen.report_type_label}</dd><dt className="text-ink-muted">Folder</dt><dd>{chosen.category_label}</dd><dt className="text-ink-muted">Last run</dt><dd>{chosen.last_run_at ? formatDateTime(chosen.last_run_at) : "Never"}</dd><dt className="text-ink-muted">Schedule</dt><dd>{chosen.schedule_frequency === "NONE" ? "Not scheduled" : `${humanizeEnum(chosen.schedule_frequency)} · next ${formatDate(chosen.next_run_on)}`}</dd><dt className="text-ink-muted">Description</dt><dd className="text-ink">{chosen.description || EM_DASH}</dd></dl>
            ) : <p className="mt-3 text-support text-ink-muted">Select a report from the list to view details, preview and manage settings.</p>}
          </section>
          {([
            [Eye, "Preview", "View the latest output of the report.", "Preview report", () => chosen && router.push(`/accounting/reports/${chosen.id}`), true],
            [CalendarClock, "Schedule", "Set up a recurring schedule.", "Set up schedule", () => setDialog("schedule"), canManage],
            [Upload, "Export", "Download the latest run as CSV (runs it first if needed).", "Export report", () => chosen && void exportLatest(chosen), true],
            [UsersRound, "Access controls", "Manage who can view and run this report.", "Manage access", () => setDialog("access"), canManage],
          ] as const).map(([Icon, title, text, label, onClick, allowed]) => (
            <section key={title} className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
              <h2 className="flex items-center gap-2 font-bold text-headline"><Icon className="h-5 w-5 text-section-icon" aria-hidden="true" />{title}</h2>
              <p className="text-caption text-ink-muted">{text}</p>
              <Button className="mt-2" block variant="secondary" size="sm" disabled={!chosen || !allowed} onClick={onClick}>{label}</Button>
            </section>
          ))}
          {!canManage && <div className="flex gap-2.5 rounded-xl bg-primary-soft/60 p-3 text-sm xl:col-span-2"><Lock className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" /><div><p className="font-semibold text-headline">Restricted information</p><p className="text-ink">Creating and scheduling reports depends on your access permissions.</p></div></div>}
          <Link href="/accounting/journals" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-ink hover:underline xl:col-span-2"><BookOpen className="h-4 w-4" aria-hidden="true" />Account-level ledger detail lives in the General Ledger</Link>
        </aside>
      </div>

      {dialog && (dialog === "create" || chosen) && <ReportFormDialog mode={dialog} report={dialog === "create" ? null : chosen} onClose={() => setDialog(null)} onSaved={(saved) => { setDialog(null); setSelected(saved.id); reload(); }} />}
    </div>
  );
}
