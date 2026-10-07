"use client";

import { BarChart3, Briefcase, CalendarDays, ChevronRight, Clock3, Download, FileBarChart, ListTree, Receipt, Scale, Users, WalletCards, X, type LucideIcon } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart } from "@/components/charts/Charts";
import { Button } from "@/components/ui/Button";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import BackNavigation from "@/components/ui/BackNavigation";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import EmptyState from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { apiDownload, getApiErrorMessage, reportsApi } from "@/lib/api";
import { REPORT_GROUP_FIELDS, reportPath, type ReportFilters } from "@/lib/api/reports";
import { useApiResource } from "@/lib/useApiResource";
import { useAuth } from "@/components/guards/AuthProvider";
import { hasModule } from "@/types/institutions";
import { cx } from "@/lib/cx";
import { moduleAccents, type ModuleAccent } from "@/lib/moduleTheme";
import { humanizeEnum } from "@/lib/format";
import { isModuleOffered } from "@/lib/product";

// `permissions` mirrors REPORT_PERMISSIONS in apps/reports/views.py: beyond report.view,
// each report needs the permissions that guard its underlying records. Each inner list
// is one requirement, met by any of its codes. Leave and attendance need a management
// permission, since leave.view / attendance.view alone are self-service.
// report.all (directors, auditors) opens every report, read-only.
const LEAVE_BROAD = ["leave.approve", "leave.reject", "leave.configure", "leave.balance.manage", "dashboard.leave.view"];
const ATTENDANCE_BROAD = ["attendance.manage", "attendance.approve", "schedule.manage", "dashboard.attendance.view"];
const reports = [
  { id: "workforce-cost", title: isModuleOffered("PAYROLL") ? "Workforce Cost" : "Workforce", group: "Workforce", module: "CORE_HR", permissions: [["employee.view"], ["payroll.view"]] },
  { id: "recruitment", title: "Recruitment Activity", group: "Recruitment", module: "RECRUITMENT", permissions: [["candidate.view"]] },
  { id: "leave", title: "Leave Activity", group: "Leave", module: "LEAVE", permissions: [LEAVE_BROAD] },
  { id: "attendance", title: "Attendance", group: "Attendance", module: "ATTENDANCE", permissions: [ATTENDANCE_BROAD] },
  { id: "payroll", title: "Payroll", group: "Payroll", module: "PAYROLL", permissions: [["payroll.view"]] },
  { id: "accounting", title: "Journal Activity", group: "Accounting", module: "ACCOUNTING", permissions: [["journal.view"]] },
  { id: "ap-ar", title: "AP / AR", group: "Accounting", module: "ACCOUNTING", permissions: [["invoice.view"], ["vendor_bill.view"]] },
  { id: "expenses", title: "Expenses", group: "Accounting", module: "ACCOUNTING", permissions: [["expense.view"]] },
] as const;
type ReportId = typeof reports[number]["id"];

const reportVisuals: Record<ReportId, { icon: LucideIcon; accent: ModuleAccent }> = {
  "workforce-cost": { icon: Users, accent: "hr" },
  recruitment: { icon: Briefcase, accent: "recruitment" },
  leave: { icon: CalendarDays, accent: "leave" },
  attendance: { icon: Clock3, accent: "attendance" },
  payroll: { icon: WalletCards, accent: "payroll" },
  accounting: { icon: Scale, accent: "accounting" },
  "ap-ar": { icon: FileBarChart, accent: "accounting" },
  expenses: { icon: Receipt, accent: "accounting" },
};

type ReportRow = Record<string, string | number | null>;

const isNumericValue = (value: unknown) => typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value));
const numericColumn = (rows: ReportRow[], column: string) => rows.length > 0 && rows.every((row) => row[column] === null || row[column] === undefined || isNumericValue(row[column]));
const sortValue = (value: string | number | null) => (typeof value === "number" ? value : value !== null && isNumericValue(value) ? Number(value) : value);

