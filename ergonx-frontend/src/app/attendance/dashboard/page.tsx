"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  PieChart as PieChartIcon,
  SlidersHorizontal,
  CalendarDays,
  Clock3,
  Grid3X3,
  Timer,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart, TrendChart } from "@/components/charts/Charts";
import { HeatmapGrid, ProgressMeter, RankingBars } from "@/components/charts/Visuals";
import { hasValues } from "@/components/charts/format";
import { ButtonLink } from "@/components/ui/Button";
import { Sparkline } from "@/components/charts/Visuals";
import { AttentionItem, Avatar, Card, MetricCard } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import ErrorState from "@/components/ui/ErrorState";
import {
  attendanceApi,
  dashboardsApi,
  schedulingApi,
} from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { AttendanceDashboard } from "@/types/dashboards";
import { EM_DASH, formatDate, formatNumber, formatCount } from "@/lib/format";
import StatusBadge from "@/components/ui/StatusBadge";
import EmptyState from "@/components/ui/EmptyState";

/** Only the envelope `count` is needed for these reads. */
const COUNT_ONLY = { page_size: 1 } as const;

interface AttendanceOverview {
  today: AttendanceDashboard;
  onLeave: number | null;
  scheduledToday: number | null;
  activeShifts: number | null;
  overtimePending: number | null;
  adjustmentsPending: number | null;
}

type LatenessRow = AttendanceDashboard["repeated_lateness"][number];

type Range = 3 | 6 | 12;

