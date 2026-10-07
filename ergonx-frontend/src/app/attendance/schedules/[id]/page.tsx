"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CalendarDays,
  Clock3,
  History,
  Users,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import BackNavigation from "@/components/ui/BackNavigation";
import { employeesApi, schedulingApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type {
  FlexibleWorkRule,
  RotationPattern,
  ScheduleAssignment,
  Shift,
  ShiftPattern,
  WorkSchedule,
} from "@/types/attendance";
import type { Employee } from "@/types/hr";
import { EM_DASH, formatDate, humanizeEnum } from "@/lib/format";

interface ScheduleDetail {
  schedule: WorkSchedule;
  sourceLabel: string;
  sourceKind: string;
  /** Every assignment for this schedule, current and historical. */
  assignments: ScheduleAssignment[];
  employees: Map<string, Employee>;
}

export default function ScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const load = useCallback(async (): Promise<ScheduleDetail> => {
    const schedule = await schedulingApi.getWorkSchedule(id);

    const [assignments, employees] = await Promise.all([
      schedulingApi
        .listScheduleAssignments({
          work_schedule: id,
          page_size: MAX_PAGE_SIZE,
          ordering: "-effective_from",
        })
        .then((page) => page.results)
        .catch(() => [] as ScheduleAssignment[]),
      employeesApi
        .loadEmployeeIndex()
        .then((index) => index.byId)
        .catch(() => new Map<string, Employee>()),
    ]);

    // Only the reference matching the schedule type is fetched.
    let sourceLabel = EM_DASH;
    let sourceKind = humanizeEnum(schedule.schedule_type);

    if (schedule.schedule_type === "FIXED" && schedule.fixed_shift) {
      const shift: Shift | null = await schedulingApi
        .getShift(schedule.fixed_shift)
        .catch(() => null);

      sourceKind = "Fixed shift";
      sourceLabel = shift
        ? `${shift.name} (${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)})`
        : EM_DASH;
    } else if (
      schedule.schedule_type === "SHIFT_PATTERN" &&
      schedule.shift_pattern
    ) {
      const pattern: ShiftPattern | null = await schedulingApi
        .getShiftPattern(schedule.shift_pattern)
        .catch(() => null);

      sourceKind = "Shift pattern";
      sourceLabel = pattern
        ? `${pattern.name} (${pattern.cycle_length_days}-day cycle)`
        : EM_DASH;
    } else if (
      schedule.schedule_type === "ROTATING" &&
      schedule.rotation_pattern
    ) {
      const rotations: RotationPattern[] = await schedulingApi
        .listRotationPatterns({ page_size: MAX_PAGE_SIZE })
        .then((page) => page.results)
        .catch(() => []);

      sourceKind = "Rotation pattern";
      sourceLabel =
        rotations.find((item) => item.id === schedule.rotation_pattern)?.name ??
        EM_DASH;
    } else if (
      schedule.schedule_type === "FLEXIBLE" &&
      schedule.flexible_rule
    ) {
      const rules: FlexibleWorkRule[] = await schedulingApi
        .listFlexibleWorkRules({ page_size: MAX_PAGE_SIZE })
        .then((page) => page.results)
        .catch(() => []);

      sourceKind = "Flexible rule";
      sourceLabel =
        rules.find((item) => item.id === schedule.flexible_rule)?.name ??
        EM_DASH;
    }

    return { schedule, sourceLabel, sourceKind, assignments, employees };
  }, [id]);

  const { data, loading, error, reload } = useApiResource(load);

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-primary" />
          <p className="mt-4 text-sm text-ink-muted">Loading schedule...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader
          title="Work Schedule"
          description="Schedule configuration and assignment history."
          actions={<BackLink />}
        />

        <div className="mt-6">
          <ErrorState
            message={error ?? "This work schedule could not be loaded."}
            onRetry={reload}
          />
        </div>
      </>
    );
  }

  const { schedule, sourceLabel, sourceKind, assignments, employees } = data;

  const currentAssignments = assignments.filter(
    (assignment) => assignment.is_current,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={schedule.name}
        description={`Schedule code ${schedule.code}`}
        actions={<BackLink />}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Type"
          value={humanizeEnum(schedule.schedule_type)}
          icon={<CalendarDays className="h-5 w-5" />}
        />

        <SummaryCard
          title="Effective From"
          value={formatDate(schedule.effective_from)}
          icon={<Clock3 className="h-5 w-5" />}
        />

        <SummaryCard
          title="Currently Assigned"
          value={String(currentAssignments.length)}
          icon={<Users className="h-5 w-5" />}
        />

        <SummaryCard
          title="Total Assignments"
          value={String(assignments.length)}
          icon={<History className="h-5 w-5" />}
        />
      </section>

      <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-bold text-headline">
            Schedule Configuration
          </h2>
        </div>

        <dl className="divide-y divide-line-soft">
          <RuleRow label="Code" value={schedule.code} />
          <RuleRow
            label="Schedule type"
            value={humanizeEnum(schedule.schedule_type)}
          />
          <RuleRow label={sourceKind} value={sourceLabel} />
          <RuleRow
            label="Effective from"
            value={formatDate(schedule.effective_from)}
          />
          <RuleRow
            label="Effective to"
            value={
              schedule.effective_to ? formatDate(schedule.effective_to) : "Open"
            }
          />
          <RuleRow label="Timezone" value={schedule.timezone} />
          <RuleRow
            label="Status"
            value={schedule.is_active ? "Active" : "Inactive"}
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-bold text-headline">
            Assignment History
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            Effective-dated assignments for this schedule. Replacing a current
            assignment preserves the previous record.
          </p>
        </div>

        {assignments.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No assignments"
              description="No employee has been assigned to this work schedule."
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
    </div>
  );
}

function BackLink() {
  return <BackNavigation fallback="/attendance/schedules" label="Back to Schedules" />;
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

      <p className="mt-3 text-xl font-bold text-ink-strong">{value}</p>
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
