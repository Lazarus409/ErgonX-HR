"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CalendarDays,
  Clock3,
  History,
  LogOut,
  Pencil,
  User,
  X,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import BackNavigation from "@/components/ui/BackNavigation";
import {
  attendanceApi,
  employeesApi,
  getApiErrorMessage,
  schedulingApi,
} from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { AttendanceRecord, WorkSchedule } from "@/types/attendance";
import type { Employee } from "@/types/hr";
import { EM_DASH, formatDate, humanizeEnum } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";

const HISTORY_LIMIT = 10;

interface RecordDetail {
  record: AttendanceRecord;
  employee: Employee | null;
  schedule: WorkSchedule | null;
  history: AttendanceRecord[];
}

function clockTime(value: string | null): string {
  if (!value) {
    return EM_DASH;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `datetime-local` wants `YYYY-MM-DDTHH:MM` in local time. */
function toLocalInput(value: string | null): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const pad = (part: number) => `${part}`.padStart(2, "0");

  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}` +
    `T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
  );
}

export default function AttendanceRecordDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [showAdjustment, setShowAdjustment] = useState(false);
  const [adjustCheckIn, setAdjustCheckIn] = useState("");
  const [adjustCheckOut, setAdjustCheckOut] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [confirmClockOut, setConfirmClockOut] = useState(false);

  const load = useCallback(async (): Promise<RecordDetail> => {
    const record = await attendanceApi.getAttendanceRecord(id);

    const [employee, history, schedule] = await Promise.all([
      employeesApi.getEmployee(record.employee).catch(() => null),
      attendanceApi
        .listAttendanceRecords({
          employee: record.employee,
          page_size: HISTORY_LIMIT,
          ordering: "-attendance_date",
        })
        .then((page) => page.results)
        .catch(() => [] as AttendanceRecord[]),
      record.schedule_assignment
        ? schedulingApi
            .listScheduleAssignments({ page_size: MAX_PAGE_SIZE })
            .then(async (page) => {
              const assignment = page.results.find(
                (item) => item.id === record.schedule_assignment,
              );

              return assignment
                ? await schedulingApi
                    .getWorkSchedule(assignment.work_schedule)
                    .catch(() => null)
                : null;
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    return { record, employee, schedule, history };
  }, [id]);

  const { data, loading, error, reload } = useApiResource(load);

  const openAdjustment = useCallback(() => {
    if (!data) {
      return;
    }

    setActionError("");
    setSubmitted(false);
    setReason("");
    setAdjustCheckIn(toLocalInput(data.record.check_in));
    setAdjustCheckOut(toLocalInput(data.record.check_out));
    setAdjustNotes(data.record.notes ?? "");
    setShowAdjustment(true);
  }, [data]);

  /**
   * The backend accepts only `check_in`, `check_out` and `notes` in
   * `proposed_values`, and snapshots the originals itself.
   */
  const submitAdjustment = useCallback(async () => {
    if (!data) {
      return;
    }

    if (!reason.trim()) {
      setActionError("A reason is required for an adjustment request.");
      return;
    }

    const proposed: Record<string, unknown> = {};

    if (adjustCheckIn !== toLocalInput(data.record.check_in)) {
      proposed.check_in = adjustCheckIn
        ? new Date(adjustCheckIn).toISOString()
        : null;
    }

    if (adjustCheckOut !== toLocalInput(data.record.check_out)) {
      proposed.check_out = adjustCheckOut
        ? new Date(adjustCheckOut).toISOString()
        : null;
    }

    if (adjustNotes !== (data.record.notes ?? "")) {
      proposed.notes = adjustNotes;
    }

    if (Object.keys(proposed).length === 0) {
      setActionError("Change at least one value before submitting.");
      return;
    }

    setSubmitting(true);
    setActionError("");

    try {
      await attendanceApi.createAttendanceAdjustment({
        attendance_record: data.record.id,
        reason: reason.trim(),
        proposed_values: proposed,
      });

      setShowAdjustment(false);
      setSubmitted(true);
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }, [data, reason, adjustCheckIn, adjustCheckOut, adjustNotes, reload]);

  const runClockOut = useCallback(async () => {
    if (!data) {
      return;
    }

    setSubmitting(true);
    setActionError("");

    try {
      await attendanceApi.clockOut(data.record.id);
      setConfirmClockOut(false);
      reload();
    } catch (caught) {
      setConfirmClockOut(false);
      setActionError(getApiErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }, [data, reload]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-primary" />
          <p className="mt-4 text-sm text-ink-muted">
            Loading attendance record...
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <BackLink />

        <PageHeader
          title="Attendance Record"
          description="Attendance detail and correction requests."
        />

        <ErrorState
          message={error ?? "This attendance record could not be loaded."}
          onRetry={reload}
        />
      </div>
    );
  }

  const { record, employee, schedule, history } = data;

  const employeeName = employee
    ? employeesApi.employeeDisplayName(employee)
    : EM_DASH;

  const canClockOut = record.check_in !== null && record.check_out === null;

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title="Attendance Record"
        description={`${employee?.employee_number ?? EM_DASH} · ${formatDate(
          record.attendance_date,
        )}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canClockOut && (
              <button
                onClick={() => setConfirmClockOut(true)}
                className={buttonClasses({ variant: "primary" })}
              >
                <LogOut className="h-4 w-4" />
                Clock Out
              </button>
            )}

            <button
              onClick={openAdjustment}
              className={buttonClasses({ variant: "secondary" })}
            >
              <Pencil className="h-4 w-4" />
              Request Adjustment
            </button>
          </div>
        }
      />

      {actionError && (
        <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          {actionError}
        </div>
      )}

      {submitted && (
        <div className="rounded-xl border border-success/25 bg-success-soft p-4">
          <p className="text-sm font-semibold text-success-ink">
            Adjustment request created
          </p>
          <p className="mt-1 text-sm text-success-ink">
            The request is pending approval. It will appear on the{" "}
            <Link
              href="/attendance/adjustments"
              className="font-medium underline"
            >
              adjustments
            </Link>{" "}
            screen.
          </p>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-xl border border-line bg-surface p-5 shadow-sm xl:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-bold text-headline">
              Record Detail
            </h2>

            <StatusBadge status={record.status} />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <DetailItem
              icon={<User className="h-4 w-4" />}
              label="Employee"
              value={employeeName}
            />
            <DetailItem
              icon={<CalendarDays className="h-4 w-4" />}
              label="Date"
              value={formatDate(record.attendance_date)}
            />
            <DetailItem
              icon={<Clock3 className="h-4 w-4" />}
              label="Check In"
              value={clockTime(record.check_in)}
            />
            <DetailItem
              icon={<Clock3 className="h-4 w-4" />}
              label="Check Out"
              value={clockTime(record.check_out)}
            />
            <DetailItem
              icon={<CalendarDays className="h-4 w-4" />}
              label="Schedule"
              value={schedule?.name ?? EM_DASH}
            />
            <DetailItem
              icon={<History className="h-4 w-4" />}
              label="Source"
              value={humanizeEnum(record.source)}
            />
          </div>

          {record.notes && (
            <div className="mt-5 rounded-lg bg-surface-muted p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Notes
              </p>
              <p className="mt-2 text-sm leading-6 text-ink">
                {record.notes}
              </p>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="mb-5 text-base font-bold text-headline">
            Derived Minutes
          </h2>

          <div className="space-y-3">
            <MiniStat
              label="Worked"
              value={attendanceApi.formatMinutes(record.worked_minutes)}
            />
            <MiniStat
              label="Late"
              value={attendanceApi.formatMinutes(record.late_minutes)}
            />
            <MiniStat
              label="Early departure"
              value={attendanceApi.formatMinutes(
                record.early_departure_minutes,
              )}
            />
            <MiniStat
              label="Overtime"
              value={attendanceApi.formatMinutes(record.overtime_minutes)}
            />
          </div>

          <p className="mt-4 text-xs leading-5 text-ink-muted">
            All minute values are classified by the backend against the
            employee&apos;s effective schedule.
          </p>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-surface shadow-sm">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-bold text-headline">
            Recent Attendance
          </h2>
          <p className="mt-1 text-xs text-ink-muted">
            The employee&apos;s most recent attendance records.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left">
            <thead>
              <tr className="border-b border-line bg-surface-muted">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Date
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Check In
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Check Out
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Worked
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Status
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line-soft">
              {history.map((entry) => (
                <tr key={entry.id} className={entry.id === record.id ? "bg-surface-muted" : ""}>
                  <td className="px-5 py-4 text-sm text-ink">
                    <Link
                      href={`/attendance/live/${entry.id}`}
                      className="hover:underline"
                    >
                      {formatDate(entry.attendance_date)}
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-sm text-ink">
                    {clockTime(entry.check_in)}
                  </td>
                  <td className="px-5 py-4 text-sm text-ink">
                    {clockTime(entry.check_out)}
                  </td>
                  <td className="px-5 py-4 text-sm text-ink">
                    {attendanceApi.formatMinutes(entry.worked_minutes)}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={entry.status} />
                  </td>
                </tr>
              ))}

              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-ink-muted">
                    No other attendance records for this employee.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Adjustment request */}
      {showAdjustment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-6 py-4">
              <h2 className="text-lg font-bold text-headline">
                Request Adjustment
              </h2>

              <button
                onClick={() => setShowAdjustment(false)}
                disabled={submitting}
                className="rounded-lg p-2 text-ink-subtle hover:bg-surface-hover hover:text-ink-strong"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              {actionError && (
                <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                  {actionError}
                </div>
              )}

              <p className="rounded-lg bg-surface-muted p-3 text-xs leading-5 text-ink-muted">
                Only check-in, check-out and notes can be adjusted. The original
                values are snapshotted by the backend when the request is
                raised.
              </p>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Proposed Check In
                </span>
                <input
                  type="datetime-local"
                  value={adjustCheckIn}
                  onChange={(event) => setAdjustCheckIn(event.target.value)}
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Proposed Check Out
                </span>
                <input
                  type="datetime-local"
                  value={adjustCheckOut}
                  onChange={(event) => setAdjustCheckOut(event.target.value)}
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Notes
                </span>
                <input
                  value={adjustNotes}
                  onChange={(event) => setAdjustNotes(event.target.value)}
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Reason
                </span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  placeholder="Why does this record need correcting?"
                  className="w-full resize-none rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-primary"
                />
              </label>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-surface px-6 py-4">
              <button
                onClick={() => setShowAdjustment(false)}
                disabled={submitting}
                className={buttonClasses({ variant: "secondary" })}
              >
                Cancel
              </button>

              <button
                onClick={submitAdjustment}
                disabled={submitting || !reason.trim()}
                className={buttonClasses({ variant: "primary" })}
              >
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmClockOut}
        title="Clock out this employee?"
        description="The backend records the clock-out time and reclassifies worked, late and overtime minutes for the day."
        confirmLabel="Clock out"
        loading={submitting}
        onConfirm={runClockOut}
        onCancel={() => setConfirmClockOut(false)}
      />
    </div>
  );
}

function BackLink() {
  return <BackNavigation fallback="/attendance/live" label="Back to Live Attendance" />;
}

function DetailItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {icon}
        {label}
      </p>

      <p className="mt-2 text-sm font-medium text-ink-strong">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-muted px-4 py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold text-ink-strong">{value}</span>
    </div>
  );
}