export default function AttendanceDashboardPage() {
  const [range, setRange] = useState<Range>(12);
  const load = useCallback(async (): Promise<AttendanceOverview> => {
    const [
      today,
      leave,
      assignments,
      shifts,
      overtime,
      adjustments,
    ] = await Promise.all([
      dashboardsApi.getAttendanceDashboard(range),
      dashboardsApi
        .getLeaveDashboard()
        .then((rollup) => rollup.currently_on_leave)
        .catch(() => null),
      schedulingApi
        .listScheduleAssignments({ is_current: true, ...COUNT_ONLY })
        .then((page) => page.count)
        .catch(() => null),
      // Shifts expose no `is_active` filter, so active ones are counted from
      // a single page of results.
      schedulingApi
        .listShifts({ page_size: MAX_PAGE_SIZE })
        .then(
          (page) => page.results.filter((shift) => shift.is_active).length,
        )
        .catch(() => null),
      attendanceApi
        .listOvertimeRecords({ status: "PENDING", ...COUNT_ONLY })
        .then((page) => page.count)
        .catch(() => null),
      attendanceApi
        .listAttendanceAdjustments({ status: "PENDING", ...COUNT_ONLY })
        .then((page) => page.count)
        .catch(() => null),
    ]);

    return {
      today,
      onLeave: leave,
      scheduledToday: assignments,
      activeShifts: shifts,
      overtimePending: overtime,
      adjustmentsPending: adjustments,
    };
  }, [range]);

  const { data, loading, error, reload } = useApiResource(load);
  const initial = loading && !data;

  const value = (count: number | null | undefined): string =>
    count === null || count === undefined ? EM_DASH : formatNumber(count);

  const rate = data?.today.attendance_rate;
  const trend = data?.today.attendance_trend ?? [];
  const departmentRates = (data?.today.department_rates ?? []).filter((item) => item.attendance_rate !== null).map((item) => ({ label: item.department, value: Number(item.attendance_rate) }));
  const exceptions = data?.today.priority_exceptions ?? [];
  const adjustmentsRecent = data?.today.recent_adjustments ?? [];
  const weekly = data?.today.weekly_attendance ?? [];
  const departments = data?.today.by_department ?? [];
  const lateness = data?.today.repeated_lateness ?? [];
  const maxLate = Math.max(...lateness.map((item) => item.late_occurrences), 1);
  const heatColumns = ["Present", "Late", "Absent", "On leave"];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Monitor attendance, find exceptions and keep records accurate."
        actions={
          <>
            <label className="relative">
              <span className="sr-only">Date range</span>
              <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" />
              <select data-ui="select" value={range} onChange={(event) => setRange(Number(event.target.value) as Range)} className="h-12 appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm font-medium text-ink-strong">
                {[3, 6, 12].map((months) => <option key={months} value={months}>Last {months} months</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            </label>
            <ButtonLink href="/attendance/adjustments" size="lg" leadingIcon={<SlidersHorizontal className="h-5 w-5" />}>Review adjustments</ButtonLink>
          </>
        }
      />

      {error && <ErrorState variant="inline" title="Unable to load attendance dashboard" message={error} onRetry={reload} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Attendance indicators">
        <MetricCard label="Attendance rate" value={rate === null || rate === undefined ? EM_DASH : `${Number(rate).toFixed(1)}%`} description={rate === null || rate === undefined ? "No data available" : `Last ${range} months`} icon={Users} accent="brand" loading={initial} />
        <MetricCard label="Late arrivals" value={value(data?.today.late_arrivals)} description={data?.today.late_arrivals ? `Last ${range} months` : "No data available"} icon={Clock3} accent="leave" loading={initial} />
        <MetricCard label="Missing punches" value={value(data?.today.missing_punches)} description={data?.today.missing_punches ? "Clock-ins without a clock-out" : "No data available"} icon={AlertTriangle} accent="recruitment" loading={initial} href="/attendance/live" />
        <MetricCard label="Pending adjustments" value={value(data?.today.pending_adjustments)} description={data?.today.pending_adjustments ? "Awaiting review" : "No data available"} icon={FileText} accent="payroll" loading={initial} href="/attendance/adjustments" />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="Attendance trend"
          description="Monthly attendance rate over time."
          icon={BarChart3}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!trend.some((point) => point.attendance_rate !== null)}
          emptyTitle="No attendance data available"
          emptyDescription="Attendance trends will be displayed here when time and attendance records are available."
          data={{ columns: ["Month", "Attendance rate (%)"], rows: trend.map((point) => [point.month, point.attendance_rate ?? "—"]) }}
          height={260}
        >
          <TrendChart variant="area" data={trend.filter((point) => point.attendance_rate !== null)} xKey="month" format="percent" height={260} series={[{ key: "attendance_rate", label: "Attendance rate", color: "var(--primary)" }]} />
        </ChartCard>
        <ChartCard
          title="Attendance by department / functional area"
          description="Attendance rate by department / functional area."
          icon={PieChartIcon}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!departmentRates.length}
          emptyTitle="No department / functional area data available"
          emptyDescription="Attendance by department / functional area will be displayed here when time and attendance records are available."
          data={{ columns: ["Department / Functional Area", "Attendance rate (%)"], rows: departmentRates.map((item) => [item.label, item.value]) }}
        >
          <RankingBars items={departmentRates} format="percent" color="var(--primary)" limit={10} />
        </ChartCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Priority exceptions"
          description="Employees with attendance issues requiring attention."
          icon={AlertTriangle}
          padding="none"
          className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5"
          actions={<Link href="/attendance/live" className="inline-flex items-center gap-1 text-support font-semibold text-primary-ink hover:underline">View all<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>}
        >
          {initial ? <div className="skeleton m-5 h-40 rounded-xl" /> : exceptions.length === 0 ? (
            <EmptyState size="compact" icon={FileText} title="No exceptions to review" description="There are no attendance exceptions requiring attention at this time." />
          ) : (
            <MiniTable headings={["Employee", "Issue", "Date", "Status"]} rows={exceptions.map((item) => ({
              key: item.record_id,
              href: `/attendance/live/${item.record_id}`,
              cells: [<span key="e" className="flex items-center gap-2.5 font-semibold text-headline"><Avatar name={item.employee} size="sm" />{item.employee}</span>, item.issue, formatDate(item.date), <StatusBadge key="s" status={item.status} size="sm" />],
            }))} />
          )}
        </Card>
        <Card
          title="Recent adjustments"
          description="Latest attendance adjustments and activity."
          icon={History}
          padding="none"
          className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5"
          actions={<Link href="/attendance/adjustments" className="inline-flex items-center gap-1 text-support font-semibold text-primary-ink hover:underline">View all<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>}
        >
          {initial ? <div className="skeleton m-5 h-40 rounded-xl" /> : adjustmentsRecent.length === 0 ? (
            <EmptyState size="compact" icon={FileText} title="No recent adjustments" description="Attendance adjustments will appear here when they are made." />
          ) : (
            <MiniTable headings={["Employee", "Adjustment type", "Adjusted by", "Date", "Status"]} rows={adjustmentsRecent.map((item) => ({
              key: item.id,
              href: `/attendance/adjustments/${item.id}`,
              cells: [<span key="e" className="font-semibold text-headline">{item.employee}</span>, item.adjustment_type, item.adjusted_by, formatDate(item.date), <StatusBadge key="s" status={item.status} size="sm" />],
            }))} />
          )}
        </Card>
      </div>

      <h2 className="pt-2 text-heading font-bold text-headline">This week</h2>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Today's attendance">
        <MetricCard size="sm" label="Present today" value={value(data?.today.present)} icon={UserCheck} accent="accounting" loading={initial} chart={<Sparkline values={weekly.map((day) => day.present)} color="var(--mod-accounting)" height={32} label="Present this week" />} />
        <MetricCard size="sm" label="Absent today" value={value(data?.today.absent)} icon={UserX} accent="audit" loading={initial} />
        <MetricCard size="sm" label="Currently on leave" value={value(data?.onLeave)} icon={CalendarDays} accent="leave" loading={initial} />
        <MetricCard size="sm" label="Overtime pending" value={value(data?.overtimePending)} icon={Timer} accent="attendance" loading={initial} href="/attendance/overtime" />
        <MetricCard size="sm" label="Scheduled today" value={value(data?.scheduledToday)} description="Current schedule assignments" icon={Users} accent="attendance" loading={initial} />
        <MetricCard size="sm" label="Active shifts" value={value(data?.activeShifts)} icon={Activity} accent="attendance" loading={initial} href="/attendance/shifts" />
      </section>

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Seven-day attendance"
          description="Daily attendance outcomes across the last week."
          accent="attendance"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!hasValues(weekly, ["present", "late", "absent", "on_leave"])}
          emptyTitle="No attendance this week"
          emptyDescription="No clock-ins, absences or leave were recorded in the last seven days."
          legend={[{ label: "Present", color: "var(--success)", shape: "square" }, { label: "Late", color: "var(--warning)", shape: "square" }, { label: "Absent", color: "var(--danger)", shape: "square" }, { label: "On leave", color: "var(--mod-leave)", shape: "square" }]}
          data={{ columns: ["Date", "Present", "Late", "Absent", "On leave"], rows: weekly.map((day) => [day.date, day.present, day.late, day.absent, day.on_leave]) }}
        >
          <BarsChart data={weekly} xKey="date" xFormat="weekday" mode="stacked" height={250} series={[
            { key: "present", label: "Present", color: "var(--success)" },
            { key: "late", label: "Late", color: "var(--warning)" },
            { key: "absent", label: "Absent", color: "var(--danger)" },
            { key: "on_leave", label: "On leave", color: "var(--mod-leave)" },
          ]} />
        </ChartCard>
        <ChartCard
          className="xl:col-span-2"
          title="Overtime this week"
          description="Recorded overtime minutes per day, before review."
          accent="attendance"
          icon={Timer}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!hasValues(weekly, ["overtime_minutes"])}
          emptyTitle="No overtime this week"
          emptyDescription="No overtime minutes were recorded in the last seven days."
          footer={data ? <span>Recorded today: <strong className="text-ink-strong">{attendanceApi.formatMinutes(data.today.overtime_minutes)}</strong></span> : undefined}
          data={{ columns: ["Date", "Overtime minutes"], rows: weekly.map((day) => [day.date, day.overtime_minutes]) }}
        >
          <TrendChart variant="area" data={weekly} xKey="date" xFormat="weekday" format="minutes" height={210} series={[{ key: "overtime_minutes", label: "Overtime", color: "var(--chart-3)" }]} />
        </ChartCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3" title="Department / Functional Area attendance heatmap" description="Today's outcomes by department / functional area. Darker cells mean more employees." icon={Grid3X3} accent="attendance">
          {initial ? <div className="skeleton h-48 rounded-xl" /> : departments.length ? (
            <HeatmapGrid
              rows={departments.map((item) => item.employee__employments__department__name || "Unassigned")}
              columns={heatColumns}
              cells={departments.map((item) => [item.present, item.late, item.absent, item.on_leave].map((count) => ({ value: count })))}
            />
          ) : <p className="text-support text-ink-muted">No department-linked attendance has been recorded today.</p>}
        </Card>
        <Card className="xl:col-span-2" title="Action required" description="Attendance items awaiting operational attention." icon={AlertTriangle} accent="attendance">
          {data && data.scheduledToday ? (
            <div className="mb-4 border-b border-line-soft pb-4">
              <ProgressMeter
                label="Shift coverage today"
                value={Math.min(data.today.present + data.today.late, data.scheduledToday)}
                max={data.scheduledToday}
                color="var(--mod-attendance)"
                detail={`${formatNumber(data.today.present + data.today.late)} clocked in (present or late) against ${formatCount(data.scheduledToday, "current schedule assignment")}.`}
              />
            </div>
          ) : null}
          <div className="-mx-3 -mb-2 space-y-1">
            <AttentionItem title="Overtime awaiting approval" description={`${formatCount(data?.overtimePending, "overtime record")} awaiting review.`} severity={data?.overtimePending ? "warning" : "info"} href="/attendance/overtime" />
            <AttentionItem title="Attendance adjustments" description={`${formatCount(data?.adjustmentsPending, "correction request")} awaiting review.`} severity={data?.adjustmentsPending ? "warning" : "info"} href="/attendance/adjustments" />
            <AttentionItem title="Attendance exceptions" description="Review today's late and absent employees." severity={data && data.today.absent > 0 ? "high" : "info"} href="/attendance/live" />
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <DataTable<LatenessRow>
          className="xl:col-span-3"
          caption="Repeated lateness"
          rows={lateness}
          rowKey={(item) => item.employee_id}
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          minWidth={620}
          toolbar={
            <div>
              <h2 className="text-card-title font-bold text-headline">Repeated lateness</h2>
              <p className="text-support text-ink-muted">Employees with repeated late arrivals in the last 90 days.</p>
            </div>
          }
          empty={{ title: "No repeated lateness", description: "No repeated late arrivals have been recorded in the selected period.", icon: Clock3 }}
          columns={[
            {
              key: "employee",
              header: "Employee",
              cell: (item) => {
                const name = `${item.employee__first_name} ${item.employee__last_name}`;
                return <span className="flex min-w-0 items-center gap-3"><Avatar name={name} size="sm" /><span className="min-w-0"><span className="block max-w-[14rem] truncate font-semibold text-ink-strong" title={name}>{name}</span><span className="block font-mono text-caption text-ink-muted">{item.employee__employee_number}</span></span></span>;
              },
            },
            { key: "department", header: "Department / Functional Area", hideBelow: "md", cell: (item) => <span className="block max-w-[12rem] truncate" title={item.employee__employments__department__name}>{item.employee__employments__department__name || "Unassigned"}</span> },
            {
              key: "late",
              header: "Late arrivals",
              numeric: true,
              sortValue: (item) => item.late_occurrences,
              cell: (item) => (
                <span className="inline-flex items-center justify-end gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted sm:block" aria-hidden="true"><span className="block h-full rounded-full bg-warning" style={{ width: `${(item.late_occurrences / maxLate) * 100}%` }} /></span>
                  <span className="font-semibold text-warning-ink">{formatNumber(item.late_occurrences)}</span>
                </span>
              ),
            },
            { key: "minutes", header: "Minutes late", numeric: true, sortValue: (item) => item.total_minutes_late, cell: (item) => formatNumber(item.total_minutes_late) },
          ]}
        />
        <ChartCard
          className="xl:col-span-2"
          title="Lateness trend"
          description="Late arrivals per month."
          accent="attendance"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!data?.today.lateness_trend.length}
          emptyDescription="Monthly lateness will appear here."
          data={{ columns: ["Month", "Late arrivals", "Minutes late"], rows: (data?.today.lateness_trend ?? []).map((point) => [point.month, point.late_occurrences, point.total_minutes_late]) }}
        >
          <TrendChart data={data?.today.lateness_trend ?? []} xKey="month" height={230} series={[{ key: "late_occurrences", label: "Late arrivals", color: "var(--warning)" }]} />
        </ChartCard>
      </div>
    </div>
  );
}

function MiniTable({ headings, rows }: { headings: string[]; rows: Array<{ key: string; href: string; cells: React.ReactNode[] }> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead><tr className="bg-surface-muted/80 text-left">{headings.map((heading) => <th key={heading} scope="col" className="px-4 py-3 text-caption font-semibold text-ink-strong">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((row) => (
            <tr key={row.key} className="hover:bg-surface-hover">
              {row.cells.map((cell, index) => <td key={index} className="px-4 py-3">{index === 0 ? <Link href={row.href} className="hover:underline">{cell}</Link> : cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
