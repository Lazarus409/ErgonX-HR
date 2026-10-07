"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  Info,
  Lock,
  Play,
  Search,
  Settings,
  Settings2,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";

import PayrollRunStepper from "@/components/payroll/PayrollRunStepper";
import { useAuth } from "@/components/guards/AuthProvider";
import { Button, ButtonLink } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, payrollApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { PayrollRun } from "@/types/payroll";

type WorkspaceAction = "start" | "calculate" | "submit";

const bannerCopy: Record<string, { title: string; text: string }> = {
  NONE: { title: "No payroll run for this period", text: "Start a run to calculate employee pay for the selected period." },
  DRAFT: { title: "Payroll run in draft", text: "Calculate the run to prepare employee records and detect exceptions." },
  CALCULATING: { title: "Payroll run calculating", text: "Employee records are being calculated." },
  CALCULATED: { title: "Payroll run in draft", text: "Complete your review, resolve any issues and submit for validation when ready." },
  UNDER_REVIEW: { title: "Payroll run validating", text: "The run is with payroll approvers for review and approval." },
  APPROVED: { title: "Payroll run approved", text: "Approved and locked; finalize to issue payslips and close the period." },
  FINALIZED: { title: "Payroll paid", text: "This period is finalized and payslips have been issued." },
  CANCELLED: { title: "Payroll run cancelled", text: "Start a new run for this period if payroll is still required." },
};

