"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Clock3,
  Moon,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import BackNavigation from "@/components/ui/BackNavigation";
import {
  attendanceApi,
  employeesApi,
  schedulingApi,
} from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type {
  ScheduleAssignment,
  Shift,
  WorkSchedule,
} from "@/types/attendance";
import type { Employee } from "@/types/hr";
import { EM_DASH, formatDate, humanizeEnum } from "@/lib/format";

interface ShiftDetail {
  shift: Shift;
  /** Work schedules that use this shift as their fixed shift. */
  schedules: WorkSchedule[];
  assignments: ScheduleAssignment[];
  employees: Map<string, Employee>;
}

export default function ShiftDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const load = useCallback(async (): Promise<ShiftDetail> => {
    const shift = await schedulingApi.getShift(id);

    const allSchedules = await schedulingApi
      .listWorkSchedules({ page_size: MAX_PAGE_SIZE })
      .then((page) => page.results)
      .catch(() => [] as WorkSchedule[]);

    // Work schedules expose no `fixed_shift` filter, so the link is resolved
    // from the schedule list.
    const schedules = allSchedules.filter(
      (schedule) => schedule.fixed_shift === id,
    );

    const scheduleIds = new Set(schedules.map((schedule) => schedule.id));

    const assignments = await schedulingApi
      .listScheduleAssignments({
        page_size: MAX_PAGE_SIZE,
        is_current: true,
      })
      .then((page) =>
        page.results.filter((assignment) =>
          scheduleIds.has(assignment.work_schedule),
        ),
      )
      .catch(() => [] as ScheduleAssignment[]);

    const employees = await employeesApi
      .loadEmployeeIndex()
      .then((index) => index.byId)
      .catch(() => new Map<string, Employee>());

    return { shift, schedules, assignments, employees };
  }, [id]);

  const { data, loading, error, reload } = useApiResource(load);

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-primary" />
          <p className="mt-4 text-sm text-ink-muted">Loading shift...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader
          title="Shift"
          description="Shift configuration and assigned employees."
          actions={<BackLink />}
        />

        <div className="mt-6">
          <ErrorState
            message={error ?? "This shift could not be loaded."}
            onRetry={reload}
          />
        </div>
      </>
    );
  }

  const { shift, schedules, assignments, employees } = data;

  const time = (value: string) => value.slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title={shift.name}
        description={`Shift code ${shift.code}`}
        actions={<BackLink />}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Start"
          value={time(shift.start_time)}
          icon={<Clock3 className="h-5 w-5" />}
        />

        <SummaryCard
          title="End"
          value={time(shift.end_time)}
          icon={shift.crosses_midnight ? <Moon className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
        />

        <SummaryCard
          title="Scheduled"
          value={attendanceApi.formatMinutes(shift.scheduled_minutes)}
          icon={<Timer className="h-5 w-5" />}
        />

        <SummaryCard
          title="Assigned"
          value={String(assignments.length)}
          icon={<Users className="h-5 w-5" />}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-bold text-headline">
              Shift Configuration
            </h2>
          </div>

          <dl className="divide-y divide-line-soft">
            <RuleRow label="Start time" value={time(shift.start_time)} />
            <RuleRow label="End time" value={time(shift.end_time)} />
            <RuleRow
              label="Crosses midnight"
              value={shift.crosses_midnight ? "Yes" : "No"}
            />
            <RuleRow
              label="Break"
              value={attendanceApi.formatMinutes(shift.break_minutes)}
            />
            <RuleRow
              label="Grace period"
              value={attendanceApi.formatMinutes(shift.grace_period_minutes)}
            />
            <RuleRow
              label="Scheduled hours"
              value={attendanceApi.formatMinutes(shift.scheduled_minutes)}
            />
            <RuleRow
              label="Status"
              value={shift.is_active ? "Active" : "Inactive"}
            />
          </dl>
        </section>

        <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-base font-bold text-headline">
              Work Schedules
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Schedules that use this shift as their fixed shift.
            </p>
          </div>

          {schedules.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Not used by any schedule"
                description="No fixed work schedule currently references this shift."
              />
            </div>
          ) : (
            <div className="divide-y divide-line-soft">
              {schedules.map((schedule) => (
                <Link
                  key={schedule.id}
                  href={`/attendance/schedules/${schedule.id}`}
                  className="flex items-center justify-between px-5 py-4 transition hover:bg-surface-hover"
                >
                  <div>
                    <p className="text-sm font-medium text-ink-strong">
                      {schedule.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {schedule.code} · {humanizeEnum(schedule.schedule_type)} ·
                      from {formatDate(schedule.effective_from)}
                    </p>
                  </div>

                  <StatusBadge
                    status={schedule.is_active ? "ACTIVE" : "INACTIVE"}
                  />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-bold text-headline">
            Assigned Employees
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Employees whose current schedule assignment resolves to this shift.
          </p>
        </div>

        {assignments.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No employees assigned"
              description="No current schedule assignment resolves to this shift."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead>
                <tr className="border-b border-line bg-surface-muted">
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Employee
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Effective From
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Effective To
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Current
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line-soft">
                {assignments.map((assignment) => {
                  const employee = employees.get(assignment.employee);

                  return (
                    <tr key={assignment.id}>
                      <td className="px-5 py-4">
                        {employee ? (
                          <Link
                            href={`/hr/employees/${employee.id}`}
                            className="font-medium text-ink-strong hover:underline"
                          >
                            {employeesApi.employeeDisplayName(employee)}
                          </Link>
                        ) : (
                          <span className="text-ink-muted">{EM_DASH}</span>
                        )}

                        <p className="mt-1 text-xs text-ink-muted">
                          {employee?.employee_number ?? EM_DASH}
                        </p>
                      </td>

                      <td className="px-5 py-4 text-sm text-ink">
                        {formatDate(assignment.effective_from)}
                      </td>

                      <td className="px-5 py-4 text-sm text-ink">
                        {assignment.effective_to
                          ? formatDate(assignment.effective_to)
                          : EM_DASH}
                      </td>

                      <td className="px-5 py-4">
                        <StatusBadge
                          status={assignment.is_current ? "ACTIVE" : "INACTIVE"}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface-muted px-5 py-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />

          <div>
            <p className="text-sm font-semibold text-ink">
              Schedule-aware attendance
            </p>

            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Clock events resolve the employee&apos;s effective schedule and
              are classified against this shift&apos;s start time and grace
              period. Lateness, early departure and overtime are all derived by
              the backend.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function BackLink() {
  return <BackNavigation fallback="/attendance/shifts" label="Back to Shifts" />;
}

function SummaryCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">{title}</p>

        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-sunken text-ink">
          {icon}
        </span>
      </div>

      <p className="mt-3 text-2xl font-bold text-ink-strong">{value}</p>
    </div>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink-strong">{value}</dd>
    </div>
  );
}
