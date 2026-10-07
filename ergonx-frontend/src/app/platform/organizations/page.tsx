"use client";

import { Building2, LayoutGrid, TrendingUp, UserCheck, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart } from "@/components/charts/Charts";
import { countryName, formatDate, formatRelative, onboardingLabel } from "@/components/platform/format";
import { SectionTitle, StatTile, platformCard, platformTable } from "@/components/platform/ui";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Card";
import { DataTable, DataToolbar, Pagination } from "@/components/ui/DataTable";
import { SummaryList } from "@/components/ui/Card";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { platformApi } from "@/lib/api";
import type { PlatformInstitution } from "@/lib/api/platform";
import { DEFAULT_PAGE_SIZE } from "@/types/api";
import { useApiResource } from "@/lib/useApiResource";

type StatusFilter = "" | "active" | "suspended";

const onboardingTone: Record<string, BadgeTone> = { READY: "success", IN_PROGRESS: "info", BLOCKED: "danger", NOT_STARTED: "neutral" };

export default function PlatformOrganizationsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);

  // Search the server once typing pauses rather than on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(() => platformApi.listInstitutions({ page, q: query, status }), [page, query, status]);
  const { data, loading, error, reload } = useApiResource(load);
  const loadOverview = useCallback(() => platformApi.getOverview(), []);
  const { data: overview } = useApiResource(loadOverview);
  const growth = overview?.growth.months.map((month, index) => ({
    month,
    institutions: overview.growth.institutions[index] ?? 0,
    access_requests: overview.growth.access_requests[index] ?? 0,
  })) ?? [];

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform summary">
        <StatTile label="Organizations" value={overview?.institutions.total ?? "—"} icon={Building2} tone="sky" hint={overview ? `${overview.institutions.active} active · ${overview.institutions.suspended} suspended` : undefined} />
        <StatTile label="New in the last 30 days" value={overview?.institutions.new_last_30_days ?? "—"} icon={TrendingUp} tone="violet" />
        <StatTile label="Users signed in, last 30 days" value={overview?.users.signed_in_last_30_days ?? "—"} icon={UserCheck} tone="emerald" hint={overview ? `of ${overview.users.total.toLocaleString("en-GB")} user accounts` : undefined} />
        <StatTile label="Employees managed" value={overview ? overview.employees.total.toLocaleString("en-GB") : "—"} icon={UsersRound} tone="amber" />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ChartCard
          className="rounded-3xl"
          title="Growth"
          description="New organizations and Get Started requests in each of the last 12 months."
          icon={TrendingUp}
          accent="brand"
          loading={!overview}
          legend={[{ label: "Organizations created", color: "var(--chart-1)" }, { label: "Access requests", color: "var(--chart-3)" }]}
          empty={!growth.some((point) => point.institutions || point.access_requests)}
          emptyDescription="Sign-ups and requests will appear here."
          data={{ columns: ["Month", "Organizations created", "Access requests"], rows: growth.map((point) => [point.month, point.institutions, point.access_requests]) }}
        >
          <BarsChart data={growth} xKey="month" xFormat="month" height={230} series={[{ key: "institutions", label: "Organizations created", color: "var(--chart-1)" }, { key: "access_requests", label: "Access requests", color: "var(--chart-3)" }]} />
        </ChartCard>
        <section className={`${platformCard} p-5 sm:p-6`}>
          <SectionTitle eyebrow="Onboarding" title="Setup progress" description="Where organizations are in their setup checklist." />
          {overview && <SummaryList className="mt-4" items={(["READY", "IN_PROGRESS", "NOT_STARTED", "BLOCKED"] as const).map((key) => ({ label: onboardingLabel[key], value: overview.onboarding[key] }))} />}
          <p className="mt-4 flex items-center gap-2 text-caption text-ink-muted"><LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />Blocked organizations report a problem in their own setup checklist.</p>
        </section>
      </div>

      <DataTable<PlatformInstitution>
        className={platformTable}
        caption="Organizations"
        rows={data?.results}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        rowKey={(institution) => institution.id}
        onRowClick={(institution) => router.push(`/platform/organizations/${institution.id}`)}
        minWidth={1100}
        toolbar={
          <div className="space-y-4">
          <SectionTitle eyebrow="Directory" title="Organizations" description="Every organization on ErgonX, who administers it, and how far it has got with setup." meta={data ? `${data.count} organization${data.count === 1 ? "" : "s"}` : undefined} />
          <DataToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search name, code or email…"
            filters={
              <SegmentedControl<StatusFilter>
                label="Organization status"
                value={status}
                onChange={(value) => { setStatus(value); setPage(1); }}
                options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]}
              />
            }
          />
          </div>
        }
        empty={query || status
          ? { title: "No matching organizations", description: "Try a different search or status." }
          : { title: "No organizations yet", description: "Organizations appear here once an Institution Admin accepts an invitation.", icon: Building2 }}
        footer={data && data.count > DEFAULT_PAGE_SIZE ? <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={data.count} onPageChange={setPage} /> : undefined}
        columns={[
          {
            key: "name",
            header: "Organization",
            cell: (institution) => (
              <span className="flex items-center gap-3">
                <Avatar name={institution.name} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink-strong">{institution.name}</span>
                  <span className="block text-caption text-ink-muted">{institution.code} · {countryName(institution.country_code)}</span>
                </span>
              </span>
            ),
          },
          { key: "status", header: "Status", cell: (institution) => institution.is_active ? <Badge size="sm" tone="success">Active</Badge> : <Badge size="sm" tone="danger">Suspended</Badge> },
          {
            key: "admin",
            header: "Primary admin",
            hideBelow: "md",
            cell: (institution) => institution.primary_admin
              ? <span className="min-w-0"><span className="block truncate text-ink-strong">{institution.primary_admin.name}</span><span className="block truncate text-caption text-ink-muted">{institution.primary_admin.email}</span></span>
              : <span className="text-ink-subtle">No active admin</span>,
          },
          { key: "members", header: "Users", numeric: true, sortValue: (institution) => institution.member_count, cell: (institution) => institution.member_count.toLocaleString("en-GB") },
          { key: "employees", header: "Employees", numeric: true, hideBelow: "sm", sortValue: (institution) => institution.employee_count, cell: (institution) => institution.employee_count.toLocaleString("en-GB") },
          { key: "onboarding", header: "Setup", hideBelow: "lg", cell: (institution) => <Badge size="sm" tone={onboardingTone[institution.onboarding_status] ?? "neutral"}>{onboardingLabel[institution.onboarding_status] ?? institution.onboarding_status}</Badge> },
          { key: "activity", header: "Last sign-in", hideBelow: "lg", sortValue: (institution) => institution.last_sign_in_at ?? "", cell: (institution) => formatRelative(institution.last_sign_in_at) },
          { key: "created", header: "Joined", hideBelow: "xl", sortValue: (institution) => institution.created_at, cell: (institution) => formatDate(institution.created_at) },
        ]}
      />
    </>
  );
}
