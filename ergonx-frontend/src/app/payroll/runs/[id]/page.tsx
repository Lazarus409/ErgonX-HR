"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  EyeOff,
  FileText,
  Lock,
  Play,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";

import PayrollRunStepper, { PAYROLL_STEPS, payrollStepIndex } from "@/components/payroll/PayrollRunStepper";
import { PrintFooter, PrintMasthead } from "@/components/brand/PrintDocument";
import { useAuth } from "@/components/guards/AuthProvider";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, payrollApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime, formatNumber, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import { hasModule } from "@/types/institutions";
import type { PayrollRunException } from "@/types/payroll";

type Action = "calculate" | "submit" | "approve" | "finalize" | "cancel" | "generateJournal" | "validate";
type Tab = "overview" | "employees" | "exceptions" | "approvals" | "activity";

const actionCopy: Record<Action, { label: string; title: string; description: string; destructive?: boolean }> = {
  calculate: { label: "Calculate", title: "Calculate payroll run", description: "Calculate eligible employee records using the configured rules. Exceptions are detected automatically." },
  validate: { label: "Run validation", title: "Run validation", description: "Re-check the calculated run for exceptions. Your acknowledgements and resolutions are kept." },
  submit: { label: "Submit for validation", title: "Submit payroll run for approval", description: "Move this calculated run into the approval workflow. High-severity exceptions must be resolved first." },
  approve: { label: "Approve", title: "Approve payroll run", description: "Approve this run after the backend validates reconciliation." },
  finalize: { label: "Finalize & pay", title: "Finalize payroll run", description: "Finalization closes the period, issues payslips and makes payroll records immutable.", destructive: true },
  cancel: { label: "Cancel run", title: "Cancel payroll run", description: "Cancel this pre-approval run. This action cannot be undone.", destructive: true },
  generateJournal: { label: "Generate accounting journal", title: "Generate accounting journal", description: "Create the linked draft journal. It still goes through the Accounting approval and posting workflow." },
};

const SEVERITY_TONE: Record<string, string> = {
  HIGH: "bg-danger-soft text-danger-ink",
  MEDIUM: "bg-warning-soft text-warning-ink",
  LOW: "bg-surface-muted text-ink",
};

