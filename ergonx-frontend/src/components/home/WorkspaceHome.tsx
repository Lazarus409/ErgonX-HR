"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Coins,
  FileCheck2,
  FilePlus2,
  FileText,
  History,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";

import HomeHero, { HeroStat } from "@/components/home/HomeHero";
import { AttentionItem, Card, IconTile, SectionHeading } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Sparkline } from "@/components/charts/Visuals";
import { dashboardsApi, homeApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { useApiResource } from "@/lib/useApiResource";
import { formatAmount, formatNumber, humanizeEnum } from "@/lib/format";
import { cx } from "@/lib/cx";
import { moduleAccents, type ModuleAccent } from "@/lib/moduleTheme";
import type { TeamSnapshot } from "@/types/dashboards";
import type { HomeQuickAction } from "@/types/home";

interface WorkspaceHomeProps {
  areaLabel: string;
  continueHref?: string;
  continueTitle?: string;
  continueDescription?: string;
  showGreeting?: boolean;
}

const actionVisuals: Record<string, { icon: LucideIcon; accent: ModuleAccent }> = {
  "employee.create": { icon: UserPlus, accent: "hr" },
  "leave.request": { icon: CalendarPlus, accent: "leave" },
  "leave.approve": { icon: CalendarCheck, accent: "leave" },
  "attendance.adjust": { icon: Clock3, accent: "attendance" },
  "payroll.prepare": { icon: Calculator, accent: "payroll" },
  "payroll.approve": { icon: BadgeCheck, accent: "payroll" },
  "payroll.adjustment": { icon: SlidersHorizontal, accent: "payroll" },
  "payroll.adjustment.review": { icon: ClipboardCheck, accent: "payroll" },
  "compensation.change": { icon: Coins, accent: "payroll" },
  "journal.create": { icon: FilePlus2, accent: "accounting" },
  "journal.approve": { icon: FileCheck2, accent: "accounting" },
  "candidate.create": { icon: Users, accent: "recruitment" },
  "application.submit": { icon: FileText, accent: "recruitment" },
  "interview.update": { icon: CalendarClock, accent: "recruitment" },
  "offer.manage": { icon: Briefcase, accent: "recruitment" },
};

function visualFor(action: Pick<HomeQuickAction, "code">) {
  return actionVisuals[action.code] ?? { icon: Zap, accent: "brand" as ModuleAccent };
}

function formatRelativeTime(value: string): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  if (elapsedMinutes < 1440) return `${Math.round(elapsedMinutes / 60)}h ago`;
  return `${Math.round(elapsedMinutes / 1440)}d ago`;
}

/** Institution-local date line from the server-provided timezone. */
function institutionDateLine(localTime?: string, timeZone?: string): string | undefined {
  if (!localTime) return undefined;
  const parsed = new Date(localTime);
  if (Number.isNaN(parsed.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone }).format(parsed);
  } catch {
    return parsed.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }
}

