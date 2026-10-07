"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { BarChart3, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, FileCheck2, FilePlus2, FileSignature, FileText, Layers, PieChart as PieChartIcon, Plus, Search, Share2, Timer, TrendingUp, UserPlus, UserRoundSearch, UsersRound } from "lucide-react";

import ChartCard from "@/components/charts/ChartCard";
import { BarsChart, DonutChart, TrendChart, donutLegend } from "@/components/charts/Charts";
import { FunnelChart, RankingBars } from "@/components/charts/Visuals";
import { ButtonLink } from "@/components/ui/Button";
import { ActionCard, Card, InsightCard, MetricCard, SummaryList } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { dashboardsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDate, formatNumber, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { useAccess } from "@/lib/access";
import type { RecruitmentBoardColumn } from "@/types/dashboards";

type Range = 3 | 6 | 12;

/**
 * Recruitment overview (concept "Recruitment"). KPIs, the pipeline board and
 * the analytics below are server-owned; the browser only filters the board
 * cards it was given and computes presentation ratios.
 */
export default function RecruitmentDashboardPage() {
  const { can } = useAccess();
  const [range, setRange] = useState<Range>(12);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const load = useCallback(() => dashboardsApi.getRecruitmentDashboard(range), [range]);
  const { data, loading, error, reload } = useApiResource(load);
  const initial = loading && !data;
  const value = (count: number | undefined) => (count === undefined ? EM_DASH : formatNumber(count));
  const pipelineTotal = data?.pipeline.reduce((sum, stage) => sum + stage.count, 0) ?? 0;
  const trend = data?.applications_trend ?? [];
  const interviewStatus = (data?.interviews_by_status ?? []).map((item) => ({ label: humanizeEnum(item.status), value: item.count }));
  const sources = (data?.applications_by_source ?? []).map((item) => ({ label: item.source, value: item.count }));
  const timeToHire = data?.time_to_hire ?? [];
  const chartError = !data && error ? "This data is unavailable right now." : null;
  const board = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.board ?? []).map((column) => {
      const cards = column.cards.filter((card) => (!role || card.job_posting_id === role) && (!needle || card.candidate.toLowerCase().includes(needle) || card.job_title.toLowerCase().includes(needle)));
      return { ...column, cards, count: needle || role ? cards.length : column.count };
    });
  }, [data, query, role]);
  const kpi = (count: number | undefined, hint: string) => (count ? hint : "No data available");
  const ratio = (numerator?: number, denominator?: number) => (numerator !== undefined && denominator ? `${Math.round((numerator / denominator) * 100)}%` : EM_DASH);
  const addHref = can("candidate.create") ? `/recruitment/candidates/new${role ? `?job_posting=${role}` : ""}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recruitment"
        description="Attract, assess and hire great talent."
        actions={
          <>
            <label className="relative">
              <span className="sr-only">Date range</span>
              <CalendarDays className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-section-icon" aria-hidden="true" />
              <select data-ui="select" value={range} onChange={(event) => setRange(Number(event.target.value) as Range)} className="h-12 appearance-none rounded-lg border border-line-strong bg-surface pl-11 pr-10 text-sm font-medium text-ink-strong">
                {[3, 6, 12].map((months) => <option key={months} value={months}>Last {months} months</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            </label>
            {can("job_posting.create") && <ButtonLink href="/recruitment/job-postings/new" size="lg" leadingIcon={<Plus className="h-5 w-5" />}>Create requisition</ButtonLink>}
            {can("candidate.create") && <ButtonLink href="/recruitment/candidates/new" size="lg" variant="secondary" leadingIcon={<UserPlus className="h-5 w-5" />}>Add candidate</ButtonLink>}
          </>
        }
      />

      {error && <ErrorState variant="inline" title="Unable to load recruitment dashboard" message={error} onRetry={reload} />}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Hiring indicators">
        <MetricCard label="Open roles" value={value(data?.open_roles)} description={data?.requisitions_pending_approval ? `${formatNumber(data.requisitions_pending_approval)} awaiting approval` : kpi(data?.open_roles, "Openings on published requisitions")} icon={BriefcaseBusiness} accent="brand" loading={initial} href="/recruitment/job-postings" />
        <MetricCard label="Candidates in process" value={value(data?.candidates_in_process)} description={kpi(data?.candidates_in_process, "Active or offered")} icon={UsersRound} accent="attendance" loading={initial} href="/recruitment/candidates" />
        <MetricCard label="Interviews this week" value={value(data?.interviews_this_week)} description={kpi(data?.interviews_this_week, "Scheduled Monday to Sunday")} icon={CalendarDays} accent="reports" loading={initial} href="/recruitment/interviews" />
        <MetricCard label="Offers pending" value={value(data?.offers_pending)} description={kpi(data?.offers_pending, "Drafted or extended")} icon={FileText} accent="leave" loading={initial} href="/recruitment/offers" />
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 sm:p-5" aria-labelledby="pipeline-title">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <BarChart3 className="mt-1 h-7 w-7 text-section-icon" aria-hidden="true" />
            <div>
              <h2 id="pipeline-title" className="text-[1.375rem] font-bold leading-8 text-headline">Recruitment pipeline</h2>
              <p className="text-support text-heading-support">Move candidates through stages from requisition to hire.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="relative min-w-[14rem] flex-1">
              <span className="sr-only">Search candidates</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search candidates" className="h-11 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" />
            </label>
            <label className="relative">
              <span className="sr-only">Role</span>
              <select data-ui="select" value={role} onChange={(event) => setRole(event.target.value)} className="h-11 w-48 appearance-none rounded-lg border border-line-strong bg-surface pl-3 pr-9 text-sm">
                <option value="">All roles</option>
                {(data?.job_options ?? []).map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            </label>
            {can("recruitment_stage.view") && <ButtonLink href="/recruitment/pipeline" variant="secondary" leadingIcon={<Layers className="h-4 w-4" />}>Move stages</ButtonLink>}
          </div>
        </div>
        <div className="mt-5 flex snap-x gap-3 overflow-x-auto pb-2">
          {initial
            ? [0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="skeleton h-96 w-60 shrink-0 rounded-xl" />)
            : board.map((column, index) => <BoardColumn key={column.key} column={column} index={index} total={board.length} addHref={addHref} />)}
        </div>
        {data?.range_start && <p className="mt-2 text-caption text-ink-muted">Applications created since {formatDate(data.range_start)}. Withdrawn and rejected applications are not shown.</p>}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Pipeline by stage" description="Applications grouped by the institution-defined recruitment stage, with stage-to-stage conversion." icon={Layers} accent="recruitment" accentLine>
          {initial ? (
            <div className="space-y-2">{[0, 1, 2, 3, 4].map((index) => <div key={index} className="skeleton h-8 rounded-lg" />)}</div>
          ) : data?.pipeline.length ? (
            <>
              <FunnelChart stages={data.pipeline.map((stage) => ({ label: stage.name, value: stage.count }))} />
              <p className="mt-4 text-caption text-ink-muted">{formatNumber(pipelineTotal)} applications across {formatNumber(data.pipeline.length)} stages. Percentages show conversion from the previous stage.</p>
            </>
          ) : (
            <p className="text-support text-ink-muted">No active pipeline stages are configured.</p>
          )}
        </Card>

        <div className="grid content-start gap-4">
          <InsightCard title="Interview reach" icon={CalendarDays} accent="recruitment">
            <p><span className="block text-kpi-sm font-semibold text-ink-strong tabular-nums">{ratio(data?.scheduled_interviews, data?.applications)}</span><span className="mt-1 block">Applications with a scheduled interview</span></p>
          </InsightCard>
          <InsightCard title="Offer rate" icon={FileCheck2} accent="accounting">
            <p><span className="block text-kpi-sm font-semibold text-ink-strong tabular-nums">{ratio(data?.offers_extended, data?.applications)}</span><span className="mt-1 block">Applications that reached an extended offer</span></p>
          </InsightCard>
          <InsightCard title="Load per opening" icon={ClipboardCheck} accent="hr">
            <p><span className="block text-kpi-sm font-semibold text-ink-strong tabular-nums">{data?.open_jobs ? formatNumber(Math.round((data.applications / data.open_jobs) * 10) / 10) : EM_DASH}</span><span className="mt-1 block">Applications per open job</span></p>
          </InsightCard>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-5">
        <ChartCard
          className="xl:col-span-3"
          title="Application intake"
          description="Applications received in each of the last six calendar months."
          accent="recruitment"
          icon={TrendingUp}
          loading={initial}
          error={chartError}
          empty={!trend.some((point) => point.applications > 0)}
          emptyDescription="New applications will appear here."
          data={{ columns: ["Month", "Applications"], rows: trend.map((point) => [point.month, point.applications]) }}
        >
          <TrendChart data={trend} xKey="month" height={250} series={[{ key: "applications", label: "Applications", color: "var(--mod-recruitment)" }]} />
        </ChartCard>
        <ChartCard
          className="xl:col-span-2"
          title="Interviews by status"
          description="Scheduled, completed, cancelled and no-show interviews."
          accent="recruitment"
          icon={PieChartIcon}
          loading={initial}
          error={chartError}
          empty={!interviewStatus.length}
          emptyDescription="Interviews will appear here once scheduled."
          data={{ columns: ["Status", "Interviews"], rows: interviewStatus.map((item) => [item.label, item.value]) }}
        >
          <DonutChart data={interviewStatus} height={180} centerValue={formatNumber(interviewStatus.reduce((sum, item) => sum + item.value, 0))} centerLabel="interviews" />
          <SummaryList className="mt-4" items={donutLegend(interviewStatus).map((item) => ({ label: <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: item.color }} />{item.label}</span>, value: item.value }))} />
        </ChartCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="Candidate sources"
          description="Where applications come from, by the candidate's recorded source."
          accent="recruitment"
          icon={Share2}
          loading={initial}
          error={chartError}
          empty={!sources.length}
          emptyDescription="Record a source on candidates to see where applicants come from."
          data={{ columns: ["Source", "Applications"], rows: sources.map((item) => [item.label, item.value]) }}
        >
          <RankingBars items={sources} color="var(--mod-recruitment)" limit={6} />
        </ChartCard>
        <ChartCard
          title="Time to hire"
          description="Days from application to accepted offer."
          accent="recruitment"
          icon={Timer}
          loading={initial}
          error={chartError}
          empty={!timeToHire.some((bucket) => bucket.hires > 0)}
          emptyDescription="Accepted offers will appear here."
          data={{ columns: ["Days to hire", "Hires"], rows: timeToHire.map((bucket) => [bucket.bucket, bucket.hires]) }}
        >
          <BarsChart data={timeToHire} xKey="bucket" height={230} series={[{ key: "hires", label: "Hires", color: "var(--mod-recruitment)" }]} />
        </ChartCard>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Recruitment areas">
        {can("candidate.view") && <ActionCard href="/recruitment/applications" title="Applications" description="Review and progress applicants" icon={FileCheck2} accent="recruitment" />}
        {can("recruitment_stage.view") && <ActionCard href="/recruitment/pipeline" title="Pipeline board" description="Move candidates between stages" icon={Layers} accent="recruitment" />}
        {can("interview.view") && <ActionCard href="/recruitment/interviews" title="Interviews" description="Schedule and record outcomes" icon={CalendarDays} accent="recruitment" />}
        {can("offer.view") && <ActionCard href="/recruitment/offers" title="Offers" description="Draft, extend and track offers" icon={FileSignature} accent="recruitment" />}
      </section>
    </div>
  );
}

const COLUMN_DOTS = ["bg-primary", "bg-mod-leave", "bg-mod-recruitment", "bg-mod-payroll", "bg-mod-attendance", "bg-mod-audit"];
const EMPTY_COPY: Record<string, { icon: typeof FilePlus2; text: string }> = {
  draft: { icon: FilePlus2, text: "Candidates in draft will appear here when they are added to a requisition." },
  hired: { icon: UsersRound, text: "Successfully hired candidates will appear here." },
};

function BoardColumn({ column, index, total, addHref }: { column: RecruitmentBoardColumn; index: number; total: number; addHref: string | null }) {
  const dot = column.key === "draft" ? "bg-ink-subtle" : column.key === "hired" ? "bg-success" : COLUMN_DOTS[(index - 1) % COLUMN_DOTS.length];
  const empty = EMPTY_COPY[column.key] ?? { icon: index === total - 2 ? FileText : UserRoundSearch, text: `Candidates at the ${column.label.toLowerCase()} stage will appear here.` };
  const EmptyIcon = empty.icon;
  return (
    <div className="flex w-60 shrink-0 snap-start flex-col rounded-xl border border-line bg-surface-muted/40">
      <div className="flex items-center justify-between rounded-t-xl border-b border-line-soft bg-surface px-3 py-3">
        <span className="flex items-center gap-2 font-bold text-ink-strong"><span aria-hidden="true" className={cx("h-3 w-3 rounded-full", dot)} />{column.label}<ChevronRight className="h-4 w-4 text-ink-muted" aria-hidden="true" /></span>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-caption font-semibold tabular-nums text-ink-muted">{column.count}</span>
      </div>
      <div className="flex min-h-[20rem] flex-1 flex-col gap-2 p-2">
        {column.cards.length ? column.cards.map((card) => (
          <Link key={card.id} href={`/recruitment/candidates/${card.candidate_id}?application=${card.id}`} className="rounded-lg border border-line bg-surface p-3 shadow-elevation-1 transition hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary">
            <p className="font-semibold text-ink-strong">{card.candidate}</p>
            <p className="mt-0.5 truncate text-caption text-ink-muted">{card.job_title}</p>
            <p className="mt-2 flex items-center justify-between text-caption text-ink-muted"><span>{card.applied_at ? formatDate(card.applied_at) : "Not submitted"}</span>{card.status === "OFFERED" && <span className="font-semibold text-warning-ink">Offer</span>}</p>
          </Link>
        )) : (
          <div className="m-auto flex flex-col items-center px-2 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft/60 text-section-icon"><EmptyIcon className="h-7 w-7" aria-hidden="true" /></span>
            <p className="mt-3 font-bold text-ink-strong">No candidates</p>
            <p className="mt-1 text-caption text-heading-support">{empty.text}</p>
          </div>
        )}
      </div>
      {addHref && column.key !== "hired" && (
        <div className="p-2 pt-0"><Link href={addHref} className="flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface text-sm font-semibold text-primary-ink hover:bg-primary-soft/50"><Plus className="h-4 w-4" aria-hidden="true" />Add candidate</Link></div>
      )}
    </div>
  );
}