export default function PayrollRunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { user, institution } = useAuth();
  const router = useRouter();
  const can = (permission: string) => Boolean(user?.permissions.includes("*") || user?.permissions.includes(permission));

  const load = useCallback(async () => {
    const run = await payrollApi.getPayrollRun(id);
    const [period, records, reconciliation, exceptions, activity, deadlines] = await Promise.all([
      payrollApi.getPayrollPeriod(run.payroll_period),
      payrollApi.listPayrollRecords({ payroll_run: run.id, page_size: MAX_PAGE_SIZE, ordering: "employee" }).then((page) => page.results),
      payrollApi.getPayrollRunReconciliation(run.id).catch(() => null),
      payrollApi.listPayrollRunExceptions(run.id).catch(() => []),
      payrollApi.listPayrollRunActivity(run.id).catch(() => []),
      payrollApi.getPayrollPeriodComplianceDeadlines(run.payroll_period).catch(() => []),
    ]);
    return { run, period, records, reconciliation, exceptions, activity, deadlines };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);

  const [tab, setTab] = useState<Tab>("overview");
  const [pendingAction, setPendingAction] = useState<Action | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [exceptionEdit, setExceptionEdit] = useState<{ item: PayrollRunException; status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" } | null>(null);
  const [exceptionNote, setExceptionNote] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const exceptions = useMemo(() => data?.exceptions ?? [], [data]);
  const filteredExceptions = useMemo(() => exceptions.filter((item) => {
    const term = search.trim().toLowerCase();
    const matches = !term || [item.employee_name, item.employee_number, item.message, humanizeEnum(item.code)].some((value) => value?.toLowerCase().includes(term));
    return matches && (severityFilter === "ALL" || item.severity === severityFilter);
  }), [exceptions, search, severityFilter]);
  const filteredRecords = useMemo(() => (data?.records ?? []).filter((record) => {
    const term = search.trim().toLowerCase();
    return !term || record.employee_name?.toLowerCase().includes(term) || record.employee_number?.toLowerCase().includes(term);
  }), [data, search]);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState title="Unable to load payroll run" message={error ?? "The payroll run could not be found."} onRetry={reload} />;

  const { run, period, records, reconciliation, activity, deadlines } = data;
  const openCount = run.exception_counts?.open ?? exceptions.filter((item) => item.status === "OPEN").length;
  const highOpen = run.exception_counts?.high_open ?? exceptions.filter((item) => item.status === "OPEN" && item.severity === "HIGH").length;
  const isReconciled = reconciliation?.discrepancy_count === 0;
  const step = payrollStepIndex(run.status);
  const stepInfo = step >= 0 ? PAYROLL_STEPS[step] : null;
  const currency = records[0]?.currency;
  const canGenerateJournal = can("journal.create") && hasModule(institution?.enabledModules, "ACCOUNTING");
  const editable = !["FINALIZED", "CANCELLED"].includes(run.status) && can("payroll.prepare");

  const primary: Action | "resolve" | null =
    openCount > 0 && ["CALCULATED", "UNDER_REVIEW"].includes(run.status) && tab !== "exceptions" ? "resolve"
      : run.status === "DRAFT" && can("payroll.prepare") ? "calculate"
        : run.status === "CALCULATED" && can("payroll.prepare") ? "submit"
          : run.status === "UNDER_REVIEW" && can("payroll.approve") ? "approve"
            : run.status === "APPROVED" && isReconciled && can("payroll.finalize") ? "finalize"
              : run.status === "FINALIZED" && !run.accounting_journal_entry && canGenerateJournal ? "generateJournal"
                : null;
  const moreActions: Action[] = [
    ...(["CALCULATED", "UNDER_REVIEW"].includes(run.status) && can("payroll.prepare") ? ["validate" as Action] : []),
    ...(["DRAFT", "CALCULATED", "UNDER_REVIEW"].includes(run.status) && can("payroll.prepare") ? ["cancel" as Action] : []),
  ];

  const execute = async () => {
    if (!pendingAction) return;
    setActing(true);
    setActionError(null);
    try {
      const actions: Record<Exclude<Action, "generateJournal">, (runId: string) => Promise<unknown>> = {
        calculate: payrollApi.calculatePayrollRun,
        validate: payrollApi.validatePayrollRun,
        submit: payrollApi.submitPayrollRunForReview,
        approve: payrollApi.approvePayrollRun,
        finalize: payrollApi.finalizePayrollRun,
        cancel: payrollApi.cancelPayrollRun,
      };
      if (pendingAction === "generateJournal") await payrollApi.generatePayrollAccountingJournal(run.id);
      else await actions[pendingAction](run.id);
      setPendingAction(null);
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
      setPendingAction(null);
    } finally {
      setActing(false);
    }
  };

  const saveException = async () => {
    if (!exceptionEdit) return;
    setActing(true);
    try {
      await payrollApi.updatePayrollRunException(run.id, exceptionEdit.item.id, exceptionEdit.status, exceptionNote.trim());
      setExceptionEdit(null);
      setExceptionNote("");
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setActing(false);
    }
  };

  const tabs: Array<{ value: Tab; label: string; icon: typeof FileText; count?: number }> = [
    { value: "overview", label: "Overview", icon: FileText },
    { value: "employees", label: "Employees", icon: Users, count: records.length },
    { value: "exceptions", label: "Exceptions", icon: AlertTriangle, count: openCount },
    { value: "approvals", label: "Approvals", icon: ShieldCheck },
    { value: "activity", label: "Activity", icon: Clock3 },
  ];

  return (
    <div className="space-y-5">
      <PrintMasthead documentTitle="Payroll run summary" reference={run.reference ?? `Run #${run.run_number}`} />
      <Link href="/payroll/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink-strong print:hidden"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Payroll workspace</Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Payroll run detail</h1>
          <p className="mt-1 text-[1.125rem] text-ink-muted">{period.name} ({formatDate(period.start_date)} – {formatDate(period.end_date)})</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 print:hidden">
          <Menu label="More payroll run actions" trigger={(props) => <Button {...props} size="lg" variant="secondary" leadingIcon={<ClipboardList className="h-5 w-5" />} trailingIcon={<ChevronDown className="h-4 w-4" />}>More actions</Button>}>
            {(close) => (
              <div className="p-1.5">
                {moreActions.map((action) => (
                  <MenuItem key={action} tone={actionCopy[action].destructive ? "danger" : "default"} icon={action === "validate" ? <RefreshCw /> : <XCircle />} onSelect={() => { close(); setPendingAction(action); }}>{actionCopy[action].label}</MenuItem>
                ))}
                {run.accounting_journal_entry && <MenuItem icon={<FileText />} onSelect={() => { close(); router.push(`/accounting/journals/${run.accounting_journal_entry}`); }}>Open accounting journal</MenuItem>}
                <MenuItem icon={<Printer />} onSelect={() => { close(); window.print(); }}>Print run summary</MenuItem>
              </div>
            )}
          </Menu>
          {primary === "resolve" && <Button size="lg" leadingIcon={<Play className="h-5 w-5" />} onClick={() => setTab("exceptions")}>Resolve exceptions</Button>}
          {primary && primary !== "resolve" && (
            <Button size="lg" leadingIcon={primary === "calculate" ? <Calculator className="h-5 w-5" /> : primary === "submit" ? <Send className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />} onClick={() => setPendingAction(primary)} disabled={primary === "submit" && highOpen > 0}>
              {actionCopy[primary].label}
            </Button>
          )}
          {primary === "approve" && user?.id === run.started_by && (
            <p className="basis-full text-right text-caption text-ink-muted">You started this run. With separation of duties on (the default), another approver must approve it.</p>
          )}
        </div>
      </header>

      {actionError && <ErrorState variant="inline" title="Payroll action failed" message={actionError} />}

      {/* Status strip */}
      <section className="grid gap-6 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 xl:grid-cols-[16rem_minmax(0,1fr)_18rem] xl:divide-x xl:divide-line-soft">
        <div>
          <p className="font-bold text-headline">Current status</p>
          <div className="mt-3 flex items-start gap-3">
            <span className={cx("flex h-14 w-14 shrink-0 items-center justify-center rounded-full", run.status === "CANCELLED" ? "bg-danger-soft text-danger" : "bg-mod-recruitment text-white ring-8 ring-mod-recruitment-soft")} aria-hidden="true">{stepInfo ? <stepInfo.icon className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}</span>
            <div>
              <p className="text-heading font-bold text-ink-strong">{stepInfo?.label ?? humanizeEnum(run.status)}</p>
              <p className="text-support text-ink-muted">{stepInfo?.description ?? "This run was cancelled."}</p>
              <p className="mt-1"><StatusBadge status={run.status} size="sm" /></p>
            </div>
          </div>
          <p className="mt-4 text-caption text-ink-muted">Last updated</p>
          <p className="text-sm font-medium text-ink-strong">{formatDateTime(run.updated_at)}</p>
        </div>
        <div className="xl:px-6"><PayrollRunStepper status={run.status} compact showDescriptions={false} /></div>
        <dl className="space-y-3 xl:pl-6">
          <MetaRow icon={CalendarDays} label="Payroll period" value={`${period.name} (${formatDate(period.start_date)} – ${formatDate(period.end_date)})`} />
          <MetaRow icon={FileText} label="Run ID" value={run.reference ?? `#${run.run_number}`} />
          <MetaRow icon={UserRound} label="Created by" value={run.started_by_name ?? EM_DASH} />
          <MetaRow icon={Clock3} label="Created on" value={formatDateTime(run.started_at)} />
        </dl>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <div role="tablist" aria-label="Payroll run sections" className="flex gap-6 overflow-x-auto border-b border-line print:hidden">
            {tabs.map((item) => (
              <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} onClick={() => setTab(item.value)} className={cx("relative inline-flex h-12 shrink-0 items-center gap-2 text-[0.9375rem] font-semibold", tab === item.value ? "text-primary-ink" : "text-ink-muted hover:text-ink-strong")}>
                <item.icon className="h-5 w-5" aria-hidden="true" />{item.label}
                {item.count !== undefined && item.count > 0 && <span className={cx("rounded-full px-1.5 text-caption tabular-nums", item.value === "exceptions" ? "bg-danger-soft text-danger-ink" : "bg-surface-muted text-ink-muted")}>{item.count}</span>}
                <span aria-hidden="true" className={cx("absolute inset-x-0 -bottom-px h-[3px] rounded-full bg-primary", tab === item.value ? "opacity-100" : "opacity-0")} />
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard size="sm" label="Employees" value={formatNumber(reconciliation?.record_count ?? records.length)} icon={Users} accent="hr" />
                <MetricCard size="sm" label="Gross pay" value={reconciliation ? formatAmount(reconciliation.totals.gross_pay, currency) : EM_DASH} icon={Calculator} accent="payroll" />
                <MetricCard size="sm" label="Deductions" value={reconciliation ? formatAmount(reconciliation.totals.total_deductions, currency) : EM_DASH} icon={AlertCircle} accent="audit" />
                <MetricCard size="sm" label="Net pay" value={reconciliation ? formatAmount(reconciliation.totals.net_pay, currency) : EM_DASH} icon={CheckCircle2} accent="accounting" />
              </div>
              <Panel title="Reconciliation" description="Stored totals are checked against the calculated payroll items before approval and finalization.">
                {reconciliation ? (
                  <div className="flex flex-wrap items-center gap-4">
                    <StatusBadge status={isReconciled ? "RECONCILED" : "DISCREPANCY"} />
                    <span className="text-support text-ink">{formatNumber(reconciliation.record_count)} records · {formatNumber(reconciliation.discrepancy_count)} discrepancies</span>
                    {run.status === "APPROVED" && !isReconciled && <span className="text-support text-warning-ink">Finalization stays unavailable until reconciliation has no discrepancies.</span>}
                  </div>
                ) : <p className="text-support text-ink-muted">Reconciliation is available once the run is calculated.</p>}
              </Panel>
              <Panel title="Payroll to Accounting" description="Finalized runs generate a draft journal that follows the Accounting approval and posting workflow.">
                {run.accounting_journal_entry ? <Link href={`/accounting/journals/${run.accounting_journal_entry}`} className="text-sm font-semibold text-primary-ink hover:underline">Open accounting journal</Link>
                  : <p className="text-support text-ink-muted">{run.status === "FINALIZED" ? (canGenerateJournal ? "Use the primary action above to generate the draft journal." : "A user with Accounting journal-create access can generate the journal.") : "Available after the run is finalized."}</p>}
              </Panel>
            </div>
          )}

          {tab === "employees" && (
            <Panel title="Employee payroll results" description="Calculated records for this run." toolbar={<SearchBox value={search} onChange={setSearch} placeholder="Search employees" />}>
              {filteredRecords.length === 0 ? <EmptyState size="compact" icon={Users} title="No payroll records" description={records.length ? "No employees match your search." : "Records appear once the run is calculated."} /> : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead><tr className="bg-surface-muted/80 text-left">{["Employee", "Gross pay", "Deductions", "Net pay", "Exceptions", "Status"].map((heading) => <th key={heading} scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">{heading}</th>)}</tr></thead>
                    <tbody className="divide-y divide-line-soft">
                      {filteredRecords.map((record) => {
                        const count = exceptions.filter((item) => item.employee === record.employee && item.status === "OPEN").length;
                        return (
                          <tr key={record.id}>
                            <td className="px-5 py-3"><Link href={`/hr/employees/${record.employee}`} className="font-semibold text-headline hover:underline">{record.employee_name}</Link><span className="block text-caption text-ink-muted">{record.employee_number}</span></td>
                            <td className="px-5 py-3 tabular-nums">{formatAmount(record.gross_pay, record.currency)}</td>
                            <td className="px-5 py-3 tabular-nums">{formatAmount(record.total_deductions, record.currency)}</td>
                            <td className="px-5 py-3 font-semibold tabular-nums">{formatAmount(record.net_pay, record.currency)}</td>
                            <td className="px-5 py-3">{count ? <button type="button" onClick={() => { setSearch(record.employee_name ?? ""); setTab("exceptions"); }} className="rounded-full bg-danger-soft px-2 py-0.5 text-caption font-semibold text-danger-ink">{count} open</button> : <span className="text-ink-subtle">—</span>}</td>
                            <td className="px-5 py-3"><StatusBadge status={record.status} size="sm" /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {tab === "exceptions" && (
            <Panel
              icon={AlertTriangle}
              title="Payroll exceptions"
              description={highOpen ? `Review and resolve exceptions to proceed. The run cannot be submitted while ${highOpen} high-severity exception${highOpen === 1 ? "" : "s"} remain open.` : "Review exceptions. Medium and low items can be acknowledged with a note."}
              toolbar={
                <div className="flex flex-wrap gap-2">
                  <SearchBox value={search} onChange={setSearch} placeholder="Search exceptions" />
                  <select data-ui="select" aria-label="Severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm">
                    <option value="ALL">All severities</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
                  </select>
                </div>
              }
            >
              {filteredExceptions.length === 0 ? (
                <EmptyState size="compact" icon={ShieldCheck} title={exceptions.length ? "No matching exceptions" : "No exceptions"} description={exceptions.length ? "Adjust your search or filter." : ["DRAFT", "CALCULATING"].includes(run.status) ? "Exceptions are detected when the run is calculated." : "This run has no detected exceptions."} />
              ) : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead><tr className="bg-surface-muted/80 text-left">{["Issue type", "Employee", "Severity", "Status", "Actions"].map((heading) => <th key={heading} scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">{heading}</th>)}</tr></thead>
                    <tbody className="divide-y divide-line-soft">
                      {filteredExceptions.map((item) => (
                        <FragmentRow key={item.id} expanded={expanded === item.id}>
                          <tr>
                            <td className="px-5 py-3"><span className="flex items-center gap-2 font-medium text-ink-strong"><AlertCircle className={cx("h-5 w-5 shrink-0", item.status === "OPEN" ? "text-danger" : "text-ink-subtle")} aria-hidden="true" />{humanizeEnum(item.code)}</span></td>
                            <td className="px-5 py-3">{item.employee_name ?? "Run-wide"}{item.employee_number && <span className="block text-caption text-ink-muted">{item.employee_number}</span>}</td>
                            <td className="px-5 py-3"><span className={cx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-caption font-semibold", SEVERITY_TONE[item.severity] ?? SEVERITY_TONE.LOW)}>{item.severity === "HIGH" ? <AlertCircle className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{humanizeEnum(item.severity)}</span></td>
                            <td className="px-5 py-3">
                              {editable ? (
                                <select data-ui="select" aria-label={`Status for ${humanizeEnum(item.code)}`} value={item.status} onChange={(event) => { setExceptionNote(""); setExceptionEdit({ item, status: event.target.value as "OPEN" | "ACKNOWLEDGED" | "RESOLVED" }); }} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm">
                                  <option value="OPEN">Open</option>
                                  {item.severity !== "HIGH" && <option value="ACKNOWLEDGED">Acknowledged</option>}
                                  <option value="RESOLVED">Resolved</option>
                                </select>
                              ) : <StatusBadge status={item.status} size="sm" />}
                            </td>
                            <td className="px-5 py-3"><button type="button" onClick={() => setExpanded(expanded === item.id ? null : item.id)} className="font-semibold text-primary-ink hover:underline">{expanded === item.id ? "Hide" : "View"}</button></td>
                          </tr>
                          {expanded === item.id && (
                            <tr className="bg-surface-muted/40"><td colSpan={5} className="px-5 py-3 text-support">
                              <p className="text-ink">{item.message}</p>
                              {item.resolution_note && <p className="mt-1 text-ink-muted">{humanizeEnum(item.status)}{item.resolved_by_name ? ` by ${item.resolved_by_name}` : ""}{item.resolved_at ? ` · ${formatDateTime(item.resolved_at)}` : ""}: {item.resolution_note}</p>}
                            </td></tr>
                          )}
                        </FragmentRow>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-5 pt-3 text-caption text-ink-muted">Showing {filteredExceptions.length} of {exceptions.length} exceptions</p>
                </div>
              )}
            </Panel>
          )}

          {tab === "approvals" && (
            <Panel icon={ShieldCheck} title="Approval trail" description="Who prepared, approved and finalized this run.">
              <ol className="relative space-y-4 border-l border-line pl-5">
                <Stage done title="Prepared" detail={`${run.started_by_name ?? EM_DASH} · ${formatDateTime(run.started_at)}`} />
                <Stage done={step >= 1} active={step === 1} title="Submitted for validation" detail={step >= 1 ? "Awaiting approver decision" : "Not yet submitted"} />
                <Stage done={step >= 2} title="Approved" detail={run.approved_at ? `${run.approved_by_name ?? EM_DASH} · ${formatDateTime(run.approved_at)}` : "Pending"} />
                <Stage done={step >= 3} title="Finalized and paid" detail={run.finalized_at ? `${run.finalized_by_name ?? EM_DASH} · ${formatDateTime(run.finalized_at)}` : "Pending"} />
              </ol>
            </Panel>
          )}

          {tab === "activity" && (
            <Panel icon={Clock3} title="Activity" description="Audit trail for this payroll run.">
              {activity.length === 0 ? <EmptyState size="compact" icon={Clock3} title="No activity recorded" description="Workflow actions on this run will appear here." /> : (
                <ul className="divide-y divide-line-soft">
                  {activity.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <span><span className="block font-semibold text-ink-strong">{humanizeEnum(entry.action.replace(/^payroll\./, "").replace(/\./g, "_"))}</span><span className="text-caption text-ink-muted">{entry.actor}{typeof entry.metadata?.note === "string" && entry.metadata.note ? ` — ${entry.metadata.note}` : ""}</span></span>
                      <time className="text-caption text-ink-muted">{formatDateTime(entry.created_at)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <aside className="space-y-4">
          <RailCard icon={ShieldCheck} title="Compliance checks" description="Ensure payroll meets policy and regulatory requirements.">
            {["DRAFT", "CALCULATING"].includes(run.status) && deadlines.length === 0 ? (
              <EmptyRail icon={FileText} title="No compliance checks to review" text="Compliance issues and alerts will appear here after validation." />
            ) : (
              <ul className="space-y-2">
                {!["DRAFT", "CALCULATING"].includes(run.status) && (
                  <li className="flex items-start gap-2.5 rounded-xl bg-surface-muted/60 px-3 py-2.5 text-support">
                    {highOpen ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
                    <span>{highOpen ? `${highOpen} high-severity exception${highOpen === 1 ? "" : "s"} open` : openCount ? `${openCount} exception${openCount === 1 ? "" : "s"} to review` : "No open exceptions"}</span>
                  </li>
                )}
                {deadlines.map((deadline) => (
                  <li key={deadline.compliance_deadline_id} className="flex items-start gap-2.5 rounded-xl bg-surface-muted/60 px-3 py-2.5 text-support">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-section-icon" aria-hidden="true" />
                    <span><span className="font-semibold text-ink-strong">{deadline.authority}</span> {humanizeEnum(deadline.event_type).toLowerCase()} due {formatDate(deadline.due_date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </RailCard>
          <RailCard icon={Users} title="Approval state" description="Review and manage payroll approvals.">
            {run.status === "UNDER_REVIEW" ? (
              <div className="rounded-xl bg-warning-soft px-3 py-3 text-support text-warning-ink">Awaiting approval{can("payroll.approve") ? " — you can approve this run." : " from a payroll approver."}</div>
            ) : run.approved_at ? (
              <div className="rounded-xl bg-success-soft px-3 py-3 text-support text-success-ink">Approved by {run.approved_by_name ?? EM_DASH} on {formatDate(run.approved_at)}.</div>
            ) : <EmptyRail icon={Users} title="No pending approvals" text="There are no payroll approvals required at this time." />}
          </RailCard>
          <RailCard icon={Lock} title="Restricted information" description="Payroll information is only visible to authorized HR and Finance users.">
            <div className="flex items-start gap-3 rounded-xl bg-surface-muted/60 px-3 py-3"><EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" /><div className="text-support"><p className="font-semibold text-ink-strong">Access is permission-controlled</p><p className="text-ink-muted">Employees see only their own payslips. Every change here is recorded in the audit trail.</p></div></div>
          </RailCard>
        </aside>
      </div>

      {pendingAction && <ConfirmDialog open title={actionCopy[pendingAction].title} description={actionCopy[pendingAction].description} confirmLabel={actionCopy[pendingAction].label} destructive={actionCopy[pendingAction].destructive} loading={acting} onCancel={() => setPendingAction(null)} onConfirm={() => void execute()} />}
      <Dialog
        open={exceptionEdit !== null}
        onClose={() => setExceptionEdit(null)}
        title={exceptionEdit ? `Mark as ${humanizeEnum(exceptionEdit.status).toLowerCase()}?` : ""}
        description={exceptionEdit?.item.message}
        footer={<><Button variant="secondary" onClick={() => setExceptionEdit(null)}>Cancel</Button><Button loading={acting} disabled={exceptionEdit?.status !== "OPEN" && !exceptionNote.trim()} onClick={() => void saveException()}>Save</Button></>}
      >
        {exceptionEdit?.status !== "OPEN" ? (
          <label className="block text-sm font-semibold text-ink-strong">How was this handled?<textarea rows={3} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line-strong px-3 py-2 font-normal" placeholder="e.g. Confirmed unpaid leave with the employee" /></label>
        ) : <p className="text-support text-ink-muted">The exception will be reopened and block submission again if it is high severity.</p>}
      </Dialog>
      <PrintFooter />
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode; expanded: boolean }) {
  return <>{children}</>;
}

function MetaRow({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return <div className="flex items-start gap-3"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-section-icon" aria-hidden="true" /><div><dt className="text-caption text-ink-muted">{label}</dt><dd className="text-sm font-medium text-ink-strong">{value}</dd></div></div>;
}

function Panel({ title, description, icon: Icon, toolbar, children }: { title: string; description?: string; icon?: typeof FileText; toolbar?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          {Icon && <Icon className="mt-0.5 h-7 w-7 shrink-0 text-section-icon" aria-hidden="true" />}
          <div><h2 className="text-heading font-bold text-headline">{title}</h2>{description && <p className="mt-0.5 text-support text-ink-muted">{description}</p>}</div>
        </div>
        {toolbar}
      </div>
      {children}
    </section>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="relative block">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} data-ui="input" className="h-10 w-56 rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" />
    </label>
  );
}

function RailCard({ icon: Icon, title, description, children }: { icon: typeof FileText; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-3 flex items-start gap-3"><Icon className="mt-0.5 h-7 w-7 shrink-0 text-section-icon" aria-hidden="true" /><div><h2 className="text-card-title font-bold text-headline">{title}</h2><p className="text-support text-heading-support">{description}</p></div></div>
      {children}
    </section>
  );
}

function EmptyRail({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="rounded-xl bg-surface-muted/60 px-4 py-5 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink-muted" aria-hidden="true"><Icon className="h-6 w-6" /></span>
      <p className="mt-2 font-bold text-ink-strong">{title}</p>
      <p className="text-support text-ink-muted">{text}</p>
    </div>
  );
}

function Stage({ title, detail, done, active }: { title: string; detail: string; done?: boolean; active?: boolean }) {
  return (
    <li className="relative">
      <span className={cx("absolute -left-[1.65rem] top-0.5 h-3.5 w-3.5 rounded-full border-2", done ? "border-primary bg-primary" : active ? "border-primary bg-surface" : "border-line-strong bg-surface")} aria-hidden="true" />
      <p className={cx("text-sm font-semibold", done || active ? "text-ink-strong" : "text-ink-muted")}>{title}</p>
      <p className="text-caption text-ink-muted">{detail}</p>
    </li>
  );
}
