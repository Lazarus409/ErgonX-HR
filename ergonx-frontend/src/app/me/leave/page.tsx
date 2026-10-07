"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Plane, Plus } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { employeesApi, leaveApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDate, formatNumber, toISODate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { Employee } from "@/types/hr";
import type { LeaveBalance, LeaveRequest, LeaveType } from "@/types/leave";

interface MyLeave {
  employee: Employee | null;
  balances: LeaveBalance[];
  requests: LeaveRequest[];
  leaveTypes: Map<string, LeaveType>;
}

type RequestFilter = "ALL" | "PENDING" | "APPROVED" | "DECLINED";
const BAR_COLOURS = ["bg-primary", "bg-mod-leave", "bg-mod-attendance", "bg-mod-payroll", "bg-mod-recruitment"];

/** My leave (Stitch S035): balances by type, request leave, my requests, calendar, upcoming leave. */
export default function MyLeavePage() {
  const load = useCallback(async (): Promise<MyLeave> => {
    const types = await leaveApi.listLeaveTypes({ page_size: MAX_PAGE_SIZE }).then((page) => page.results).catch(() => [] as LeaveType[]);
    const leaveTypes = new Map(types.map((type) => [type.id, type]));
    const employee = await employeesApi.getCurrentEmployee();
    if (!employee) return { employee: null, balances: [], requests: [], leaveTypes };
    const [balances, requests] = await Promise.all([
      leaveApi.listLeaveBalances({ employee: employee.id, year: new Date().getFullYear(), page_size: MAX_PAGE_SIZE }).then((page) => page.results).catch(() => [] as LeaveBalance[]),
      leaveApi.listLeaveRequests({ employee: employee.id, page_size: MAX_PAGE_SIZE, ordering: "-start_date" }).then((page) => page.results).catch(() => [] as LeaveRequest[]),
    ]);
    return { employee, balances, requests, leaveTypes };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const [filter, setFilter] = useState<RequestFilter>("ALL");
  const initial = loading && !data;
  const requests = useMemo(() => data?.requests ?? [], [data]);
  const typeName = (id: string) => data?.leaveTypes.get(id)?.name ?? "Leave";
  const today = toISODate(new Date());
  const declined = (request: LeaveRequest) => ["REJECTED", "CANCELLED"].includes(String(request.status));
  const shown = requests.filter((request) => filter === "ALL" || (filter === "DECLINED" ? declined(request) : request.status === filter));
  const upcoming = requests.filter((request) => request.status === "APPROVED" && request.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="My leave" description="Plan, request and follow your leave." icon={CalendarDays} accent="leave" meta={<Badge tone="neutral">Leave year {new Date().getFullYear()}</Badge>} />
      {error && <ErrorState variant="inline" message={error} onRetry={reload} />}
      {!loading && !error && data && !data.employee && (
        <EmptyState icon={CalendarDays} accent="leave" title="No employee record linked" description="Your account is not linked to an employee record in this institution, so personal leave balances and requests are unavailable." />
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Leave balances">
        {initial && [0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-36 rounded-xl" />)}
        {data?.balances.map((balance, index) => {
          const granted = Number(balance.opening_balance) + Number(balance.accrued) + Number(balance.adjusted);
          const used = Number(balance.used);
          const share = granted > 0 ? Math.min(100, (used / granted) * 100) : 0;
          return (
            <article key={balance.id} className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
              <p className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">{typeName(balance.leave_type)}</p>
              <p className="mt-1 text-kpi-sm font-bold tabular-nums text-ink-strong">{formatNumber(balance.available)} <span className="text-support font-medium text-ink-muted">days</span></p>
              <p className="mt-2 flex justify-between text-caption text-ink-muted"><span>Available balance</span><span>{formatNumber(used)} used of {formatNumber(granted)}</span></p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-label={`${typeName(balance.leave_type)} used`} aria-valuemin={0} aria-valuemax={granted} aria-valuenow={used}>
                <div className={cx("h-full rounded-full", BAR_COLOURS[index % BAR_COLOURS.length])} style={{ width: `${share}%` }} />
              </div>
            </article>
          );
        })}
        {data?.employee && data.balances.length === 0 && <p className="text-support text-ink-muted sm:col-span-2 xl:col-span-4">No leave balances are set up for you this year yet.</p>}
      </section>

      {data?.employee && (
        <section className="flex flex-wrap items-center gap-4 rounded-xl bg-ink-strong p-5 text-surface shadow-elevation-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface/15" aria-hidden="true"><CalendarPlus className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="text-card-title font-semibold">Request leave</h2><p className="text-support text-surface/75">Submit a new request; it goes to your approver automatically.</p></div>
          <Link href="/me/leave/request" className="inline-flex items-center gap-2 rounded-lg bg-surface/10 px-4 py-2.5 text-sm font-semibold hover:bg-surface/20">Open form<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        </section>
      )}

      {data?.employee && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1" aria-labelledby="my-requests">
            <h2 id="my-requests" className="text-card-title font-semibold text-ink-strong">My requests</h2>
            <p className="text-support text-ink-muted">Status and history of your submitted requests.</p>
            <Tabs className="mt-3" label="Filter requests" variant="pill" value={filter} onChange={(value) => setFilter(value as RequestFilter)} items={[
              { value: "ALL", label: "All", count: requests.length },
              { value: "PENDING", label: "Pending", count: requests.filter((request) => request.status === "PENDING").length },
              { value: "APPROVED", label: "Approved", count: requests.filter((request) => request.status === "APPROVED").length },
              { value: "DECLINED", label: "Declined", count: requests.filter(declined).length },
            ]} />
            {shown.length === 0 ? <p className="py-8 text-center text-support text-ink-muted">No requests here.</p> : (
              <ul className="mt-3 divide-y divide-line-soft">
                {shown.map((request) => (
                  <li key={request.id}>
                    <Link href={`/leave/requests/${request.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-surface-hover/50">
                      <span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{formatDate(request.start_date)} – {formatDate(request.end_date)}</span><span className="text-caption text-ink-muted">{formatNumber(request.requested_days)} day{Number(request.requested_days) === 1 ? "" : "s"}</span></span>
                      <Badge size="sm" tone="neutral">{typeName(request.leave_type)}</Badge>
                      <StatusBadge status={request.status} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <ButtonLink className="mt-3" href="/me/leave/request" size="sm" variant="secondary" leadingIcon={<Plus className="h-4 w-4" />}>Submit new leave request</ButtonLink>
          </section>

          <div className="space-y-6">
            <LeaveCalendar requests={requests} typeName={typeName} />
            <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1" aria-labelledby="upcoming-leave">
              <h2 id="upcoming-leave" className="text-card-title font-semibold text-ink-strong">Upcoming approved leave</h2>
              {upcoming.length === 0 ? <p className="mt-2 text-support text-ink-muted">No approved leave ahead of you.</p> : (
                <ul className="mt-3 space-y-3">
                  {upcoming.slice(0, 3).map((request) => (
                    <li key={request.id} className="flex items-start gap-3 rounded-lg bg-surface-muted/70 p-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary-ink" aria-hidden="true"><Plane className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{typeName(request.leave_type)}</span><span className="text-caption text-ink-muted">{formatDate(request.start_date)} – {formatDate(request.end_date)} · {formatNumber(request.requested_days)} days</span></span>
                      <Badge size="sm" tone="success" dot>Confirmed</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** A month grid marking your own pending and approved leave days. */
function LeaveCalendar({ requests, typeName }: { requests: LeaveRequest[]; typeName: (id: string) => string }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const todayIso = toISODate(new Date());
  const offset = (month.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1));
  const relevant = requests.filter((request) => ["APPROVED", "PENDING"].includes(String(request.status)));
  const onDay = (iso: string) => relevant.filter((request) => request.start_date <= iso && request.end_date >= iso);
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1" aria-labelledby="leave-calendar">
      <div className="flex items-center justify-between gap-2">
        <h2 id="leave-calendar" className="text-card-title font-semibold text-ink-strong">Leave calendar</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 text-ink-muted hover:bg-surface-muted" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
          <span className="w-32 text-center text-sm font-semibold text-ink-strong">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 text-ink-muted hover:bg-surface-muted" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span key={day} className="pb-1 text-caption font-medium text-ink-subtle">{day}</span>)}
        {days.map((date) => {
          const iso = toISODate(date);
          const inMonth = date.getMonth() === month.getMonth();
          const marks = onDay(iso);
          const approved = marks.some((request) => request.status === "APPROVED");
          return (
            <span key={iso} title={marks.map((request) => `${typeName(request.leave_type)} (${String(request.status).toLowerCase()})`).join(", ") || undefined}
              className={cx("flex aspect-square flex-col items-center justify-center rounded-lg text-caption", !inMonth && "text-ink-subtle/60", iso === todayIso && "ring-2 ring-primary", approved ? "bg-primary text-white" : marks.length ? "bg-primary-soft text-primary-ink" : "text-ink")}>
              {date.getDate()}
            </span>
          );
        })}
      </div>
      <p className="mt-3 flex flex-wrap gap-4 text-caption text-ink-muted"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-primary" aria-hidden="true" />Approved</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-primary-soft" aria-hidden="true" />Pending</span></p>
    </section>
  );
}