/** Concept "HR Payroll workspace" (option 2). */
export default function PayrollWorkspace() {
  const { user } = useAuth();
  const can = (permission: string) => Boolean(user?.permissions.includes("*") || user?.permissions.includes(permission));
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const [pending, setPending] = useState<WorkspaceAction | null>(null);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadPeriods = useCallback(async () => {
    const [periods, awaiting] = await Promise.all([
      payrollApi.listPayrollPeriods({ page_size: MAX_PAGE_SIZE, ordering: "-start_date" }).then((page) => page.results),
      payrollApi.listPayrollRuns({ status: "UNDER_REVIEW", page_size: 5 }).then((page) => page.results).catch(() => [] as PayrollRun[]),
    ]);
    return { periods, awaiting };
  }, []);
  const { data: base, loading: baseLoading, error: baseError, reload: reloadBase } = useApiResource(loadPeriods);
  const periods = useMemo(() => base?.periods ?? [], [base]);
  const today = new Date().toISOString().slice(0, 10);
  const defaultPeriod = periods.find((period) => period.start_date <= today && period.end_date >= today) ?? periods[0];
  const period = periods.find((item) => item.id === periodId) ?? defaultPeriod ?? null;

  const loadRun = useCallback(async () => {
    if (!period) return null;
    const runs = await payrollApi.listPayrollRuns({ payroll_period: period.id, ordering: "-run_number", page_size: 10 }).then((page) => page.results);
    const run = runs.find((item) => item.status !== "CANCELLED") ?? runs[0] ?? null;
    if (!run) return { run: null, records: [], exceptions: [], deadlines: await payrollApi.getPayrollPeriodComplianceDeadlines(period.id).catch(() => []) };
    const [records, exceptions, deadlines] = await Promise.all([
      payrollApi.listPayrollRecords({ payroll_run: run.id, page_size: MAX_PAGE_SIZE, ordering: "employee" }).then((page) => page.results).catch(() => []),
      payrollApi.listPayrollRunExceptions(run.id).catch(() => []),
      payrollApi.getPayrollPeriodComplianceDeadlines(period.id).catch(() => []),
    ]);
    return { run, records, exceptions, deadlines };
  }, [period]);
  const { data: current, loading: runLoading, error: runError, reload: reloadRun } = useApiResource(loadRun);

  const run = current?.run ?? null;
  const records = useMemo(() => current?.records ?? [], [current]);
  const exceptions = useMemo(() => current?.exceptions ?? [], [current]);
  const openByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of exceptions) if (item.status === "OPEN" && item.employee) map.set(item.employee, (map.get(item.employee) ?? 0) + 1);
    return map;
  }, [exceptions]);
  const visibleRecords = records.filter((record) => {
    const term = search.trim().toLowerCase();
    const matches = !term || record.employee_name?.toLowerCase().includes(term) || record.employee_number?.toLowerCase().includes(term);
    return matches && (!onlyExceptions || openByEmployee.has(record.employee));
  });
  const openCount = exceptions.filter((item) => item.status === "OPEN").length;
  const highOpen = exceptions.filter((item) => item.status === "OPEN" && item.severity === "HIGH").length;
  const status = run?.status ?? "NONE";
  const banner = bannerCopy[status] ?? bannerCopy.NONE;

  const bannerAction: { action: WorkspaceAction; label: string; disabled?: boolean } | null =
    !run || run.status === "CANCELLED" ? (can("payroll.prepare") && period?.status !== "CLOSED" ? { action: "start", label: "Start payroll run" } : null)
      : run.status === "DRAFT" && can("payroll.prepare") ? { action: "calculate", label: "Calculate payroll" }
        : run.status === "CALCULATED" && can("payroll.prepare") ? { action: "submit", label: "Submit for validation", disabled: highOpen > 0 }
          : null;

  const execute = async () => {
    if (!pending || !period) return;
    setRunning(true);
    setActionError(null);
    try {
      if (pending === "start") await payrollApi.createPayrollRun(period.id, `workspace-${period.id}-${Date.now()}`);
      if (pending === "calculate" && run) await payrollApi.calculatePayrollRun(run.id);
      if (pending === "submit" && run) await payrollApi.submitPayrollRunForReview(run.id);
      setPending(null);
      reloadRun();
      reloadBase();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
      setPending(null);
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = () => {
    if (!records.length) return;
    const rows = [["Employee number", "Employee", "Gross pay", "Deductions", "Net pay", "Currency", "Status", "Open exceptions"]];
    for (const record of records) rows.push([record.employee_number ?? "", record.employee_name ?? "", record.gross_pay, record.total_deductions, record.net_pay, record.currency, record.status, String(openByEmployee.get(record.employee) ?? 0)]);
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `payroll-${period?.name.replace(/\s+/g, "-").toLowerCase() ?? "run"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Payroll workspace</h1>
          <p className="mt-1.5 text-[1.0625rem] text-heading-support">Run, review and manage payroll with confidence.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="relative flex h-14 min-w-[18rem] items-center gap-3 rounded-lg border border-line-strong bg-surface pl-4 pr-10">
            <CalendarDays className="h-5 w-5 shrink-0 text-section-icon" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-caption text-ink-muted">Payroll period</span>
              <select data-ui="select" aria-label="Payroll period" value={period?.id ?? ""} onChange={(event) => setPeriodId(event.target.value)} className="w-full appearance-none truncate bg-transparent text-sm font-semibold text-ink-strong focus:outline-none">
                {periods.length === 0 && <option value="">No periods yet</option>}
                {periods.map((item) => <option key={item.id} value={item.id}>{item.name} ({formatDate(item.start_date)} – {formatDate(item.end_date)})</option>)}
              </select>
            </span>
            <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-ink-muted" aria-hidden="true" />
          </label>
          <ButtonLink href="/payroll/runs" size="lg" leadingIcon={<Play className="h-5 w-5" />}>Review payroll runs</ButtonLink>
        </div>
      </header>

      {(baseError || runError || actionError) && <ErrorState variant="inline" title="Payroll workspace" message={actionError ?? baseError ?? runError ?? ""} onRetry={() => { reloadBase(); reloadRun(); }} />}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" />
                <div><h2 className="text-heading font-bold text-headline">Current payroll run</h2><p className="text-support text-heading-support">Track the progress and status of the active payroll run.</p></div>
              </div>
              <div className="flex items-center gap-2">
                {run && <Link href={`/payroll/runs/${run.id}`} className="text-support font-semibold text-primary-ink hover:underline">{run.reference ?? `Run #${run.run_number}`}</Link>}
                <ButtonLink href="/payroll/runs" variant="secondary" leadingIcon={<Clock3 className="h-4 w-4" />}>View run history</ButtonLink>
              </div>
            </div>
            {baseLoading || runLoading ? <div className="skeleton h-40 rounded-xl" /> : (
              <>
                <PayrollRunStepper status={run?.status === "CANCELLED" ? null : run?.status} />
                <div className="mt-6 flex flex-col gap-3 rounded-xl border border-primary/15 bg-primary-soft/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Info className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="font-bold text-headline">{banner.title}</p>
                      <p className="text-support text-ink">{highOpen && run?.status === "CALCULATED" ? `Resolve ${highOpen} high-severity exception${highOpen === 1 ? "" : "s"} before submitting for validation.` : banner.text}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {run && openCount > 0 && <ButtonLink href={`/payroll/runs/${run.id}`} variant="secondary">Resolve exceptions ({openCount})</ButtonLink>}
                    {bannerAction && <Button disabled={bannerAction.disabled} onClick={() => setPending(bannerAction.action)}>{bannerAction.label}</Button>}
                    {run && !bannerAction && <ButtonLink href={`/payroll/runs/${run.id}`}>Open run</ButtonLink>}
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <Users className="mt-0.5 h-7 w-7 text-section-icon" aria-hidden="true" />
                <div><h2 className="text-heading font-bold text-headline">Payroll employee breakdown</h2><p className="text-support text-heading-support">Review employee payroll details for the selected period.</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="relative block">
                  <span className="sr-only">Search employees</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees" data-ui="input" className="h-10 w-52 rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" />
                </label>
                <button type="button" aria-pressed={onlyExceptions} onClick={() => setOnlyExceptions((value) => !value)} className={cx("inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold", onlyExceptions ? "border-primary bg-primary-soft text-primary-ink" : "border-line-strong text-ink-strong hover:bg-surface-hover")}>
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />With exceptions
                </button>
              </div>
            </div>
            {visibleRecords.length === 0 ? (
              <EmptyState size="compact" icon={Users} title="No employee payroll data available" description={records.length ? "No employees match your search or filter." : "Employee payroll records will be displayed here for the selected period once the payroll run has been prepared."} />
            ) : (
              <div className="-mx-5 overflow-x-auto sm:-mx-6">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="bg-surface-muted/80 text-left">{["Employee", "Gross pay", "Deductions", "Net pay", "Status", "Exceptions"].map((heading) => <th key={heading} scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">{heading}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line-soft">
                    {visibleRecords.map((record) => (
                      <tr key={record.id}>
                        <td className="px-5 py-3"><span className="block font-semibold text-headline">{record.employee_name}</span><span className="text-caption text-ink-muted">{record.employee_number}</span></td>
                        <td className="px-5 py-3 tabular-nums">{formatAmount(record.gross_pay, record.currency)}</td>
                        <td className="px-5 py-3 tabular-nums">{formatAmount(record.total_deductions, record.currency)}</td>
                        <td className="px-5 py-3 font-semibold tabular-nums">{formatAmount(record.net_pay, record.currency)}</td>
                        <td className="px-5 py-3"><StatusBadge status={record.status} size="sm" /></td>
                        <td className="px-5 py-3">{openByEmployee.get(record.employee) ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-caption font-semibold text-danger-ink">{openByEmployee.get(record.employee)} open</span> : <span className="text-ink-subtle">{EM_DASH}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mx-auto mt-5 flex max-w-xl items-start gap-3 rounded-xl border border-primary/15 bg-primary-soft/50 px-4 py-3">
              <Lock className="mt-0.5 h-6 w-6 shrink-0 text-section-icon" aria-hidden="true" />
              <div><p className="font-bold text-headline">Restricted information</p><p className="text-support text-heading-support">Payroll information is only visible to authorized HR and Finance users.</p></div>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <Rail icon={ShieldCheck} title="Approvals" description="Review and manage payroll approvals.">
            {(base?.awaiting.length ?? 0) === 0 ? (
              <RailEmpty icon={Users} title="No pending approvals" text="There are no payroll approvals required at this time." />
            ) : (
              <ul className="space-y-2">
                {base!.awaiting.map((item) => (
                  <li key={item.id}><Link href={`/payroll/runs/${item.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-surface-muted/60 px-3 py-2.5 text-support hover:bg-surface-hover"><span><span className="block font-semibold text-ink-strong">{item.period_name ?? item.reference}</span><span className="text-caption text-ink-muted">Submitted for approval</span></span><ChevronRight className="h-4 w-4 text-primary-ink" aria-hidden="true" /></Link></li>
                ))}
              </ul>
            )}
          </Rail>
          <Rail icon={ShieldCheck} title="Compliance checks" description="Ensure payroll meets policy and regulatory requirements.">
            {!run || ["DRAFT", "CALCULATING"].includes(run.status) ? (
              (current?.deadlines.length ?? 0) === 0 ? <RailEmpty icon={FileText} title="No compliance checks to review" text="Compliance issues and alerts will appear here after validation." /> : null
            ) : (
              <p className={cx("mb-2 flex items-center gap-2 rounded-xl px-3 py-2.5 text-support", highOpen ? "bg-danger-soft text-danger-ink" : openCount ? "bg-warning-soft text-warning-ink" : "bg-success-soft text-success-ink")}>
                {highOpen ? <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
                {highOpen ? `${highOpen} high-severity exception${highOpen === 1 ? "" : "s"} open` : openCount ? `${openCount} exception${openCount === 1 ? "" : "s"} to review` : "No open exceptions"}
              </p>
            )}
            {(current?.deadlines.length ?? 0) > 0 && (
              <ul className="space-y-1.5">
                {current!.deadlines.map((deadline) => (
                  <li key={deadline.compliance_deadline_id} className="flex items-start gap-2 text-support"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-section-icon" aria-hidden="true" /><span><span className="font-semibold text-ink-strong">{deadline.authority}</span> {humanizeEnum(deadline.event_type).toLowerCase()} · due {formatDate(deadline.due_date)}</span></li>
                ))}
              </ul>
            )}
          </Rail>
          <Rail icon={Zap} title="Related actions" description="Quick access to common payroll tasks.">
            <ul className="divide-y divide-line-soft">
              <RelatedLink href="/payroll/components" icon={Settings2} label="Manage payroll components" />
              <RelatedLink href="/reports/dashboard?report=payroll" icon={BarChart3} label="View statutory reports" />
              <li><button type="button" onClick={exportCsv} disabled={!records.length} className="flex w-full items-center justify-between gap-2 py-2.5 text-left text-support font-semibold text-primary-ink hover:underline disabled:cursor-not-allowed disabled:text-ink-subtle disabled:no-underline"><span className="flex items-center gap-2.5"><Download className="h-4 w-4" aria-hidden="true" />Export payroll data</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></button></li>
              <RelatedLink href="/payroll/configuration" icon={Settings} label="Payroll settings" />
            </ul>
          </Rail>
          <Rail icon={CircleHelp} title="Need help?" description="View guidance on running payroll: the controlled processing lifecycle and each step's checks.">
            <Link href="/payroll" className="inline-flex items-center gap-1.5 text-support font-semibold text-primary-ink hover:underline">Open payroll guide<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
          </Rail>
        </aside>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending === "start" ? `Start payroll for ${period?.name ?? "this period"}?` : pending === "calculate" ? "Calculate payroll run?" : "Submit for validation?"}
        description={pending === "start" ? "A draft run is created for this period. Calculate it next to prepare employee records." : pending === "calculate" ? "Employee records are calculated with the configured rules and exceptions are detected." : "The run moves to payroll approvers for review. It can no longer be recalculated."}
        confirmLabel={pending === "start" ? "Start run" : pending === "calculate" ? "Calculate" : "Submit"}
        loading={running}
        onConfirm={() => void execute()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function Rail({ icon: Icon, title, description, children }: { icon: typeof FileText; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-3 flex items-start gap-3"><Icon className="mt-0.5 h-7 w-7 shrink-0 text-section-icon" aria-hidden="true" /><div><h2 className="text-card-title font-bold text-headline">{title}</h2><p className="text-support text-heading-support">{description}</p></div></div>
      {children}
    </section>
  );
}

function RailEmpty({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="py-3 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary" aria-hidden="true"><Icon className="h-7 w-7" /></span>
      <p className="mt-2 font-bold text-headline">{title}</p>
      <p className="text-support text-ink-muted">{text}</p>
    </div>
  );
}

function RelatedLink({ href, icon: Icon, label }: { href: string; icon: typeof FileText; label: string }) {
  return (
    <li><Link href={href} className="flex items-center justify-between gap-2 py-2.5 text-support font-semibold text-primary-ink hover:underline"><span className="flex items-center gap-2.5"><Icon className="h-4 w-4" aria-hidden="true" />{label}</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></Link></li>
  );
}
