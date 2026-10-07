"use client";

import { CalendarDays, CalendarOff, ClipboardCheck, Network, UserCheck, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart } from "@/components/charts/Charts";
import { RankingBars } from "@/components/charts/Visuals";
import { useAuth } from "@/components/guards/AuthProvider";
import { ButtonLink } from "@/components/ui/Button";
import { Avatar, Card, MetricCard } from "@/components/ui/Card";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Field";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { dashboardsApi } from "@/lib/api";
import { EM_DASH, formatDate, formatNumber, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { DepartmentLeaveItem, DepartmentTeamMember } from "@/types/dashboards";
import { hasModule } from "@/types/institutions";

const TODAY_FILTERS = [
  { value: "ALL", label: "Everyone" },
  { value: "PRESENT", label: "Present" },
  { value: "LATE", label: "Late" },
  { value: "ABSENT", label: "Absent" },
  { value: "ON_LEAVE", label: "On leave" },
  { value: "NONE", label: "Not recorded" },
];

function dateRange(item: DepartmentLeaveItem) {
  return item.start_date === item.end_date ? formatDate(item.start_date) : `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`;
}

/** Department Head overview: who is in today, who is off soon, and what needs a decision. */
export default function DepartmentOverviewPage() {
  const { institution } = useAuth();
  const load = useCallback(() => dashboardsApi.getDepartmentDashboard(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const [query, setQuery] = useState("");
  const [todayFilter, setTodayFilter] = useState("ALL");
  const initial = loading && !data;
  const leaveEnabled = hasModule(institution?.enabledModules, "LEAVE");
  const attendanceEnabled = hasModule(institution?.enabledModules, "ATTENDANCE");

  const team = useMemo(() => (data?.team ?? []).filter((member) => {
    const text = `${member.full_name} ${member.employee_number} ${member.position} ${member.department}`.toLowerCase();
    const status = member.today_status ?? "NONE";
    return text.includes(query.toLowerCase()) && (todayFilter === "ALL" || status === todayFilter);
  }), [data, query, todayFilter]);

  if (data && data.departments.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="My department / functional area" title="Department / Functional Area overview" description="Your team's attendance, leave and approvals." icon={Network} accent="hr" />
        <EmptyState icon={Network} accent="hr" title="You are not set as head of a department / functional area" description="HR assigns department / functional area heads on the Departments / Functional Areas page. Once you are assigned, your team appears here." />
      </div>
    );
  }

  const today = data?.today ?? {};
  const names = data?.departments.map((department) => department.name).join(", ");
  const trend = (data?.attendance_trend ?? []).map((row) => ({ ...row, day: row.date }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My department / functional area"
        title={names || "Department / Functional Area overview"}
        description={data ? `Team of ${formatNumber(data.headcount)} as of ${formatDate(data.as_of)}. Pay and personal details stay with HR.` : "Your team's attendance, leave and approvals."}
        icon={Network}
        accent="hr"
        actions={
          <>
            {leaveEnabled && <ButtonLink href="/leave/calendar" variant="secondary" leadingIcon={<CalendarDays className="h-4 w-4" />}>Team calendar</ButtonLink>}
            {leaveEnabled && <ButtonLink href="/department/approvals" leadingIcon={<ClipboardCheck className="h-4 w-4" />}>Review approvals{data?.pending_approvals ? ` (${data.pending_approvals})` : ""}</ButtonLink>}
          </>
        }
      />

      {error && <ErrorState variant="inline" title="Unable to load your department / functional area" message={error} onRetry={reload} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Team indicators">
        <MetricCard label="Team size" value={data ? formatNumber(data.headcount) : EM_DASH} description={data && data.departments.length > 1 ? `Across ${data.departments.length} departments` : "Current employees, excluding you"} icon={Users} accent="hr" loading={initial} />
        {attendanceEnabled && <MetricCard label="In today" value={data ? formatNumber((today.present ?? 0) + (today.remote ?? 0) + (today.late ?? 0)) : EM_DASH} description={data ? `${formatNumber(today.late ?? 0)} late · ${formatNumber(today.absent ?? 0)} absent · ${formatNumber(today.not_recorded ?? 0)} not recorded` : "Attendance today"} icon={UserCheck} accent="attendance" loading={initial} />}
        {leaveEnabled && <MetricCard label="On leave today" value={data ? formatNumber(data.on_leave_today.length) : EM_DASH} description={data?.upcoming_leave.length ? `${data.upcoming_leave.length} more starting in the next 30 days` : "No leave starting soon"} icon={CalendarOff} accent="leave" loading={initial} />}
        {leaveEnabled && <MetricCard label="Awaiting your approval" value={data ? formatNumber(data.pending_approvals) : EM_DASH} description="Leave requests at your step" icon={ClipboardCheck} accent="brand" loading={initial} href="/department/approvals" />}
      </section>

      {leaveEnabled && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Off today" description="Approved leave covering today." icon={CalendarOff} accent="leave">
            {initial ? <div className="skeleton h-32 rounded-xl" /> : data?.on_leave_today.length ? <LeaveList items={data.on_leave_today} /> : <p className="text-support text-ink-muted">Nobody on your team is on leave today.</p>}
          </Card>
          <Card title="Coming up" description="Approved and pending leave starting in the next 30 days." icon={CalendarDays} accent="leave">
            {initial ? <div className="skeleton h-32 rounded-xl" /> : data?.upcoming_leave.length ? <LeaveList items={data.upcoming_leave} showStatus /> : <p className="text-support text-ink-muted">No leave is planned in the next 30 days.</p>}
          </Card>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        {attendanceEnabled && (
          <ChartCard
            className="xl:col-span-3"
            title="Attendance, last 14 days"
            description="Daily attendance records for your team."
            accent="attendance"
            loading={initial}
            empty={!trend.some((row) => row.present || row.late || row.absent)}
            emptyDescription="Attendance records for your team will appear here."
            data={{ columns: ["Date", "Present", "Late", "Absent"], rows: trend.map((row) => [row.date, row.present, row.late, row.absent]) }}
          >
            <BarsChart data={trend} xKey="day" xFormat="day" mode="stacked" height={240} series={[{ key: "present", label: "Present", color: "var(--success)" }, { key: "late", label: "Late", color: "var(--warning)" }, { key: "absent", label: "Absent", color: "var(--danger)" }]} />
          </ChartCard>
        )}
        <Card className={attendanceEnabled ? "xl:col-span-2" : "xl:col-span-5"} title={leaveEnabled ? "Leave taken this year" : "Team by position"} description={leaveEnabled ? "Approved days by leave type." : "Current positions on your team."} icon={leaveEnabled ? CalendarOff : Users} accent={leaveEnabled ? "leave" : "hr"}>
          {initial ? <div className="skeleton h-48 rounded-xl" /> : leaveEnabled
            ? data?.leave_by_type.length ? <RankingBars items={data.leave_by_type.map((row) => ({ label: row.leave_type__name, value: Number(row.days), hint: `${row.requests} request${row.requests === 1 ? "" : "s"}` }))} color="var(--mod-leave)" /> : <p className="text-support text-ink-muted">No approved leave yet this year.</p>
            : data?.by_position.length ? <RankingBars items={data.by_position.map((row) => ({ label: row.position, value: row.count }))} color="var(--mod-hr)" /> : <p className="text-support text-ink-muted">No positions to show.</p>}
        </Card>
      </div>

      <DataTable<DepartmentTeamMember>
        caption="Team roster"
        rows={team}
        rowKey={(member) => member.employee_id}
        loading={initial}
        error={error && !data ? error : null}
        onRetry={reload}
        minWidth={760}
        toolbar={
          <DataToolbar
            search={query}
            onSearchChange={setQuery}
            searchPlaceholder="Search your team…"
            filters={attendanceEnabled || leaveEnabled ? <Select size="sm" aria-label="Today" value={todayFilter} onChange={(event) => setTodayFilter(event.target.value)}>{TODAY_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select> : undefined}
            onClear={query || todayFilter !== "ALL" ? () => { setQuery(""); setTodayFilter("ALL"); } : undefined}
          />
        }
        empty={{ title: "No team members match", description: "Try a broader search or filter.", icon: Users }}
        columns={[
          {
            key: "name",
            header: "Team member",
            sortValue: (member) => member.full_name,
            cell: (member) => (
              <span className="flex items-center gap-3">
                <Avatar name={member.full_name} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink-strong">{member.full_name}</span>
                  <span className="block truncate text-caption text-ink-muted">{member.employee_number}{data && data.departments.length > 1 ? ` · ${member.department}` : ""}</span>
                </span>
              </span>
            ),
          },
          { key: "position", header: "Position", sortValue: (member) => member.position, cell: (member) => <span><span className="block">{member.position}</span><span className="block text-caption text-ink-muted">{member.grade} · {humanizeEnum(member.employment_type)}</span></span> },
          { key: "reports_to", header: "Reports to", hideBelow: "lg", sortValue: (member) => member.reports_to ?? "", cell: (member) => member.reports_to ?? EM_DASH },
          { key: "contact", header: "Contact", hideBelow: "md", cell: (member) => <span className="text-support"><span className="block truncate">{member.work_email || EM_DASH}</span><span className="block text-ink-muted">{member.phone || ""}</span></span> },
          { key: "today", header: "Today", sortValue: (member) => member.today_status ?? "", cell: (member) => member.today_status ? <StatusBadge status={member.today_status} size="sm" /> : <span className="text-caption text-ink-muted">Not recorded</span> },
        ]}
      />
    </div>
  );
}

function LeaveList({ items, showStatus = false }: { items: DepartmentLeaveItem[]; showStatus?: boolean }) {
  return (
    <ul className="divide-y divide-line-soft">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
          <span className="flex min-w-0 items-center gap-3">
            <Avatar name={item.employee} size="sm" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink-strong">{item.employee}</span>
              <span className="block truncate text-caption text-ink-muted">{item.leave_type} · {dateRange(item)}</span>
            </span>
          </span>
          {showStatus && item.status && <StatusBadge status={item.status} size="sm" />}
        </li>
      ))}
    </ul>
  );
}
