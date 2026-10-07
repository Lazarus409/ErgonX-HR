"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileSliders,
  FileText,
  Hourglass,
  PieChart as PieChartIcon,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import { DonutChart, TrendChart, donutLegend } from "@/components/charts/Charts";
import { ProgressMeter } from "@/components/charts/Visuals";
import { ButtonLink } from "@/components/ui/Button";
import { Avatar, Card, MetricCard, SummaryList } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { dashboardsApi, employeesApi, leaveApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDate, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { LeaveDashboard } from "@/types/dashboards";
import type { Employee } from "@/types/hr";
import type { LeaveRequest, LeaveType } from "@/types/leave";

type Range = 3 | 6 | 12;
const RANGES: Range[] = [3, 6, 12];

interface LeaveOverview {
  rollup: LeaveDashboard;
  pending: LeaveRequest[];
  employees: Map<string, Employee>;
  leaveTypes: Map<string, LeaveType>;
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Concept "HR Leave" (option 3 with calendar). */
export default function LeaveDashboardPage() {
  const { can } = useAccess();
  const [range, setRange] = useState<Range>(12);

  const load = useCallback(async (): Promise<LeaveOverview> => {
    const [rollup, pending, employeeIndex, types] = await Promise.all([
      dashboardsApi.getLeaveDashboard(range),
      leaveApi.listLeaveRequests({ status: "PENDING", ordering: "submitted_at", page_size: 5 }).then((page) => page.results).catch(() => []),
      employeesApi.loadEmployeeIndex().catch(() => null),
      leaveApi.listLeaveTypes({ page_size: 100 }).then((page) => page.results).catch(() => []),
    ]);
    return { rollup, pending, employees: employeeIndex?.byId ?? new Map(), leaveTypes: new Map(types.map((type) => [type.id, type])) };
  }, [range]);

  const { data, loading, error, reload } = useApiResource(load);
  const initial = loading && !data;
  const rollup = data?.rollup;
  const count = (value: number | null | undefined) => (value === null || value === undefined ? EM_DASH : formatNumber(value));
  const absence = rollup?.average_absence_rate;
  const monthly = rollup?.monthly_approved_leave ?? [];
  const hasTrend = monthly.some((point) => Number(point.requested_days) > 0);
  const byType = (rollup?.by_leave_type ?? []).map((item) => ({ label: item.leave_type__name, value: Number(item.requested_days) }));
  const utilisation = rollup?.balance_utilisation;
  const hasEntitlement = Boolean(utilisation && Number(utilisation.entitlement_days) > 0);
  const employeeName = (id: string) => { const employee = data?.employees.get(id); return employee ? employeesApi.employeeDisplayName(employee) : EM_DASH; };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        description="Manage leave, monitor absence and ensure policy compliance."
        actions={
          <>
            <label className="relative">
              <span className="sr-only">Date range</span>
              <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" />
              <select data-ui="select" value={range} onChange={(event) => setRange(Number(event.target.value) as Range)} className="h-12 appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm font-medium text-ink-strong">
                {RANGES.map((months) => <option key={months} value={months}>Last {months} months</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            </label>
            {can("leave.configure")
              ? <ButtonLink href="/leave/policies" size="lg" leadingIcon={<Settings className="h-5 w-5" />}>Configure leave</ButtonLink>
              : <ButtonLink href="/leave/requests" size="lg" leadingIcon={<ClipboardList className="h-5 w-5" />}>View requests</ButtonLink>}
          </>
        }
      />

      {error && <ErrorState variant="inline" title="Unable to load leave dashboard" message={error} onRetry={reload} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Leave indicators">
        <MetricCard label="Total leave requests" value={count(rollup?.total_requests)} description={rollup?.total_requests ? `Submitted in the last ${range} months` : "No data available"} icon={Users} accent="brand" loading={initial} href="/leave/requests" />
        <MetricCard label="Approved requests" value={count(rollup?.approved_requests)} description={rollup?.total_requests ? `${Math.round(((rollup.approved_requests ?? 0) / rollup.total_requests) * 100)}% of submitted` : "No data available"} icon={CheckCircle2} accent="leave" loading={initial} />
        <MetricCard label="Pending approvals" value={count(rollup?.pending)} description="Awaiting a decision" icon={Hourglass} accent="recruitment" loading={initial} href="/leave/requests?status=PENDING" />
        <MetricCard label="Average absence rate" value={absence === null || absence === undefined ? EM_DASH : `${Number(absence).toFixed(1)}%`} description={absence === null || absence === undefined ? "No data available" : "Approved leave vs. working days"} icon={CalendarRange} accent="payroll" loading={initial} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="Leave trend"
          description="Number of approved leave days taken over time."
          icon={BarChart3}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!hasTrend}
          emptyTitle="No leave data available"
          emptyDescription="Leave trend will be displayed here when leave records are available."
          data={{ columns: ["Month", "Approved requests", "Leave days"], rows: monthly.map((point) => [point.month, point.request_count, Number(point.requested_days)]) }}
          height={300}
        >
          <TrendChart variant="area" data={monthly} xKey="month" format="days" series={[{ key: "requested_days", label: "Leave days", color: "var(--mod-leave)" }]} height={300} />
        </ChartCard>

        <LeaveCalendarCard leaveTypes={data?.leaveTypes ?? new Map()} employees={data?.employees ?? new Map()} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Pending leave approvals"
          description="Leave requests awaiting approval."
          icon={Hourglass}
          padding="none"
          className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5"
          actions={<Link href="/leave/requests?status=PENDING" className="inline-flex items-center gap-1 text-support font-semibold text-primary-ink hover:underline">View all<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>}
        >
          {initial ? <div className="skeleton m-5 h-40 rounded-xl" /> : (data?.pending.length ?? 0) === 0 ? (
            <EmptyState size="compact" icon={FileText} title="No pending approvals" description="There are no leave requests awaiting approval at this time." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="bg-surface-muted/80 text-left">{["Employee", "Leave type", "Dates", "Duration", "Submitted"].map((heading) => <th key={heading} scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">{heading}</th>)}</tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {data!.pending.map((request) => (
                    <tr key={request.id} className="hover:bg-surface-hover">
                      <td className="px-5 py-3"><Link href={`/leave/requests/${request.id}`} className="flex items-center gap-2.5 font-semibold text-headline hover:underline"><Avatar name={employeeName(request.employee)} size="sm" />{employeeName(request.employee)}</Link></td>
                      <td className="px-5 py-3">{data!.leaveTypes.get(request.leave_type)?.name ?? EM_DASH}</td>
                      <td className="whitespace-nowrap px-5 py-3">{formatDate(request.start_date)} – {formatDate(request.end_date)}</td>
                      <td className="px-5 py-3 tabular-nums">{formatNumber(request.requested_days)} d</td>
                      <td className="whitespace-nowrap px-5 py-3 text-ink-muted">{request.submitted_at ? formatDate(request.submitted_at) : EM_DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Policy compliance & alerts" description="Monitor leave policy compliance and flagged issues." icon={ShieldCheck}>
          {initial ? <div className="skeleton h-40 rounded-xl" /> : (
            <div className="space-y-3">
              <ComplianceRow icon={AlertCircle} tone="danger" title="Policy breaches" description="Leave records that require review for policy compliance." alert={rollup?.compliance?.policy_breaches} hrefFor={(id) => `/leave/requests/${id}`} />
              <ComplianceRow icon={FileText} tone="violet" title="Incomplete leave records" description="Employees with missing or incomplete leave information." alert={rollup?.compliance?.incomplete_leave_records} hrefFor={(id) => `/hr/employees/${id}`} />
              <ComplianceRow icon={CalendarDays} tone="brand" title="Upcoming long absences" description="Employees with upcoming extended leave (5+ days, next 30 days)." alert={rollup?.compliance?.upcoming_long_absences} hrefFor={(id) => `/leave/requests/${id}`} />
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Leave balance utilisation" description={utilisation ? `Current-year granted balance used across employee leave balances (${utilisation.year}).` : "Current-year granted balance used across employee leave balances."} icon={FileSliders}>
          {initial ? <div className="skeleton h-24 rounded-xl" /> : hasEntitlement && utilisation ? (
            <div className="space-y-5">
              <dl className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-surface-muted/70 p-3"><dt className="text-caption text-ink-muted">Entitlement</dt><dd className="mt-1 text-kpi-sm font-bold text-ink-strong tabular-nums">{formatNumber(Number(utilisation.entitlement_days))}</dd></div>
                <div className="rounded-xl bg-mod-leave-soft p-3"><dt className="text-caption text-ink-muted">Used</dt><dd className="mt-1 text-kpi-sm font-bold text-mod-leave tabular-nums">{formatNumber(Number(utilisation.used_days))}</dd></div>
                <div className="rounded-xl bg-surface-muted/70 p-3"><dt className="text-caption text-ink-muted">Available</dt><dd className="mt-1 text-kpi-sm font-bold text-ink-strong tabular-nums">{formatNumber(Number(utilisation.available_days))}</dd></div>
              </dl>
              <ProgressMeter label="Utilisation of granted leave" value={Number(utilisation.utilisation_percent ?? 0)} color="var(--mod-leave)" detail="All figures are in days; utilisation is calculated by the server." />
            </div>
          ) : <p className="text-support text-ink-muted">No positive current-year leave entitlement is available to calculate utilisation.</p>}
        </Card>
        <ChartCard
          className="xl:col-span-2"
          title="Approved leave by type"
          description="Share of approved leave days by leave type."
          icon={PieChartIcon}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!byType.length}
          emptyDescription="No approved leave is available yet."
          data={{ columns: ["Leave type", "Requested days"], rows: byType.map((item) => [item.label, item.value]) }}
        >
          <DonutChart data={byType} height={180} format="days" centerValue={formatNumber(byType.reduce((sum, item) => sum + item.value, 0))} centerLabel="days" />
          <SummaryList className="mt-4" items={donutLegend(byType, "days").map((item) => ({ label: <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>, value: item.value }))} />
        </ChartCard>
      </div>
    </div>
  );
}

const TONES = {
  danger: "bg-danger-soft text-danger",
  violet: "bg-mod-recruitment-soft text-mod-recruitment",
  brand: "bg-primary-soft text-primary",
} as const;

function ComplianceRow({ icon: Icon, tone, title, description, alert, hrefFor }: {
  icon: typeof AlertCircle;
  tone: keyof typeof TONES;
  title: string;
  description: string;
  alert?: { count: number; items: Array<{ id: string; employee: string; issue: string }> };
  hrefFor: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const total = alert?.count;
  return (
    <div className="rounded-xl border border-line">
      <button type="button" onClick={() => setOpen((value) => !value)} disabled={!total} aria-expanded={open} className="flex w-full items-center gap-4 px-4 py-3.5 text-left disabled:cursor-default">
        <span className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", TONES[tone])} aria-hidden="true"><Icon className="h-6 w-6" /></span>
        <span className="min-w-0 flex-1"><span className="block font-bold text-headline">{title}</span><span className="block text-support text-heading-support">{description}</span></span>
        <span className="text-heading font-bold tabular-nums text-ink-strong">{total === undefined ? EM_DASH : formatNumber(total)}</span>
        <ChevronRight className={cx("h-5 w-5 shrink-0 text-primary-ink transition-transform", open && "rotate-90", !total && "opacity-30")} aria-hidden="true" />
      </button>
      {open && alert && (
        <ul className="divide-y divide-line-soft border-t border-line-soft">
          {alert.items.map((item) => (
            <li key={item.id}><Link href={hrefFor(item.id)} className="flex items-center justify-between gap-3 px-4 py-2.5 text-support hover:bg-surface-hover"><span className="font-semibold text-ink-strong">{item.employee}</span><span className="text-ink-muted">{item.issue}</span></Link></li>
          ))}
          {alert.count > alert.items.length && <li className="px-4 py-2 text-caption text-ink-muted">Showing {alert.items.length} of {alert.count}.</li>}
        </ul>
      )}
    </div>
  );
}

/** Month calendar of pending and approved leave, coloured by leave type. */
function LeaveCalendarCard({ leaveTypes, employees }: { leaveTypes: Map<string, LeaveType>; employees: Map<string, Employee> }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const from = iso(month);
  const to = iso(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const load = useCallback(() => leaveApi.getLeaveCalendar({ date_from: from, date_to: to, page_size: 100, ordering: "start_date" }).then((page) => page.results), [from, to]);
  const { data: requests, loading, error } = useApiResource(load);

  const first = month;
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(first.getDate() - lead);
  const days = Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
  const kind = (request: LeaveRequest) => {
    if (request.status === "PENDING") return "pending";
    const name = (leaveTypes.get(request.leave_type)?.name ?? "").toLowerCase();
    return name.includes("annual") ? "annual" : name.includes("sick") ? "sick" : "other";
  };
  const colours = { annual: "bg-mod-leave", sick: "bg-primary", other: "bg-mod-recruitment", pending: "bg-mod-payroll" } as const;
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, index) => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth() - 6 + index, 1); }), []);

  return (
    <Card
      title="Leave calendar"
      description="View employee leave at a glance."
      icon={CalendarDays}
      actions={
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg border border-line p-1.5 text-primary-ink hover:bg-surface-hover"><ChevronLeft className="h-4 w-4" /></button>
          <select data-ui="select" aria-label="Month" value={from} onChange={(event) => setMonth(new Date(`${event.target.value}T00:00:00`))} className="h-8 appearance-none rounded-lg border border-line bg-surface px-3 text-support font-medium text-ink-strong">
            {!monthOptions.some((option) => iso(option) === from) && <option value={from}>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</option>}
            {monthOptions.map((option) => <option key={iso(option)} value={iso(option)}>{option.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</option>)}
          </select>
          <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg border border-line p-1.5 text-primary-ink hover:bg-surface-hover"><ChevronRight className="h-4 w-4" /></button>
        </div>
      }
    >
      <div className="relative">
        <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-line text-caption">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <div key={name} className="border-b border-line bg-surface-muted/80 py-1.5 text-center font-semibold text-ink-strong">{name}</div>)}
          {days.map((date, index) => {
            const value = iso(date);
            const items = (requests ?? []).filter((request) => request.start_date <= value && request.end_date >= value);
            const outside = date.getMonth() !== month.getMonth();
            return (
              <div key={index} className={cx("min-h-12 border-b border-r border-line-soft p-1 [&:nth-child(7n)]:border-r-0", date.getDay() % 6 === 0 && "bg-surface-muted/40")}>
                <span className={cx("block text-right tabular-nums", outside ? "text-ink-subtle" : "text-ink-strong")}>{date.getDate()}</span>
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {items.slice(0, 4).map((request) => {
                    const employee = employees.get(request.employee);
                    return <span key={request.id} title={`${employee ? employeesApi.employeeDisplayName(employee) : "Employee"} · ${leaveTypes.get(request.leave_type)?.name ?? "Leave"} (${request.status.toLowerCase()})`} className={cx("h-2 w-2 rounded-full", colours[kind(request)])} />;
                  })}
                  {items.length > 4 && <span className="text-[0.625rem] text-ink-muted">+{items.length - 4}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {!loading && !error && (requests?.length ?? 0) === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/70 text-center backdrop-blur-[1px]">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-primary"><CalendarDays className="h-7 w-7" aria-hidden="true" /></span>
            <p className="mt-3 font-bold text-headline">No leave records to display</p>
            <p className="text-support text-ink-muted">Leave records will appear here when they are available.</p>
          </div>
        )}
        {error && <p className="mt-2 text-support text-danger-ink">{error}</p>}
      </div>
      <ul className="mt-4 flex flex-wrap gap-5 text-support text-ink" aria-label="Legend">
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-mod-leave" aria-hidden="true" />Annual leave</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-primary" aria-hidden="true" />Sick leave</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-mod-recruitment" aria-hidden="true" />Other leave</li>
        <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-mod-payroll" aria-hidden="true" />Pending</li>
      </ul>
    </Card>
  );
}