async function downloadCsv(path: string, filters: ReportFilters, filename: string) {
  const blob = await apiDownload(path, { export: "csv", ...filters });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

/** The records behind one summary row, e.g. every employee counted as ABSENT. */
function ReportDrillDown({ report, title, group, filters, onClose }: { report: ReportId; title: string; group: string[]; filters: ReportFilters; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const load = useCallback(() => reportsApi.getReportDetails(report, group, filters), [report, group, filters]);
  const { data, loading, error, reload } = useApiResource(load);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const columns = useMemo(() => Array.from(new Set(rows.flatMap((row) => Object.keys(row)))), [rows]);
  const label = group.map((value) => humanizeEnum(value)).join(" · ");
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [group]);
  const download = async () => {
    setDownloading(true); setDownloadError(null);
    try { await downloadCsv(reportPath(report, group), filters, `ergonx-${report}-${group.join("-").toLowerCase()}.csv`); }
    catch (caught) { setDownloadError(getApiErrorMessage(caught)); }
    finally { setDownloading(false); }
  };
  return (
    <div ref={ref} className="scroll-mt-24 space-y-3">
      {downloadError && <ErrorState variant="inline" title="Unable to export these records" message={downloadError} />}
      <DataTable<ReportRow>
        caption={`${title}: ${label}`}
        rows={data?.rows}
        rowKey={(_, index) => `${report}-${group.join("-")}-${index}`}
        loading={loading}
        error={error}
        onRetry={reload}
        minWidth={Math.max(640, columns.length * 130)}
        empty={{ title: "No records", description: "Nothing in this row matches the current filters.", icon: ListTree }}
        toolbar={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-caption font-medium text-ink-muted">{title}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />Details</p>
              <h2 className="text-card-title font-bold text-headline">{label}</h2>
              <p className="text-support text-ink-muted">{loading && !data ? "Loading records…" : `${rows.length} record${rows.length === 1 ? "" : "s"}${rows.length >= 1000 ? " (first 1,000 shown; the CSV has the same limit)" : ""}.`}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" loading={downloading} loadingLabel="Preparing…" onClick={() => void download()} leadingIcon={<Download className="h-4 w-4" />} disabled={!rows.length}>CSV</Button>
              <Button variant="ghost" size="sm" onClick={onClose} leadingIcon={<X className="h-4 w-4" />}>Close</Button>
            </div>
          </div>
        }
        columns={columns.map((column) => ({
          key: column,
          header: humanizeEnum(column),
          numeric: numericColumn(rows, column),
          sortValue: (row: ReportRow) => sortValue(row[column]),
          cell: (row: ReportRow) => (column === "status" && row[column] ? <StatusBadge status={String(row[column])} size="sm" /> : ((row[column] === "" ? "—" : row[column]) ?? "—") as React.ReactNode),
        }))}
      />
    </div>
  );
}

/** Report viewer; `?report=<id>&status=&date_from=&date_to=` opens a saved library report. */
export default function ReportsDashboardPage() {
  return <Suspense fallback={<LoadingState variant="table" />}><ReportsDashboard /></Suspense>;
}

function ReportsDashboard() {
  const params = useSearchParams();
  const { institution, user } = useAuth();
  const visibleReports = useMemo(() => {
    const granted = new Set(user?.permissions ?? []);
    const has = (code: string) => granted.has("*") || granted.has(code);
    return reports.filter((item) => hasModule(institution?.enabledModules, item.module) && has("report.view") && (has("report.all") || item.permissions.every((requirement) => requirement.some(has))));
  }, [institution?.enabledModules, user?.permissions]);
  const [selected, setSelected] = useState<ReportId>(() => reports.find((item) => item.id === params.get("report"))?.id ?? "workforce-cost");
  const [status, setStatus] = useState(() => params.get("status") ?? "");
  const [dateFrom, setDateFrom] = useState(() => params.get("date_from") ?? "");
  const [dateTo, setDateTo] = useState(() => params.get("date_to") ?? "");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [drill, setDrill] = useState<string[] | null>(null);
  const activeSelected = visibleReports.some((item) => item.id === selected) ? selected : (visibleReports[0]?.id ?? selected);
  const supportsStatus = activeSelected !== "ap-ar";
  const filters = useMemo(() => ({ ...(supportsStatus ? { status: status || undefined } : {}), date_from: dateFrom || undefined, date_to: dateTo || undefined }), [supportsStatus, status, dateFrom, dateTo]);
  const load = useCallback(() => visibleReports.length ? reportsApi.getReport(activeSelected, filters) : Promise.resolve({ report: activeSelected, rows: [] }), [activeSelected, filters, visibleReports.length]);
  const { data, loading, error, reload } = useApiResource(load);
  const columns = useMemo(() => Array.from(new Set((data?.rows ?? []).flatMap((row) => Object.keys(row)))), [data]);
  const report = visibleReports.find((item) => item.id === activeSelected) ?? visibleReports[0];
  const download = async () => {
    setDownloading(true); setDownloadError(null);
    try {
      await downloadCsv(reportPath(activeSelected), filters, `ergonx-${activeSelected}${status ? `-${status.toLowerCase()}` : ""}.csv`);
    } catch (caught) { setDownloadError(getApiErrorMessage(caught)); }
    finally { setDownloading(false); }
  };
  const isNumericColumn = (column: string) => numericColumn(data?.rows ?? [], column);
  const groupFields = REPORT_GROUP_FIELDS[activeSelected];
  const openRow = (row: ReportRow) => {
    const group = groupFields.map((field) => String(row[field] ?? ""));
    if (group.every(Boolean)) setDrill(group);
  };
  // A drill-down belongs to the report and filters it was opened from.
  const setFilter = (update: () => void) => { update(); setDrill(null); };

  // At-a-glance visual: the first descriptive column against the first measure.
  const labelColumn = columns.find((column) => !isNumericColumn(column));
  const valueColumn = columns.find((column) => isNumericColumn(column) && !/(^|_)(id|year|month|day)$/.test(column));
  const chartRows = labelColumn && valueColumn
    ? (data?.rows ?? []).filter((row) => row[valueColumn] !== null && row[valueColumn] !== undefined).slice(0, 12).map((row) => ({ label: String(row[labelColumn] ?? "—"), value: Number(row[valueColumn]) }))
    : [];
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <BackNavigation fallback="/reports" label="Back to Reports & Analytics" />
      <PageHeader
        eyebrow="Reports & Analytics"
        title="Report viewer"
        description="Summaries of the areas your role can see. Download any report as CSV."
        icon={BarChart3}
        accent="reports"
        actions={<Button disabled={!visibleReports.length} loading={downloading} loadingLabel="Preparing CSV…" onClick={() => void download()} leadingIcon={<Download className="h-4 w-4" />}>Download CSV</Button>}
      />
      {downloadError && <ErrorState variant="inline" title="Unable to export this report" message={downloadError} />}
      {!visibleReports.length ? (
        <EmptyState icon={BarChart3} accent="reports" title="No reports available" description="No reports are available for your current permissions and enabled modules." />
      ) : (
        <>
          <section aria-label="Choose a report" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {visibleReports.map((item) => {
              const visual = reportVisuals[item.id];
              const Icon = visual.icon;
              const active = activeSelected === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={active}
                  onClick={() => { setSelected(item.id); setStatus(""); setDrill(null); }}
                  className={cx(
                    "group relative flex items-center gap-3 overflow-hidden rounded-2xl border bg-surface p-4 text-left shadow-elevation-1 transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2",
                    active ? "border-mod-reports ring-4 ring-mod-reports/12" : "border-line",
                  )}
                >
                  <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", moduleAccents[visual.accent].tile)} aria-hidden="true"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0">
                    <span className="block text-caption font-medium text-ink-muted">{item.group}</span>
                    <span className="block truncate text-sm font-semibold text-ink-strong">{item.title}</span>
                  </span>
                </button>
              );
            })}
          </section>

          {labelColumn && valueColumn && chartRows.length >= 2 && (
            <ChartCard
              title={`${report?.title ?? "Report"} at a glance`}
              description={`${humanizeEnum(valueColumn)} by ${humanizeEnum(labelColumn).toLowerCase()}${(data?.rows.length ?? 0) > chartRows.length ? `, first ${chartRows.length} rows` : ""}.`}
              accent="reports"
              icon={BarChart3}
              data={{ columns: [humanizeEnum(labelColumn), humanizeEnum(valueColumn)], rows: chartRows.map((row) => [row.label, row.value]) }}
            >
              <BarsChart data={chartRows} xKey="label" layout="horizontal" height={Math.max(160, chartRows.length * 36)} series={[{ key: "value", label: humanizeEnum(valueColumn), color: "var(--mod-reports)" }]} />
            </ChartCard>
          )}

          <DataTable<ReportRow>
            caption={report?.title ?? "Report"}
            rows={data?.rows}
            rowKey={(_, index) => `${activeSelected}-${index}`}
            loading={loading}
            error={error}
            onRetry={reload}
            onRowClick={openRow}
            minWidth={Math.max(600, columns.length * 140)}
            empty={{ title: "No report rows", description: "No report rows found for this institution and filter selection.", icon: FileBarChart }}
            toolbar={
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-card-title font-bold text-headline">{report?.title}</h2>
                    <p className="text-support text-ink-muted">Live summary. Select a row to see the records behind it. The CSV download uses the filters you set here.</p>
                  </div>
                  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-caption font-semibold text-ink-muted tabular-nums">{data?.rows.length ?? 0} rows</span>
                </div>
                <DataToolbar
                  filters={
                    <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-auto">
                      {supportsStatus && <Field label="Status"><Input size="sm" value={status} onChange={(event) => { const value = event.target.value.toUpperCase(); setFilter(() => setStatus(value)); }} placeholder="e.g. APPROVED" /></Field>}
                      <Field label="From"><Input size="sm" type="date" value={dateFrom} onChange={(event) => { const value = event.target.value; setFilter(() => setDateFrom(value)); }} /></Field>
                      <Field label="To"><Input size="sm" type="date" value={dateTo} onChange={(event) => { const value = event.target.value; setFilter(() => setDateTo(value)); }} /></Field>
                    </div>
                  }
                  onClear={status || dateFrom || dateTo ? () => setFilter(() => { setStatus(""); setDateFrom(""); setDateTo(""); }) : undefined}
                />
              </div>
            }
            columns={columns.map((column) => ({
              key: column,
              header: humanizeEnum(column),
              numeric: isNumericColumn(column),
              sortValue: (row: ReportRow) => sortValue(row[column]),
              cell: (row: ReportRow) => {
                const value = (row[column] ?? "—") as React.ReactNode;
                const opensRow = column === groupFields[groupFields.length - 1] && groupFields.every((field) => row[field]);
                const selectedRow = drill !== null && groupFields.every((field, index) => String(row[field] ?? "") === drill[index]);
                return opensRow ? <span className={cx("inline-flex items-center gap-1 font-semibold", selectedRow ? "text-primary-ink" : "text-ink-strong group-hover:text-primary-ink")}>{value}<ChevronRight className="h-3.5 w-3.5 opacity-60" aria-hidden="true" /></span> : value;
              },
            }))}
          />

          {drill && report && <ReportDrillDown report={activeSelected} title={report.title} group={drill} filters={filters} onClose={() => setDrill(null)} />}
        </>
      )}
    </div>
  );
}
