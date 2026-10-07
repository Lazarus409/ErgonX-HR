"use client";

import { useCallback, useMemo, useState } from "react";
import { BarChart3, CalendarCheck, CalendarX, ChevronLeft, ChevronRight, Clock3, LogIn, LogOut, PencilLine } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { attendanceApi, employeesApi, getApiErrorMessage } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDate, toISODate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { AttendanceRecord } from "@/types/attendance";
import type { Employee } from "@/types/hr";

interface MyAttendance { employee: Employee | null; history: AttendanceRecord[] }

const DOT: Record<string, string> = { PRESENT: "bg-success", REMOTE: "bg-success", LATE: "bg-warning", ABSENT: "bg-danger", ON_LEAVE: "bg-mod-leave", HOLIDAY: "bg-mod-recruitment", OFF_DAY: "bg-line-strong" };

function clockTime(value: string | null): string {
  if (!value) return EM_DASH;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** My attendance (Stitch S037): month summary, calendar, daily records and correction requests. */
export default function MyAttendancePage() {
  const todayIso = useMemo(() => toISODate(new Date()), []);
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [actionRunning, setActionRunning] = useState(false);
  const [actionError, setActionError] = useState("");
  const [correcting, setCorrecting] = useState<AttendanceRecord | null>(null);
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async (): Promise<MyAttendance> => {
    const employee = await employeesApi.getCurrentEmployee();
    if (!employee) return { employee: null, history: [] };
    const history = await attendanceApi.listAttendanceRecords({ employee: employee.id, page_size: MAX_PAGE_SIZE, ordering: "-attendance_date" }).then((page) => page.results).catch(() => [] as AttendanceRecord[]);
    return { employee, history };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const employee = data?.employee ?? null;
  const history = useMemo(() => data?.history ?? [], [data]);
  const today = history.find((record) => record.attendance_date === todayIso) ?? null;
  const clockedIn = Boolean(today?.check_in) && !today?.check_out;
  const clockedOut = Boolean(today?.check_out);

  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const inMonth = history.filter((record) => record.attendance_date.startsWith(monthKey));
  const present = inMonth.filter((record) => ["PRESENT", "LATE", "REMOTE"].includes(String(record.status)));
  const late = inMonth.filter((record) => record.status === "LATE" || record.late_minutes > 0);
  const absent = inMonth.filter((record) => record.status === "ABSENT");
  const worked = present.filter((record) => record.worked_minutes > 0);
  const averageMinutes = worked.length ? Math.round(worked.reduce((sum, record) => sum + record.worked_minutes, 0) / worked.length) : null;
  const averageLate = late.length ? Math.round(late.reduce((sum, record) => sum + record.late_minutes, 0) / late.length) : null;

  /** Clock-in and clock-out are backend actions; the backend applies the schedule and leave rules. */
  const clock = async () => {
    if (!employee) return;
    setActionRunning(true); setActionError("");
    try {
      if (today && clockedIn) await attendanceApi.clockOut(today.id);
      else await attendanceApi.clockIn({ employee: employee.id, source: "WEB" });
      reload();
    } catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setActionRunning(false); }
  };

  const submitCorrection = async () => {
    if (!correcting) return;
    setActionRunning(true); setActionError("");
    try {
      // A self-service request records the reason; the reviewer proposes corrected times.
      await attendanceApi.createAttendanceAdjustment({ attendance_record: correcting.id, reason: reason.trim(), proposed_values: { notes: reason.trim() } });
      setCorrecting(null); setReason(""); setSubmitted(true); reload();
    } catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setActionRunning(false); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="My attendance"
        description="Your daily attendance, time logs and correction requests."
        icon={Clock3}
        accent="attendance"
        actions={employee && (
          <Button size="lg" variant={clockedIn ? "danger" : "primary"} onClick={() => void clock()} disabled={actionRunning || clockedOut} leadingIcon={clockedIn ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}>
            {actionRunning ? "Working…" : clockedOut ? "Clocked out for today" : clockedIn ? "Clock out" : "Clock in"}
          </Button>
        )}
      />
      {error && <ErrorState message={error} onRetry={reload} />}
      {actionError && !correcting && <ErrorState variant="inline" title="Action failed" message={actionError} />}
      {submitted && <p className="rounded-lg border border-success/25 bg-success-soft px-4 py-3 text-sm text-success-ink">Your correction request was submitted for approval.</p>}
      {!loading && !error && data && !employee && <EmptyState title="No employee record linked" description="Your account is not linked to an employee record in this institution, so attendance cannot be recorded for you." />}

      {employee && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={`Summary for ${month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`}>
            <MetricCard label="Present days" value={`${present.length}`} description={month.toLocaleDateString("en-GB", { month: "long" })} icon={CalendarCheck} accent="leave" loading={loading && !data} />
            <MetricCard label="Late arrivals" value={`${late.length}`} description={averageLate !== null ? `Average delay ${attendanceApi.formatMinutes(averageLate)}` : "None this month"} icon={Clock3} accent="payroll" loading={loading && !data} />
            <MetricCard label="Absent days" value={`${absent.length}`} description="Recorded absences" icon={CalendarX} accent="audit" loading={loading && !data} />
            <MetricCard label="Average hours" value={averageMinutes !== null ? attendanceApi.formatMinutes(averageMinutes) : EM_DASH} description="Per worked day" icon={BarChart3} accent="attendance" loading={loading && !data} />
          </section>

          <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
            <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1" aria-labelledby="attendance-calendar">
              <h2 id="attendance-calendar" className="text-card-title font-semibold text-ink-strong">Attendance calendar</h2>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-muted px-2 py-1.5">
                <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 text-ink-muted hover:bg-surface" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-sm font-semibold text-ink-strong">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
                <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 text-ink-muted hover:bg-surface" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
              </div>
              <MonthGrid month={month} records={inMonth} todayIso={todayIso} />
              <p className="mt-3 flex flex-wrap gap-3 text-caption text-ink-muted">
                {[["Present", "bg-success"], ["Late", "bg-warning"], ["Absent", "bg-danger"], ["Leave", "bg-mod-leave"], ["Off", "bg-line-strong"]].map(([label, colour]) => <span key={label} className="inline-flex items-center gap-1.5"><span className={cx("h-2 w-2 rounded-full", colour)} aria-hidden="true" />{label}</span>)}
              </p>
            </section>

            <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-elevation-1" aria-labelledby="daily-records">
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft p-5">
                <h2 id="daily-records" className="text-card-title font-semibold text-ink-strong">Daily records</h2>
                <Badge size="sm" tone="neutral">{inMonth.length} logged</Badge>
              </div>
              {inMonth.length === 0 ? <p className="p-5 text-support text-ink-muted">{loading ? "Loading…" : "No attendance recorded this month."}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] text-left text-sm">
                    <thead className="bg-surface-muted/60 text-caption uppercase tracking-[0.06em] text-ink-muted"><tr><th className="px-5 py-2.5 font-semibold">Date</th><th className="px-5 py-2.5 font-semibold">Check-in</th><th className="px-5 py-2.5 font-semibold">Check-out</th><th className="px-5 py-2.5 font-semibold">Hours</th><th className="px-5 py-2.5 font-semibold">Status</th><th className="px-5 py-2.5"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody className="divide-y divide-line-soft">
                      {inMonth.map((record) => (
                        <tr key={record.id} className={cx(record.late_minutes > 0 && "bg-warning-soft/30")}>
                          <td className="whitespace-nowrap px-5 py-3 font-medium text-ink-strong">{formatDate(record.attendance_date)}</td>
                          <td className={cx("px-5 py-3 tabular-nums", record.late_minutes > 0 ? "font-semibold text-warning-ink" : "text-ink")}>{clockTime(record.check_in)}</td>
                          <td className="px-5 py-3 tabular-nums text-ink">{clockTime(record.check_out)}</td>
                          <td className="px-5 py-3 tabular-nums text-ink">{attendanceApi.formatMinutes(record.worked_minutes)}</td>
                          <td className="px-5 py-3"><StatusBadge status={record.status} size="sm" />{record.late_minutes > 0 && <span className="ml-1 text-caption text-warning-ink">({attendanceApi.formatMinutes(record.late_minutes)})</span>}</td>
                          <td className="px-5 py-3 text-right"><button type="button" onClick={() => { setActionError(""); setSubmitted(false); setReason(""); setCorrecting(record); }} className="inline-flex items-center gap-1 text-caption font-semibold text-primary-ink hover:underline"><PencilLine className="h-3.5 w-3.5" aria-hidden="true" />Request correction</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {correcting && (
        <Dialog open onClose={() => setCorrecting(null)} title="Request attendance correction" description={`${formatDate(correcting.attendance_date)} · ${clockTime(correcting.check_in)} – ${clockTime(correcting.check_out)}`}
          footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCorrecting(null)} disabled={actionRunning}>Cancel</Button><Button loading={actionRunning} disabled={!reason.trim()} onClick={() => void submitCorrection()}>Submit request</Button></div>}>
          {actionError && <ErrorState variant="inline" title="Request not submitted" message={actionError} />}
          <label className="block text-sm font-medium text-ink-strong">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Explain what needs correcting on this record…" className="mt-1.5 w-full resize-none rounded-lg border border-line-strong px-3 py-2.5 text-sm" /></label>
          <p className="mt-2 text-caption text-ink-muted">An approver reviews the request and applies the corrected times.</p>
        </Dialog>
      )}
    </div>
  );
}

function MonthGrid({ month, records, todayIso }: { month: Date; records: AttendanceRecord[]; todayIso: string }) {
  const byDate = new Map(records.map((record) => [record.attendance_date, record]));
  const offset = (month.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1));
  return (
    <div className="mt-3 grid grid-cols-7 gap-1 text-center">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day} className="pb-1 text-caption font-medium text-ink-subtle">{day}</span>)}
      {days.map((date) => {
        const iso = toISODate(date);
        const record = byDate.get(iso);
        const current = date.getMonth() === month.getMonth();
        return (
          <span key={iso} title={record ? `${formatDate(iso)}: ${String(record.status).replaceAll("_", " ").toLowerCase()}` : undefined}
            className={cx("flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-caption", !current && "text-ink-subtle/50", iso === todayIso ? "bg-primary font-semibold text-white" : "text-ink")}>
            {date.getDate()}
            <span className={cx("h-1.5 w-1.5 rounded-full", record ? (iso === todayIso ? "bg-white" : DOT[String(record.status)] ?? "bg-line-strong") : "bg-transparent")} aria-hidden="true" />
          </span>
        );
      })}
    </div>
  );
}
