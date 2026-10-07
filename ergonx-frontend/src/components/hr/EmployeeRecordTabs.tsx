"use client";

import Link from "next/link";
import { useCallback } from "react";
import { CalendarDays, Clock3, FileText, Wallet } from "lucide-react";

import { Card, MetricCard } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import StatusBadge from "@/components/ui/StatusBadge";
import { attendanceApi, leaveApi, payrollApi } from "@/lib/api";
import { EM_DASH, formatAmount, formatDate, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";

/**
 * Per-employee record tabs on the Employee detail page (concept: Employee
 * detail, option 1 revised). Each tab reads the module's existing list
 * endpoint filtered to this employee; the backend enforces access.
 */

function TabLoading() {
  return <div className="grid gap-4 sm:grid-cols-3" aria-label="Loading">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}</div>;
}

function clock(value: string | null) {
  if (!value) return EM_DASH;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 5) : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function EmployeeAttendanceTab({ employeeId }: { employeeId: string }) {
  const load = useCallback(() => attendanceApi.listAttendanceRecords({ employee: employeeId, page_size: 30, ordering: "-attendance_date" }), [employeeId]);
  const { data, loading, error, reload } = useApiResource(load);
  if (loading) return <TabLoading />;
  if (error || !data) return <ErrorState variant="inline" title="Attendance unavailable" message={error ?? "Attendance records could not be loaded."} onRetry={reload} />;
  const records = data.results;
  const worked = records.reduce((sum, record) => sum + record.worked_minutes, 0);
  const late = records.filter((record) => record.late_minutes > 0).length;
  const absent = records.filter((record) => record.status === "ABSENT").length;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Hours worked" value={attendanceApi.formatMinutes(worked)} description={`Last ${records.length} recorded days`} icon={Clock3} accent="attendance" size="sm" />
        <MetricCard label="Late arrivals" value={formatNumber(late)} description="Days with late minutes" icon={Clock3} accent="payroll" size="sm" />
        <MetricCard label="Absences" value={formatNumber(absent)} description="Recorded absent days" icon={CalendarDays} accent="audit" size="sm" />
      </div>
      <Card title="Attendance history" description="Most recent attendance records for this employee." icon={Clock3} padding="none" className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5">
        {records.length === 0 ? (
          <EmptyState size="compact" icon={Clock3} title="No attendance recorded" description="Attendance records will appear here once the employee clocks in." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="bg-surface-muted/80 text-left">{["Date", "Check in", "Check out", "Worked", "Status"].map((heading) => <th key={heading} scope="col" className="px-5 py-3 text-caption font-semibold text-ink-strong">{heading}</th>)}</tr></thead>
              <tbody className="divide-y divide-line-soft">
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="px-5 py-3 font-medium text-ink-strong">{formatDate(record.attendance_date)}</td>
                    <td className="px-5 py-3 tabular-nums">{clock(record.check_in)}</td>
                    <td className="px-5 py-3 tabular-nums">{clock(record.check_out)}</td>
                    <td className="px-5 py-3 tabular-nums">{attendanceApi.formatMinutes(record.worked_minutes)}</td>
                    <td className="px-5 py-3"><StatusBadge status={record.status} size="sm" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function EmployeeLeaveTab({ employeeId }: { employeeId: string }) {
  const load = useCallback(async () => {
    const year = new Date().getFullYear();
    const [types, balances, requests] = await Promise.all([
      leaveApi.listLeaveTypes({ page_size: MAX_PAGE_SIZE }),
      leaveApi.listLeaveBalances({ employee: employeeId, year, page_size: MAX_PAGE_SIZE }),
      leaveApi.listLeaveRequests({ employee: employeeId, page_size: 20, ordering: "-start_date" }),
    ]);
    return { types: new Map(types.results.map((type) => [type.id, type.name])), balances: balances.results, requests: requests.results, year };
  }, [employeeId]);
  const { data, loading, error, reload } = useApiResource(load);
  if (loading) return <TabLoading />;
  if (error || !data) return <ErrorState variant="inline" title="Leave unavailable" message={error ?? "Leave records could not be loaded."} onRetry={reload} />;
  return (
    <div className="space-y-5">
      {data.balances.length === 0 ? (
        <EmptyState size="compact" icon={CalendarDays} title={`No leave balances for ${data.year}`} description="Balances appear once leave entitlements are set up for this employee." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.balances.map((balance) => (
            <MetricCard key={balance.id} label={data.types.get(balance.leave_type) ?? "Leave"} value={`${Number(balance.available)} days`} description={`${Number(balance.used)} used of ${Number(balance.opening_balance) + Number(balance.accrued) + Number(balance.adjusted)} in ${balance.year}`} icon={CalendarDays} accent="leave" size="sm" />
          ))}
        </div>
      )}
      <Card title="Leave requests" description="Requests submitted by or for this employee." icon={CalendarDays} padding="none" className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5">
        {data.requests.length === 0 ? (
          <EmptyState size="compact" icon={CalendarDays} title="No leave requests" description="Leave requests will appear here once submitted." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {data.requests.map((request) => (
              <li key={request.id}>
                <Link href={`/leave/requests/${request.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-hover">
                  <span><span className="block font-semibold text-headline">{data.types.get(request.leave_type) ?? "Leave"}</span><span className="text-caption text-ink-muted">{formatDate(request.start_date)} – {formatDate(request.end_date)} · {Number(request.requested_days)} day{Number(request.requested_days) === 1 ? "" : "s"}</span></span>
                  <StatusBadge status={request.status} size="sm" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function EmployeePayrollTab({ employeeId }: { employeeId: string }) {
  const load = useCallback(() => payrollApi.listPayslips({ payroll_record__employee: employeeId, page_size: 12, ordering: "-generated_at" }), [employeeId]);
  const { data, loading, error, reload } = useApiResource(load);
  if (loading) return <TabLoading />;
  if (error || !data) return <ErrorState variant="inline" title="Payroll unavailable" message={error ?? "Payroll records are restricted to authorised users."} onRetry={reload} />;
  const latest = data.results[0];
  return (
    <div className="space-y-5">
      {latest && (
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard label="Latest gross pay" value={formatAmount(latest.payload.gross_pay, latest.payload.currency)} description={latest.payroll_period?.name ?? "Latest payslip"} icon={Wallet} accent="payroll" size="sm" />
          <MetricCard label="Latest deductions" value={formatAmount(latest.payload.total_deductions, latest.payload.currency)} description="Statutory and other deductions" icon={Wallet} accent="audit" size="sm" />
          <MetricCard label="Latest net pay" value={formatAmount(latest.payload.net_pay, latest.payload.currency)} description={`Generated ${formatDate(latest.generated_at)}`} icon={Wallet} accent="accounting" size="sm" />
        </div>
      )}
      <Card title="Payslips" description="Generated payslips for finalized payroll runs." icon={FileText} padding="none" className="[&>div:first-child]:px-5 [&>div:first-child]:pt-5">
        {data.results.length === 0 ? (
          <EmptyState size="compact" icon={Wallet} title="No payslips yet" description="Payslips appear after a payroll run including this employee is finalized." />
        ) : (
          <ul className="divide-y divide-line-soft">
            {data.results.map((payslip) => (
              <li key={payslip.id}>
                <Link href={`/payroll/payslips/${payslip.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-surface-hover">
                  <span><span className="block font-semibold text-headline">{payslip.payroll_period?.name ?? "Payslip"}</span><span className="text-caption text-ink-muted">Generated {formatDate(payslip.generated_at)}</span></span>
                  <span className="font-bold tabular-nums text-ink-strong">{formatAmount(payslip.payload.net_pay, payslip.payload.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
