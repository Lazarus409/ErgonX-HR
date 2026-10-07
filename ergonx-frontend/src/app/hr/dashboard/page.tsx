"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, BriefcaseBusiness, Building2, CalendarCheck, ClipboardCheck, FilePlus2, MapPin, UserCheck, UserMinus, UserPlus, Users, type LucideIcon } from "lucide-react";
import { useCallback } from "react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart, DonutChart, donutLegend } from "@/components/charts/Charts";
import { RankingBars, SegmentedBar } from "@/components/charts/Visuals";
import { useAuth } from "@/components/guards/AuthProvider";
import { ButtonLink } from "@/components/ui/Button";
import { ActionCard, Avatar, Card, MetricCard, SummaryList } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { dashboardsApi, workflowsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDate, formatNumber, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { NamedCount, RecentHire } from "@/types/dashboards";
import { hasModule } from "@/types/institutions";

const statusColors: Record<string, string> = {
  ACTIVE: "var(--success)",
  ON_LEAVE: "var(--mod-leave)",
  PROBATION: "var(--chart-1)",
  SUSPENDED: "var(--warning)",
  TERMINATED: "var(--danger)",
  INACTIVE: "var(--ink-subtle)",
};

function named(items: NamedCount[] | undefined, key: keyof NamedCount) {
  return (items ?? []).map((item) => ({ label: humanizeEnum(String(item[key] ?? "Not assigned")), value: item.count }));
}

/** Source-backed HR rollup. No workforce values are manufactured in the browser. */
export default function HRDashboardPage() {
  const { institution, user } = useAuth();
  const load = useCallback(() => dashboardsApi.getHrDashboard(), []);
  const { data, loading, error, reload } = useApiResource(load);
  // Pending decisions come from the approvals inbox, which is already permission- and scope-filtered.
  const loadInbox = useCallback(() => workflowsApi.getApprovalInbox().catch(() => null), []);
  const { data: inbox } = useApiResource(loadInbox);
  const initial = loading && !data;
  const statusCount = (status: string) => data?.by_status.find((item) => item.status === status)?.count ?? 0;
  const currentYear = new Date().getFullYear();
  const hiresThisYear = data?.by_hire_year.find((item) => item.year === currentYear)?.count ?? 0;
  const can = (permission: string) => hasModule(institution?.enabledModules, "HR") && (user?.permissions.includes("*") || user?.permissions.includes(permission));
  const quickActions = [
    { href: "/hr/employees", label: "Employees", description: "Records, employment and lifecycle", icon: Users, permission: "employee.view" },
    { href: "/hr/departments", label: "Departments / Functional Areas", description: "Organization structure", icon: Building2, permission: "organization.view" },
    { href: "/hr/positions", label: "Positions", description: "Roles and reporting lines", icon: BriefcaseBusiness, permission: "organization.view" },
    { href: "/hr/locations", label: "Locations", description: "Work sites", icon: MapPin, permission: "organization.view" },
  ].filter((action) => can(action.permission));

  const enabled = (code: string) => hasModule(institution?.enabledModules, code);
  const holds = (permission: string) => Boolean(user?.permissions.includes("*") || user?.permissions.includes(permission));
  const primaryActions: Array<{ href: string; label: string; icon: LucideIcon; show: boolean }> = [
    { href: "/hr/employees/new", label: "Add employee", icon: UserPlus, show: Boolean(can("employee.create")) },
    { href: "/recruitment/job-postings/new", label: "Create requisition", icon: FilePlus2, show: enabled("RECRUITMENT") && holds("job_posting.create") },
    { href: "/approvals", label: "Review leave", icon: CalendarCheck, show: enabled("LEAVE") && holds("leave.approve") },
    { href: "/approvals", label: "Review attendance", icon: ClipboardCheck, show: enabled("ATTENDANCE") && holds("attendance.approve") },
  ].filter((action) => action.show);
  const pendingBy = (module: string) => inbox?.summary.by_module.find((row) => row.module === module)?.count ?? 0;
  const attention = [
    { count: pendingBy("LEAVE"), label: "leave requests awaiting review", href: "/approvals", action: "Review leave" },
    { count: pendingBy("ATTENDANCE"), label: "attendance corrections awaiting review", href: "/approvals", action: "Review attendance" },
    { count: pendingBy("RECRUITMENT"), label: "requisitions and offers awaiting approval", href: "/approvals", action: "Review" },
    { count: inbox?.summary.waiting_over_3_days ?? 0, label: "approvals waiting more than 3 days", href: "/approvals", action: "Open approvals", urgent: true },
  ].filter((row) => row.count > 0);

  const statusData = (data?.by_status ?? []).map((item) => ({ label: humanizeEnum(item.status), value: item.count, color: statusColors[item.status.toUpperCase()] }));
  const hireYears = (data?.by_hire_year ?? []).filter((item) => item.year !== null).sort((a, b) => (a.year ?? 0) - (b.year ?? 0)).map((item) => ({ year: String(item.year), hires: item.count }));
  const grades = named(data?.by_grade, "grade__name");
  const employmentTypes = named(data?.by_employment_type, "employment_type");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Human Resources"
        title="HR Dashboard"
        description="Live workforce composition, staffing activity and employee records for this institution."
        icon={Users}
        accent="hr"
        actions={
          <>
            {can("employee.view") && <ButtonLink href="/hr/employees" variant="secondary">View employees</ButtonLink>}
            {can("employee.create") && <ButtonLink href="/hr/employees/new" leadingIcon={<UserPlus className="h-4 w-4" />}>Add employee</ButtonLink>}
          </>
        }
      />

      {error && <ErrorState variant="inline" title="Unable to load HR dashboard" message={error} onRetry={reload} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workforce indicators">
        <MetricCard label="Workforce" value={data ? formatNumber(data.total_employees) : EM_DASH} description="Employee records" icon={Users} accent="hr" loading={initial} />
        <MetricCard label="Active employees" value={data ? formatNumber(data.active_employees) : EM_DASH} description={data?.total_employees ? `${Math.round((data.active_employees / data.total_employees) * 100)}% of workforce` : "Current active records"} icon={UserCheck} accent="accounting" loading={initial} />
        <MetricCard label="New hires" value={data ? formatNumber(hiresThisYear) : EM_DASH} description={`Hired in ${currentYear}`} icon={UserPlus} accent="attendance" loading={initial} />
        <MetricCard label="Terminated" value={data ? formatNumber(statusCount("TERMINATED")) : EM_DASH} description="Employee status records" icon={UserMinus} accent="audit" loading={initial} />
      </section>

      {primaryActions.length > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-elevation-1" aria-label="Quick actions">
          <h2 className="mr-auto flex items-center gap-2 text-card-title font-semibold text-ink-strong"><span className="h-5 w-1 rounded-full bg-primary" aria-hidden="true" />Quick actions</h2>
          {primaryActions.map((action, index) => (
            <Link key={action.label} href={action.href} className={cx("inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors", index === 0 ? "bg-ink-strong text-surface hover:bg-ink" : "bg-surface-muted text-ink-strong hover:bg-surface-hover")}>
              <action.icon className="h-4 w-4" aria-hidden="true" />{action.label}
            </Link>
          ))}
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Hiring by year"
          description="Employees by hire year (current records)."
          accent="hr"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!hireYears.length}
          emptyDescription="Hire dates will appear here as employees are added."
          data={{ columns: ["Year", "Hires"], rows: hireYears.map((item) => [item.year, item.hires]) }}
        >
          <BarsChart data={hireYears} xKey="year" series={[{ key: "hires", label: "Hires", color: "var(--mod-hr)" }]} height={240} />
        </ChartCard>
        <Card className="xl:col-span-2" title="Employees by department / functional area" description="Active employees with a current department / functional area." icon={Building2} accent="hr">
          {initial ? <div className="skeleton h-48 rounded-xl" /> : data?.by_department.length ? <RankingBars items={named(data.by_department, "department__name")} color="var(--mod-hr)" /> : <p className="text-support text-ink-muted">No current employment records are available.</p>}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-2"
          title="Workforce composition"
          description="Employee records by current status."
          accent="hr"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!statusData.length}
          emptyDescription="Employee records will appear here."
          data={{ columns: ["Status", "Employees"], rows: statusData.map((item) => [item.label, item.value]) }}
        >
          <div className="grid items-center gap-5 sm:grid-cols-[180px_1fr] xl:grid-cols-1 2xl:grid-cols-[180px_1fr]">
            <DonutChart data={statusData} height={180} centerValue={data ? formatNumber(data.total_employees) : undefined} centerLabel="employees" />
            <SummaryList items={donutLegend(statusData).map((item) => ({ label: <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>, value: item.value }))} />
          </div>
        </ChartCard>
        <Card className="xl:col-span-3" title="Location distribution" description="Active employees by current location." icon={MapPin} accent="attendance">
          {initial ? <div className="skeleton h-48 rounded-xl" /> : data?.by_location.length ? <RankingBars items={named(data.by_location, "location__name")} color="var(--mod-attendance)" /> : <p className="text-support text-ink-muted">No location assignments are available.</p>}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Grade distribution"
          description="Active employees with a current grade."
          accent="hr"
          loading={initial}
          error={!data && error ? "This data is unavailable right now." : null}
          empty={!grades.length}
          emptyDescription="Grades will appear once employments reference them."
          data={{ columns: ["Grade", "Employees"], rows: grades.map((item) => [item.label, item.value]) }}
        >
          <BarsChart data={grades.map((item) => ({ grade: item.label, count: item.value }))} xKey="grade" series={[{ key: "count", label: "Employees", color: "var(--chart-3)" }]} height={240} />
        </ChartCard>
        <Card className="xl:col-span-2" title="Employment type" description="Current active employments by type." icon={BriefcaseBusiness} accent="hr">
          {initial ? <div className="skeleton h-24 rounded-xl" /> : employmentTypes.length ? <SegmentedBar segments={employmentTypes} height="h-3.5" /> : <p className="text-support text-ink-muted">No active employments are available.</p>}
        </Card>
      </div>

      <Card title="Needs attention" description="Pending decisions in your approval queue." icon={AlertCircle} accent="brand" actions={<Link href="/approvals" className="text-support font-semibold text-primary-ink hover:underline">View all tasks</Link>}>
        {attention.length ? (
          <ul className="space-y-2">
            {attention.map((row) => (
              <li key={row.label} className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-muted/70 px-4 py-3">
                <span className={cx("text-heading font-bold tabular-nums", row.urgent ? "text-danger-ink" : "text-ink-strong")}>{row.count}</span>
                <span className="min-w-0 flex-1 text-support text-ink">{row.label}</span>
                <Link href={row.href} className="inline-flex items-center gap-1 text-support font-semibold text-primary-ink hover:underline">{row.action}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-support text-ink-muted">{inbox ? "Nothing is waiting on you." : "Pending work will appear here."}</p>}
      </Card>

      <DataTable<RecentHire>
        caption="Recent hires"
        rows={data?.recent_hires}
        rowKey={(employee) => employee.id}
        loading={initial}
        error={!data && error ? "This data is unavailable right now." : null}
        minWidth={620}
        toolbar={
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title font-bold text-headline">Recent hires</h2>
              <p className="text-support text-ink-muted">Most recently hired active employees with a current employment record.</p>
            </div>
            {can("employee.view") && <Link href="/hr/employees" className="shrink-0 text-support font-semibold text-primary-ink hover:underline">View all</Link>}
          </div>
        }
        empty={{ title: "No recent hires", description: "Employees hired with a current employment record will appear here.", icon: UserPlus }}
        columns={[
          {
            key: "name",
            header: "Employee",
            cell: (employee) => {
              const name = `${employee.first_name} ${employee.last_name}`;
              const body = <span className="flex items-center gap-3"><Avatar name={name} size="sm" /><span className="min-w-0"><span className="block truncate font-semibold text-ink-strong">{name}</span><span className="block truncate text-caption text-ink-muted">{employee.employee_number}</span></span></span>;
              return can("employee.view") ? <Link href={`/hr/employees/${employee.id}`} className="hover:underline">{body}</Link> : body;
            },
          },
          { key: "position", header: "Position", cell: (employee) => employee.employments__position__title || EM_DASH },
          { key: "department", header: "Department / Functional Area", cell: (employee) => employee.employments__department__name || EM_DASH, hideBelow: "md" },
          { key: "hired", header: "Hire date", cell: (employee) => formatDate(employee.hire_date), sortValue: (employee) => employee.hire_date },
        ]}
      />

      {quickActions.length > 0 && (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="HR areas">
          {quickActions.map((action) => <ActionCard key={action.href} href={action.href} title={action.label} description={action.description} icon={action.icon} accent="hr" />)}
        </section>
      )}
    </div>
  );
}
