"use client";

import Link from "next/link";
import { useCallback, type ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  CalendarDays,
  CalendarPlus,
  CircleDollarSign,
  Clock3,
  Contact,
  FileText,
  LogIn,
  Pencil,
  Timer,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart, DonutChart, TrendChart, donutLegend } from "@/components/charts/Charts";
import { Timeline } from "@/components/charts/Visuals";
import { ButtonLink } from "@/components/ui/Button";
import { AttentionItem, Card, SummaryList } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import StatusBadge from "@/components/ui/StatusBadge";
import { attendanceApi, employeesApi, homeApi, leaveApi, notificationsApi, payrollApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { useApiResource } from "@/lib/useApiResource";
import { EM_DASH, formatAmount, formatDate, formatNumber, toISODate } from "@/lib/format";
import { cx } from "@/lib/cx";
import type { ModuleAccent } from "@/lib/moduleTheme";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { AttendanceRecord } from "@/types/attendance";
import type { Employee } from "@/types/hr";
import type { HomePayload } from "@/types/home";
import type { LeaveBalance, LeaveRequest, LeaveType } from "@/types/leave";
import type { Payslip } from "@/types/payroll";
import type { AppNotification } from "@/types/notifications";

interface PersonalData {
  employee: Employee | null;
  home: HomePayload | null;
  attendance: AttendanceRecord[] | null;
  leave: { balances: LeaveBalance[]; requests: LeaveRequest[]; types: Map<string, LeaveType> } | null;
  payslips: Payslip[] | null;
  updates: AppNotification[] | null;
}

function clockTime(value: string | null | undefined): string {
  if (!value) return EM_DASH;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function hours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * Employee / Self-Service Home: a personal dashboard, not a managerial one.
 * Every section is module- and permission-aware and reuses the same
 * self-scoped reads as the dedicated self-service pages. No performance,
 * productivity or peer-ranking metric is shown or derived.
 */
export default function SelfServiceHome() {
  const { user, can, moduleEnabled } = useAccess();
  const showAttendance = moduleEnabled("ATTENDANCE") && (can("attendance.view") || can("attendance.clock"));
  const showLeave = moduleEnabled("LEAVE") && can("leave.request");
  const showPayroll = moduleEnabled("PAYROLL") && can("payslip.view");
  const showSchedule = moduleEnabled("ATTENDANCE") && can("schedule.view");

  const load = useCallback(async (): Promise<PersonalData> => {
    const [employee, home] = await Promise.all([
      employeesApi.getCurrentEmployee(),
      homeApi.getHome().catch(() => null),
    ]);
    if (!employee) return { employee: null, home, attendance: null, leave: null, payslips: null, updates: null };

    const [attendance, leave, payslips, updates] = await Promise.all([
      showAttendance
        ? attendanceApi.listAttendanceRecords({ employee: employee.id, page_size: 35, ordering: "-attendance_date" }).then((page) => page.results).catch(() => null)
        : Promise.resolve(null),
      showLeave
        ? Promise.all([
            leaveApi.listLeaveTypes({ page_size: MAX_PAGE_SIZE }).then((page) => page.results).catch(() => [] as LeaveType[]),
            leaveApi.listLeaveBalances({ employee: employee.id, year: new Date().getFullYear(), page_size: MAX_PAGE_SIZE }).then((page) => page.results).catch(() => [] as LeaveBalance[]),
            leaveApi.listLeaveRequests({ employee: employee.id, page_size: 20, ordering: "-start_date" }).then((page) => page.results).catch(() => [] as LeaveRequest[]),
          ]).then(([types, balances, requests]) => ({ types: new Map(types.map((type) => [type.id, type])), balances, requests }))
        : Promise.resolve(null),
      showPayroll
        ? payrollApi.listPayslips({ payroll_record__employee: employee.id, page_size: 6, ordering: "-generated_at" }).then((page) => page.results).catch(() => null)
        : Promise.resolve(null),
      notificationsApi.getNotifications().then((items) => items.slice(0, 4)).catch(() => null),
    ]);
    return { employee, home, attendance, leave, payslips, updates };
  }, [showAttendance, showLeave, showPayroll]);

  const { data, loading, error, reload } = useApiResource(load);
  const employee = data?.employee ?? null;
  const todayIso = toISODate(new Date());
  const history = data?.attendance ?? [];
  const today = history.find((record) => record.attendance_date === todayIso) ?? null;
  const week = [...history].slice(0, 7).reverse();
  const weekMinutes = week.reduce((sum, record) => sum + record.worked_minutes, 0);
  const weekOvertime = week.reduce((sum, record) => sum + record.overtime_minutes, 0);
  const balances = data?.leave?.balances ?? [];
  const leaveAvailable = balances.reduce((sum, balance) => sum + Number(balance.available), 0);
  const typeName = (id: string) => data?.leave?.types.get(id)?.name ?? "Leave";
  const requests = data?.leave?.requests ?? [];
  const pendingLeave = requests.filter((request) => ["PENDING", "SUBMITTED", "DRAFT"].includes(String(request.status).toUpperCase()));
  const upcomingLeave = requests.filter((request) => String(request.status).toUpperCase() === "APPROVED" && request.end_date >= todayIso).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const payslips = [...(data?.payslips ?? [])].sort((a, b) => a.payroll_period.pay_date.localeCompare(b.payroll_period.pay_date));
  const snapshot = data?.home?.optional_personal_snapshot ?? null;
  const upcomingShifts = snapshot?.upcoming_shifts ?? [];
  const nextShift = upcomingShifts.find((shift) => !shift.off_day && shift.end && new Date(shift.end) > new Date());
  const overtimeWeeks = overtimeByWeek(history);
  const latestPayslip = payslips.at(-1);
  const firstName = employee?.first_name || user?.firstName || "there";
  const greeting = data?.home?.greeting_context.greeting ?? `Welcome, ${firstName}`;

  const todayStatus = today ? (today.check_out ? "Clocked out" : today.check_in ? "Clocked in" : String(today.status).replaceAll("_", " ").toLowerCase()) : "Not clocked in yet";

  const quickActions: Array<{ href: string; label: string; description: string; icon: LucideIcon; accent: ModuleAccent; show: boolean }> = [
    { href: "/me/attendance", label: today?.check_in && !today.check_out ? "Clock out" : "Clock in", description: "Record your attendance for today", icon: LogIn, accent: "attendance", show: showAttendance && can("attendance.clock") },
    { href: "/me/leave/request", label: "Request leave", description: "Start a new leave request", icon: CalendarPlus, accent: "leave", show: showLeave },
    { href: "/me/payslips", label: "My payslips", description: "View your payroll statements", icon: CircleDollarSign, accent: "payroll", show: showPayroll },
    { href: "/me/profile", label: "My profile", description: "Keep your details current", icon: UserRound, accent: "brand", show: true },
    { href: "/me/emergency-contacts", label: "Emergency contacts", description: "Who to call if needed", icon: Contact, accent: "hr", show: true },
    { href: "/me/documents", label: "My documents", description: "Your shared documents", icon: FileText, accent: "settings", show: true },
  ];

  const visibleActions = quickActions.filter((action) => action.show).slice(0, 4);
  const anniversary = workAnniversary(employee?.hire_date);
  const dateChip = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Employee Home (Stitch S047): greeting, status tiles, quick actions, schedule, activity, attention, milestones. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">Self service · Employee Home</p>
          <h1 className="mt-1 text-page-title font-bold text-ink-strong">{greeting}</h1>
          <p className="mt-1 text-support text-ink-muted">Your key information at a glance.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-caption font-semibold text-primary-ink"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />{dateChip}</span>
      </header>

      {error && <ErrorState variant="inline" title="Unable to load your workspace" message={error} onRetry={reload} />}
      {!loading && data && !employee && (
        <ErrorState variant="inline" title="No employee record is linked to your account" message="Ask your HR administrator to link your user account to your employee record to see attendance, leave and pay." />
      )}

      <section aria-label="Today at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showAttendance && (
          <StatusTile label="Today's attendance" icon={Clock3} value={loading && !data ? "…" : todayStatus} footer={today?.check_in ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />In {clockTime(today.check_in)}{today.check_out ? ` · out ${clockTime(today.check_out)}` : ""}</span> : <Link href="/me/attendance" className="font-semibold text-primary-ink hover:underline">Open attendance</Link>} />
        )}
        {showSchedule && (
          <StatusTile label="Next shift" icon={CalendarClock} value={data ? (nextShift ? dayLabel(nextShift.date) : "None scheduled") : "…"} footer={nextShift ? (nextShift.flexible ? `Flexible · ${hours(nextShift.required_minutes)}h` : `${clockTime(nextShift.start)} – ${clockTime(nextShift.end)}`) : "Schedules are assigned by your manager or HR."} />
        )}
        {showLeave && (
          <StatusTile label="Leave balance" icon={CalendarDays} value={data ? <>{formatNumber(leaveAvailable)} <span className="text-support font-medium text-ink-muted">days</span></> : "…"} footer={`Available in ${new Date().getFullYear()}`} />
        )}
        {showPayroll && (
          <StatusTile label="Latest payslip" icon={FileText} value={latestPayslip ? latestPayslip.payroll_period.name : data ? "None yet" : "…"} footer={latestPayslip ? <span className="flex items-center justify-between gap-2">Paid {formatDate(latestPayslip.payroll_period.pay_date)}<Link href={`/payroll/payslips/${latestPayslip.id}`} className="inline-flex items-center gap-1 font-semibold text-primary-ink hover:underline">View payslip<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></span> : "Appears after your first finalized payroll."} />
        )}
        {!showAttendance && !showLeave && !showPayroll && <StatusTile label="Employee number" icon={UserRound} value={employee?.employee_number ?? "–"} footer={employee?.work_email ?? ""} />}
      </section>

      <section aria-labelledby="my-actions" className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
        <div className="flex items-center justify-between gap-3"><h2 id="my-actions" className="text-card-title font-semibold text-ink-strong">Quick actions</h2><span className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">Frequently used</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {visibleActions.map((action, index) => (
            <Link key={action.href + action.label} href={action.href} className={cx("group flex items-center gap-3 rounded-lg px-4 py-3 transition-colors", index === 0 ? "bg-ink-strong text-surface hover:bg-ink" : "bg-surface-muted text-ink-strong hover:bg-surface-hover")}>
              <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", index === 0 ? "bg-surface/15" : "bg-surface")} aria-hidden="true"><action.icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold">{action.label}</span><span className={cx("block truncate text-caption", index === 0 ? "text-surface/75" : "text-ink-muted")}>{action.description}</span></span>
            </Link>
          ))}
        </div>
      </section>

      {employee && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          {showSchedule ? (
            <Card title="Upcoming schedule" description={upcomingShifts[0] ? `Your next seven days on ${upcomingShifts[0].schedule}.` : "Your shifts for the next seven days."} icon={CalendarClock} accent="attendance" actions={<Link href="/me/attendance" className="text-support font-semibold text-primary-ink hover:underline">View full schedule</Link>}>
              {upcomingShifts.length ? (
                <ul className="divide-y divide-line-soft">
                  {upcomingShifts.slice(0, 5).map((shift) => {
                    const date = new Date(`${shift.date}T00:00:00`);
                    const near = dayLabel(shift.date);
                    return (
                      <li key={shift.date} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
                        <span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1"><span className="text-[0.625rem] font-bold uppercase text-primary-ink">{date.toLocaleDateString("en-GB", { month: "short" })}</span><span className="text-heading font-bold leading-none text-ink-strong">{date.getDate()}</span></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-semibold text-ink-strong">{shift.off_day ? "Day off" : "Work shift"}{(near === "Today" || near === "Tomorrow") && <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[0.625rem] font-bold text-primary-ink">{near}</span>}</span>
                          <span className="block text-caption text-ink-muted">{shift.off_day ? shift.schedule : shift.flexible ? `Flexible · ${hours(shift.required_minutes)}h between ${clockTime(shift.start)} and ${clockTime(shift.end)}` : `${clockTime(shift.start)} – ${clockTime(shift.end)}`}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-support text-ink-muted">{loading && !data ? "Loading…" : "No schedule is assigned to you for the coming week. Your manager or HR assigns schedules."}</p>
              )}
            </Card>
          ) : <span className="hidden lg:block" />}
          <Card title="Recent activity" description="Your latest notifications." icon={Bell} accent="brand" actions={<Link href="/notifications" className="text-support font-semibold text-primary-ink hover:underline">View all activity</Link>}>
            {data?.updates?.length ? (
              <ul className="divide-y divide-line-soft">
                {data.updates.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.is_read ? "bg-line-strong" : "bg-primary")} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-strong">{item.title}<span className="sr-only">{item.is_read ? "" : " (unread)"}</span></p>
                      <p className="line-clamp-1 text-support text-ink-muted">{item.message}</p>
                    </div>
                    <time className="shrink-0 text-caption text-ink-subtle" dateTime={item.created_at}>{formatDate(item.created_at)}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-support text-ink-muted">{loading && !data ? "Loading…" : "You're all caught up."}</p>
            )}
          </Card>
        </div>
      )}

      {employee && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card title="Requiring your attention" description="Things waiting on you or about you." icon={CheckCircle2} accent="brand" actions={snapshot?.attention.length ? <span className="rounded-full bg-danger-soft px-2 py-0.5 text-caption font-semibold text-danger-ink">{snapshot.attention.length} pending</span> : undefined}>
            {snapshot?.attention.length ? (
              <div className="-mx-3 space-y-1">
                {snapshot.attention.map((item) => (
                  <AttentionItem key={item.code} title={item.title} description={item.description} severity={item.severity === "HIGH" ? "high" : "info"} href={item.route} />
                ))}
              </div>
            ) : (
              <p className="text-support text-ink-muted">{loading && !data ? "Loading…" : "Nothing needs your attention right now."}</p>
            )}
          </Card>
          <Card title="Your milestones" description="From your employment record." icon={CalendarPlus} accent="hr">
            {anniversary ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted/70 p-4">
                <div><p className="text-sm font-semibold text-ink-strong">Work anniversary</p><p className="text-caption text-ink-muted">{anniversary.years ? `${anniversary.years} year${anniversary.years === 1 ? "" : "s"} of service completed` : "Your first year of service is under way"}</p></div>
                <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-caption font-semibold text-primary-ink">{anniversary.next}</span>
              </div>
            ) : <p className="text-support text-ink-muted">Your hire date is not recorded yet.</p>}
            {snapshot && (
              <SummaryList
                className="mt-4"
                items={[
                  ...(snapshot.activity.leave_requests_this_year !== undefined ? [{ label: "Leave requests this year", value: formatNumber(snapshot.activity.leave_requests_this_year) }] : []),
                  ...(snapshot.activity.attendance_corrections_pending !== undefined ? [{ label: "Attendance corrections pending", value: formatNumber(snapshot.activity.attendance_corrections_pending) }] : []),
                  { label: "Documents on file", value: formatNumber(snapshot.activity.documents_on_file) },
                ]}
              />
            )}
          </Card>
        </div>
      )}

      {/* Attendance */}
      {showAttendance && employee && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <ChartCard
            title="My week"
            description="Hours worked and overtime across your last seven recorded days."
            accent="attendance"
            icon={Timer}
            loading={loading && !data}
            error={!data && error ? "This data is unavailable right now." : null}
            empty={week.length === 0}
            emptyTitle="No attendance recorded yet"
            emptyDescription="Your recorded days will appear here after you clock in."
            legend={[{ label: "Worked", color: "var(--mod-attendance)", value: `${hours(weekMinutes)}h` }, { label: "Overtime", color: "var(--chart-3)", value: `${hours(weekOvertime)}h` }]}
            summary={`You worked ${hours(weekMinutes)} hours across your last ${week.length} recorded days, including ${hours(weekOvertime)} hours of overtime.`}
            data={{ columns: ["Date", "Worked (h)", "Overtime (h)"], rows: week.map((record) => [formatDate(record.attendance_date), hours(record.worked_minutes), hours(record.overtime_minutes)]) }}
          >
            <TrendChart
              variant="area"
              xKey="date"
              xFormat="weekday"
              data={week.map((record) => ({ date: record.attendance_date, worked: hours(record.worked_minutes), overtime: hours(record.overtime_minutes) }))}
              series={[{ key: "worked", label: "Worked (h)", color: "var(--mod-attendance)" }, { key: "overtime", label: "Overtime (h)", color: "var(--chart-3)" }]}
              height={220}
            />
          </ChartCard>
          <Card title="Attendance calendar" description="Your last four weeks at a glance." icon={CalendarDays} accent="attendance">
            <AttendanceCalendar records={history} todayIso={todayIso} />
          </Card>
        </div>
      )}

      {/* Leave + pay */}
      {(showLeave || showPayroll) && employee && (
        <div className={cx("grid gap-5", showLeave && showPayroll && "xl:grid-cols-2")}>
          {showLeave && (
            <ChartCard
              title="My leave balances"
              description={`Days available for ${new Date().getFullYear()}, by leave type.`}
              accent="leave"
              icon={CalendarDays}
              loading={loading && !data}
              error={!data && error ? "This data is unavailable right now." : null}
              empty={balances.length === 0}
              emptyTitle="No leave balances yet"
              emptyDescription="Balances appear once your leave entitlement is set up."
              actions={<ButtonLink href="/me/leave/request" size="sm" variant="secondary" leadingIcon={<CalendarPlus className="h-3.5 w-3.5" />}>Request</ButtonLink>}
              data={{ columns: ["Leave type", "Available", "Used"], rows: balances.map((balance) => [typeName(balance.leave_type), Number(balance.available), Number(balance.used)]) }}
            >
              <div className="grid items-center gap-5 sm:grid-cols-[180px_1fr]">
                <DonutChart data={balances.map((balance) => ({ label: typeName(balance.leave_type), value: Math.max(Number(balance.available), 0) }))} centerValue={formatNumber(leaveAvailable)} centerLabel="days left" height={180} format="days" />
                <SummaryList items={donutLegend(balances.map((balance) => ({ label: typeName(balance.leave_type), value: Math.max(Number(balance.available), 0) })), "days").map((item) => ({ label: <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>, value: item.value }))} />
              </div>
            </ChartCard>
          )}
          {showPayroll && (
            <ChartCard
              title="Pay trend"
              description="Net pay across your latest payslips."
              accent="payroll"
              icon={CircleDollarSign}
              loading={loading && !data}
              error={!data && error ? "This data is unavailable right now." : null}
              empty={payslips.length === 0}
              emptyTitle="No payslips yet"
              emptyDescription="Your payslips will appear after your first finalized payroll."
              actions={<Link href="/me/payslips" className="text-support font-semibold text-primary-ink hover:underline">All payslips</Link>}
              data={{ columns: ["Period", "Net pay"], rows: payslips.map((slip) => [slip.payroll_period.name, formatAmount(slip.payload.net_pay, slip.payload.currency)]) }}
              footer={latestPayslip ? <span>Latest: <Link href={`/payroll/payslips/${latestPayslip.id}`} className="font-semibold text-primary-ink hover:underline">{latestPayslip.payroll_period.name}</Link> · paid {formatDate(latestPayslip.payroll_period.pay_date)}</span> : undefined}
            >
              <TrendChart
                data={payslips.map((slip) => ({ period: slip.payroll_period.name, net: Number(slip.payload.net_pay) }))}
                xKey="period"
                xFormat="label"
                series={[{ key: "net", label: "Net pay", color: "var(--mod-payroll)" }]}
                format="currency"
                currency={latestPayslip?.payload.currency}
                height={220}
              />
            </ChartCard>
          )}
        </div>
      )}

      {/* Leave requests */}
      {showLeave && employee && (pendingLeave.length > 0 || upcomingLeave.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Pending requests" description="Awaiting a decision." icon={Clock3} accent="leave">
            {pendingLeave.length ? (
              <ul className="divide-y divide-line-soft">
                {pendingLeave.slice(0, 4).map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-strong">{typeName(request.leave_type)}</p>
                      <p className="text-caption text-ink-muted">{formatDate(request.start_date)} – {formatDate(request.end_date)} · {formatNumber(request.requested_days)} days</p>
                    </div>
                    <StatusBadge status={String(request.status)} size="sm" />
                  </li>
                ))}
              </ul>
            ) : <p className="text-support text-ink-muted">No requests awaiting a decision.</p>}
          </Card>
          <Card title="Upcoming time off" description="Approved leave ahead of you." icon={CalendarDays} accent="leave">
            {upcomingLeave.length ? (
              <Timeline items={upcomingLeave.slice(0, 4).map((request) => ({ id: request.id, title: typeName(request.leave_type), time: `${formatNumber(request.requested_days)} days`, description: `${formatDate(request.start_date)} – ${formatDate(request.end_date)}`, tone: "success" as const }))} />
            ) : <p className="text-support text-ink-muted">No approved leave coming up.</p>}
          </Card>
        </div>
      )}

      {/* Overtime trend */}
      {employee && showAttendance && (
        <ChartCard
          title="Overtime by week"
          description="Recorded overtime hours in each of your recent weeks."
          accent="attendance"
          icon={Timer}
          loading={loading && !data}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!overtimeWeeks.some((week) => week.overtime > 0)}
          emptyTitle="No overtime recorded"
          emptyDescription="Overtime you work will appear here."
          data={{ columns: ["Week of", "Overtime (h)"], rows: overtimeWeeks.map((week) => [week.label, week.overtime]) }}
        >
          <BarsChart data={overtimeWeeks} xKey="label" height={220} series={[{ key: "overtime", label: "Overtime (h)", color: "var(--chart-3)" }]} />
        </ChartCard>
      )}

      {/* Profile summary */}
      <Card
        title="My details"
        description="Your employee account information."
        icon={UserRound}
        accent="brand"
        actions={<ButtonLink href="/me/profile" size="sm" variant="secondary" leadingIcon={<Pencil className="h-3.5 w-3.5" />}>Edit details</ButtonLink>}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Employee number" value={employee?.employee_number ?? EM_DASH} />
          <Detail label="Work email" value={employee?.work_email ?? EM_DASH} />
          <Detail label="Personal email" value={employee?.personal_email || "Add in profile"} muted={!employee?.personal_email} />
          <Detail label="Phone" value={employee?.phone || "Add in profile"} muted={!employee?.phone} />
        </div>
      </Card>
    </div>
  );
}