export default function WorkspaceHome({ areaLabel, continueHref, continueTitle, continueDescription, showGreeting = false }: WorkspaceHomeProps) {
  const { user, institution, selfServiceEligible } = useAccess();
  const load = useCallback(() => homeApi.getHome(), []);
  const { data, loading, error, reload } = useApiResource(load);

  const greeting = data?.greeting_context.greeting ?? `Welcome, ${user?.firstName ?? "there"}`;
  const actionByCode = new Map(data?.quick_actions.map((action) => [action.code, action]));
  const attentionCount = data?.attention_items.length ?? 0;
  const resume = data?.recent_work.find((item) => item.can_resume && (item.resume_route || actionByCode.get(item.resume_action)?.route_hint));
  const resumeHref = resume ? resume.resume_route || actionByCode.get(resume.resume_action)?.route_hint : continueHref;
  const dateLine = institutionDateLine(data?.greeting_context.local_time, data?.greeting_context.institution_timezone);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <HomeHero
        eyebrow={dateLine ?? areaLabel}
        title={showGreeting ? (loading && !data ? <Skeleton className="h-10 w-72" /> : `${greeting}.`) : "Continue your work."}
        subtitle={showGreeting ? `Here's what needs you today at ${data?.greeting_context.institution_name ?? institution?.name ?? "your institution"}.` : "Use your permitted actions and current operational work below."}
        aside={
          resumeHref ? (
            <Link href={resumeHref} className="group block rounded-2xl border border-primary/15 bg-primary-soft/70 p-5 transition-colors hover:border-primary/40">
              <p className="flex items-center gap-1.5 text-caption font-semibold text-primary-ink"><History className="h-3.5 w-3.5" aria-hidden="true" />Continue where you left off</p>
              <p className="mt-2 font-semibold text-ink-strong">{resume?.title ?? continueTitle}</p>
              <p className="mt-0.5 text-support text-ink-muted">{resume ? `Updated ${formatRelativeTime(resume.updated_at)}` : continueDescription}</p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-support font-semibold text-ink-strong">Resume<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
            </Link>
          ) : undefined
        }
      >
        <div className="grid max-w-xl grid-cols-3 gap-3">
          <HeroStat label="Need attention" value={data ? formatNumber(attentionCount) : "–"} tone={attentionCount ? "attention" : "default"} />
          <HeroStat label="Unread updates" value={data ? formatNumber(data.notifications_summary.unread_count) : "–"} />
          <HeroStat label="Quick actions" value={data ? formatNumber(data.quick_actions.length) : "–"} />
        </div>
      </HomeHero>

      {error && <ErrorState variant="inline" title="Unable to load your workspace" message={error} onRetry={reload} />}

      {data?.team_snapshot && <TeamToday snapshot={data.team_snapshot} />}

      {/* Quick actions */}
      <section aria-labelledby="quick-actions-heading" className="space-y-4">
        <SectionHeading title={<span id="quick-actions-heading">Quick actions</span>} description="Your permitted actions, ordered by what you pin and use most." />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {loading && !data && Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[76px] rounded-2xl" />)}
          {data?.quick_actions.map((action) => {
            const visual = visualFor(action);
            return (
              <Link key={action.code} href={action.route_hint} className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 transition-[box-shadow,transform,border-color] duration-200 ease-standard hover:-translate-y-0.5 hover:border-line-strong hover:shadow-elevation-2">
                <IconTile icon={visual.icon} accent={visual.accent} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-strong">{action.label}</span>
                  <span className="mt-0.5 block truncate text-caption text-ink-muted">{action.is_pinned ? "Pinned" : "Available to your role"}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink-strong" aria-hidden="true" />
              </Link>
            );
          })}
          {!loading && data?.quick_actions.length === 0 && (
            <p className="rounded-2xl border border-dashed border-line-strong bg-surface p-5 text-support text-ink-muted sm:col-span-2 xl:col-span-3">No quick actions are available for your current role.</p>
          )}
        </div>
      </section>

      {/* Attention + updates */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card title="Needs your attention" description="Approvals and time-sensitive work in your queue." icon={CheckCircle2} accent="brand" padding="md">
          {loading && !data ? (
            <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-14 rounded-xl" />)}</div>
          ) : !data ? (
            <p className="text-support text-ink-muted">Attention items are unavailable right now.</p>
          ) : attentionCount ? (
            <div className="-mx-3 -mb-2 space-y-1">
              {data!.attention_items.map((item) => (
                <AttentionItem key={item.code} title={item.title} description={item.description} severity={item.severity === "NORMAL" ? "info" : item.severity} href={actionByCode.get(item.action_code)?.route_hint} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-success-soft p-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              <div><p className="text-sm font-semibold text-ink-strong">You&apos;re all clear</p><p className="text-support text-ink-muted">Nothing is waiting on you right now.</p></div>
            </div>
          )}
        </Card>

        <Card title="Latest updates" description="Unread notifications for this institution." icon={Bell} accent="brand" actions={<Link href="/notifications" className="text-support font-semibold text-primary-ink hover:underline">View all</Link>}>
          {loading && !data ? (
            <div className="space-y-3">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-12 rounded-xl" />)}</div>
          ) : !data ? (
            <p className="text-support text-ink-muted">Updates are unavailable right now.</p>
          ) : data.notifications_summary.latest.length ? (
            <ul className="divide-y divide-line-soft">
              {data.notifications_summary.latest.map((note) => (
                <li key={note.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-strong">{note.title}</p>
                    <p className="line-clamp-2 text-support text-ink-muted">{note.message}</p>
                    <p className="mt-0.5 text-caption text-ink-subtle">{formatRelativeTime(note.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-support text-ink-muted">No unread updates. You&apos;re up to date.</p>
          )}
        </Card>
      </div>

      <OperationalSnapshot />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Continue your work" description="Records you recently worked on." icon={History} accent="brand">
          {loading && !data ? (
            <div className="space-y-3">{[0, 1].map((index) => <Skeleton key={index} className="h-12 rounded-xl" />)}</div>
          ) : !data ? (
            <p className="text-support text-ink-muted">Recent work is unavailable right now.</p>
          ) : data.recent_work.length ? (
            <ul className="-mx-2 space-y-1">
              {data.recent_work.map((item) => {
                const action = actionByCode.get(item.resume_action);
                const href = item.can_resume ? item.resume_route || action?.route_hint : undefined;
                const visual = visualFor({ code: item.resume_action });
                const body = (
                  <span className="flex items-center gap-3">
                    <IconTile icon={visual.icon} accent={visual.accent} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-strong">{item.title}</span>
                      <span className="block text-caption text-ink-muted">{humanizeEnum(item.type)} · {formatRelativeTime(item.updated_at)}</span>
                    </span>
                    {href && <ArrowRight className="h-4 w-4 text-ink-subtle" aria-hidden="true" />}
                  </span>
                );
                return <li key={`${item.type}-${item.id}`}>{href ? <Link href={href} className="block rounded-xl p-2 transition-colors hover:bg-surface-hover">{body}</Link> : <div className="p-2">{body}</div>}</li>;
              })}
            </ul>
          ) : (
            <p className="text-support text-ink-muted">Work you start in ErgonX will appear here so you can pick it up again.</p>
          )}
        </Card>

        {selfServiceEligible ? (
          <Link href="/me" className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2">
            <span aria-hidden="true" className="bg-signature absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-15 blur-2xl" />
            <div className="relative flex items-start gap-3">
              <IconTile icon={UserRound} accent="brand" />
              <div>
                <h2 className="text-card-title font-bold text-headline">Your personal workspace</h2>
                <p className="mt-0.5 text-support text-ink-muted">Your attendance, leave balances and documents in one place.</p>
              </div>
            </div>
            <span className="relative mt-6 inline-flex items-center gap-1.5 text-support font-semibold text-primary-ink">Open Employee Home<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></span>
          </Link>
        ) : (
          <Card title="Tip" icon={Sparkles} accent="brand">
            <p className="text-support text-ink-muted">Press <kbd className="rounded-md border border-line bg-surface-muted px-1.5 py-0.5 text-caption font-semibold">Ctrl K</kbd> anywhere to search people, candidates and leave requests.</p>
          </Card>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Team today (department heads)                                               */
/* -------------------------------------------------------------------------- */

function TeamToday({ snapshot }: { snapshot: TeamSnapshot }) {
  const { today } = snapshot;
  const tiles = [
    { label: "In today", value: today.present + today.remote, tone: "text-success-ink" },
    { label: "Late", value: today.late, tone: today.late ? "text-warning-ink" : "text-ink-strong" },
    { label: "Absent", value: today.absent, tone: today.absent ? "text-danger-ink" : "text-ink-strong" },
    { label: "On leave", value: today.on_leave, tone: "text-ink-strong" },
    { label: "Not recorded", value: today.not_recorded, tone: "text-ink-muted" },
  ];
  return (
    <section aria-labelledby="team-today-heading" className="space-y-4">
      <SectionHeading
        title={<span id="team-today-heading">Team today</span>}
        description={`${snapshot.departments.join(", ")} · ${formatNumber(snapshot.headcount)} people`}
        actions={<Link href="/department" className="inline-flex items-center gap-1.5 text-support font-semibold text-primary-ink hover:underline">Open my department<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}
      />
      <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
        <Card>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {tiles.map((tile) => (
              <div key={tile.label}>
                <dt className="text-caption text-ink-muted">{tile.label}</dt>
                <dd className={cx("mt-1 text-2xl font-semibold tabular-nums", tile.tone)}>{formatNumber(tile.value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Link href="/department/approvals" className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 transition-colors hover:bg-surface-hover">
          <IconTile icon={ClipboardCheck} accent="leave" />
          <span>
            <span className="block text-2xl font-semibold tabular-nums text-ink-strong">{formatNumber(snapshot.pending_approvals)}</span>
            <span className="block text-support text-ink-muted">Leave request{snapshot.pending_approvals === 1 ? "" : "s"} awaiting you</span>
          </span>
        </Link>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Weekly operational snapshot                                                 */
/* -------------------------------------------------------------------------- */

interface SnapshotTile {
  key: string;
  accent: ModuleAccent;
  label: string;
  value: string;
  detail: string;
  href: string;
  spark?: number[];
}

/**
 * Compact operational pulse assembled only from dashboard rollups the user is
 * already permitted to read (module enabled + dashboard permission). Tiles for
 * unavailable modules are never requested or rendered.
 */
function OperationalSnapshot() {
  const { can, moduleEnabled } = useAccess();
  const [tiles, setTiles] = useState<SnapshotTile[] | null>(null);
  const plan = {
    attendance: moduleEnabled("ATTENDANCE") && can("dashboard.attendance.view"),
    leave: moduleEnabled("LEAVE") && can("dashboard.leave.view"),
    payroll: moduleEnabled("PAYROLL") && can("dashboard.payroll.view"),
    recruitment: moduleEnabled("RECRUITMENT") && can("dashboard.recruitment.view"),
    finance: moduleEnabled("ACCOUNTING") && can("dashboard.finance.view"),
    hr: moduleEnabled("HR") && can("dashboard.hr.view"),
  };
  const planKey = Object.entries(plan).filter(([, enabled]) => enabled).map(([key]) => key).join(",");

  useEffect(() => {
    if (!planKey) return;
    const wanted = new Set(planKey.split(","));
    let active = true;
    const requests: Array<Promise<SnapshotTile | null>> = [];
    if (wanted.has("hr")) requests.push(dashboardsApi.getHrDashboard().then((d) => ({ key: "hr", accent: "hr", label: "Active employees", value: formatNumber(d.active_employees), detail: `${formatNumber(d.recent_hires.length)} recent hires`, href: "/hr/dashboard" })));
    if (wanted.has("attendance")) requests.push(dashboardsApi.getAttendanceDashboard().then((d) => ({ key: "attendance", accent: "attendance", label: "Present today", value: formatNumber(d.present), detail: `${formatNumber(d.late)} late · ${formatNumber(d.absent)} absent`, href: "/attendance/dashboard", spark: d.weekly_attendance.map((day) => day.present) })));
    if (wanted.has("leave")) requests.push(dashboardsApi.getLeaveDashboard().then((d) => ({ key: "leave", accent: "leave", label: "Leave awaiting decision", value: formatNumber(d.pending), detail: `${formatNumber(d.currently_on_leave)} on leave · ${formatNumber(d.upcoming)} upcoming`, href: "/leave/dashboard", spark: d.monthly_approved_leave.map((month) => Number(month.requested_days)) })));
    if (wanted.has("payroll")) requests.push(dashboardsApi.getPayrollDashboard().then((d) => ({ key: "payroll", accent: "payroll", label: "Payroll runs in progress", value: formatNumber(d.pending_runs), detail: d.latest_run_status ? `Latest run: ${humanizeEnum(d.latest_run_status)}` : "No payroll runs yet", href: "/payroll/dashboard", spark: d.payroll_by_period.map((period) => Number(period.gross_pay)) })));
    if (wanted.has("recruitment")) requests.push(dashboardsApi.getRecruitmentDashboard().then((d) => ({ key: "recruitment", accent: "recruitment", label: "Interviews scheduled", value: formatNumber(d.scheduled_interviews), detail: `${formatNumber(d.open_jobs)} open roles · ${formatNumber(d.applications)} applications`, href: "/recruitment/dashboard" })));
    if (wanted.has("finance")) requests.push(dashboardsApi.getFinanceDashboard().then((d) => ({ key: "finance", accent: "accounting", label: "Journals pending", value: formatNumber(d.pending_journals), detail: `Bank balance ${formatAmount(d.bank_balance, d.currency)}`, href: "/accounting/dashboard", spark: d.cash_flow_trend.map((month) => Number(month.net_movement)) })));
    Promise.allSettled(requests).then((results) => {
      if (!active) return;
      setTiles(results.flatMap((result) => (result.status === "fulfilled" && result.value ? [result.value] : [])).slice(0, 4));
    });
    return () => { active = false; };
  }, [planKey]);

  if (!planKey) return null;

  return (
    <section aria-labelledby="snapshot-heading" className="space-y-4">
      <SectionHeading title={<span id="snapshot-heading">Operational snapshot</span>} description="A quick pulse from the areas you oversee." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles === null
          ? Array.from({ length: Math.min(planKey.split(",").length, 4) }, (_, index) => <Skeleton key={index} className="h-36 rounded-2xl" />)
          : tiles.map((tile) => (
              <Link key={tile.key} href={tile.href} className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2">
                <p className="text-support font-medium text-ink-muted">{tile.label}</p>
                <p className="mt-2 text-kpi font-semibold tracking-tight text-ink-strong tabular-nums">{tile.value}</p>
                <p className="mt-1 truncate text-caption text-ink-muted">{tile.detail}</p>
                {tile.spark && tile.spark.length > 1 && <div className="mt-3"><Sparkline values={tile.spark} color={moduleAccents[tile.accent].cssVar} height={32} label={`${tile.label} trend`} /></div>}
              </Link>
            ))}
        {tiles?.length === 0 && <p className="text-support text-ink-muted sm:col-span-2 xl:col-span-4">Snapshot data is not available right now.</p>}
      </div>
    </section>
  );
}