function StatusTile({ label, icon: Icon, value, footer }: { label: string; icon: LucideIcon; value: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-36 flex-col rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">{label}</p><p className="mt-2 truncate text-heading font-bold text-ink-strong first-letter:uppercase">{value}</p></div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-ink" aria-hidden="true"><Icon className="h-5 w-5" /></span>
      </div>
      {footer && <div className="mt-auto pt-4 text-caption text-ink-muted">{footer}</div>}
    </div>
  );
}

/** Completed years of service and the next anniversary date, from the hire date. */
function workAnniversary(hireDate: string | null | undefined): { years: number; next: string } | null {
  if (!hireDate) return null;
  const hired = new Date(`${hireDate}T00:00:00`);
  if (Number.isNaN(hired.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - hired.getFullYear();
  if (new Date(today.getFullYear(), hired.getMonth(), hired.getDate()) > today) years -= 1;
  const next = new Date(hired.getFullYear() + Math.max(years, 0) + 1, hired.getMonth(), hired.getDate());
  return { years: Math.max(years, 0), next: next.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) };
}

function Detail({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-muted/70 p-4">
      <p className="text-caption font-medium text-ink-muted">{label}</p>
      <p className={cx("mt-1 truncate text-sm font-semibold", muted ? "text-ink-subtle" : "text-ink-strong")} title={value}>{value}</p>
    </div>
  );
}

const calendarStatus: Record<string, { label: string; short: string; className: string }> = {
  PRESENT: { label: "Present", short: "P", className: "bg-success text-white" },
  LATE: { label: "Late", short: "L", className: "bg-warning text-white" },
  ABSENT: { label: "Absent", short: "A", className: "bg-danger text-white" },
  ON_LEAVE: { label: "On leave", short: "LV", className: "bg-mod-leave text-white" },
  HOLIDAY: { label: "Holiday", short: "H", className: "bg-mod-recruitment-soft text-mod-recruitment" },
  REMOTE: { label: "Remote", short: "R", className: "bg-info text-white" },
  OFF_DAY: { label: "Off day", short: "–", className: "bg-surface-sunken text-ink-muted" },
};

/** Four-week calendar; each cell shows a letter so meaning never depends on colour. */
function AttendanceCalendar({ records, todayIso }: { records: AttendanceRecord[]; todayIso: string }) {
  const byDate = new Map(records.map((record) => [record.attendance_date, record]));
  const today = new Date(`${todayIso}T00:00:00`);
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - mondayOffset - 21);
  const days = Array.from({ length: 28 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const used = new Set(records.map((record) => String(record.status).toUpperCase()));
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {weekdays.map((day) => <span key={day} className="pb-1 text-center text-caption font-medium text-ink-subtle">{day}</span>)}
        {days.map((date) => {
          const iso = toISODate(date);
          const record = byDate.get(iso);
          const status = record ? calendarStatus[String(record.status).toUpperCase()] : undefined;
          const future = iso > todayIso;
          return (
            <span
              key={iso}
              title={`${formatDate(iso)}: ${status?.label ?? (future ? "Upcoming" : "No record")}`}
              className={cx(
                "flex aspect-square items-center justify-center rounded-lg text-caption font-semibold",
                status ? status.className : future ? "border border-dashed border-line text-ink-subtle" : "bg-surface-muted text-ink-subtle",
                iso === todayIso && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
              )}
            >
              {status ? status.short : date.getDate()}
            </span>
          );
        })}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Calendar legend">
        {Object.entries(calendarStatus).filter(([key]) => used.has(key)).map(([key, item]) => (
          <li key={key} className="inline-flex items-center gap-1.5 text-caption text-ink-muted">
            <span aria-hidden="true" className={cx("flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[0.625rem] font-bold", item.className)}>{item.short}</span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function dayLabel(iso: string, short = false): string {
  const date = new Date(`${iso}T00:00:00`);
  const todayIso = toISODate(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (iso === todayIso) return "Today";
  if (iso === toISODate(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString("en-GB", short ? { weekday: "short" } : { weekday: "long", day: "numeric", month: "short" });
}

/** Recorded overtime grouped into Monday-start weeks, oldest first (at most five). */
function overtimeByWeek(records: AttendanceRecord[]): Array<{ label: string; overtime: number }> {
  const weeks = new Map<string, number>();
  for (const record of records) {
    const date = new Date(`${record.attendance_date}T00:00:00`);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const key = toISODate(date);
    weeks.set(key, (weeks.get(key) ?? 0) + record.overtime_minutes);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-5)
    .map(([key, minutes]) => ({ label: new Date(`${key}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), overtime: hours(minutes) }));
}
