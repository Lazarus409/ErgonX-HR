"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { BarChart3, CheckCircle2, Lock, Rocket, Star, Target, Users } from "lucide-react";

import Alert from "@/components/ui/Alert";
import BackNavigation from "@/components/ui/BackNavigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, MetricCard } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Checkbox, Field, Select } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, organizationApi, performanceApi } from "@/lib/api";
import { CYCLE_STATUS_LABELS, CYCLE_STATUS_TONES, RATING_LABELS, REVIEW_STATUS_LABELS, REVIEW_STATUS_TONES, type ReviewListItem, type ReviewStatus } from "@/lib/api/performance";
import { useAccess } from "@/lib/access";
import { formatDate, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

const ALL = "ALL";

/** One review cycle: progress, rating spread and every review in it. */
export default function ReviewCyclePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAccess();
  const canManage = can("performance.manage");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [pageError, setPageError] = useState("");

  const load = useCallback(() => Promise.all([performanceApi.getCycle(params.id), performanceApi.getCycleSummary(params.id), performanceApi.listReviews({ cycle: params.id })]), [params.id]);
  const { data, loading, error, reload } = useApiResource(load);
  const cycle = data?.[0];
  const summary = data?.[1];
  const reviews = useMemo(() => data?.[2].results ?? [], [data]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return reviews.filter((row) => (status === ALL || row.status === status) && (!query || row.employee_name.toLowerCase().includes(query) || row.employee_number.toLowerCase().includes(query) || row.reviewer_name.toLowerCase().includes(query)));
  }, [reviews, search, status]);
  const initial = loading && !data;
  const maxCount = Math.max(1, ...(summary?.rating_distribution.map((row) => row.count) ?? [1]));

  // Launch
  const [launchOpen, setLaunchOpen] = useState(false);
  const [everyone, setEveryone] = useState(true);
  const [departments, setDepartments] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const loadDepartments = useCallback(() => (launchOpen ? organizationApi.listDepartments({ is_active: true, page_size: 200, ordering: "name" }) : Promise.resolve(null)), [launchOpen]);
  const { data: departmentPage } = useApiResource(loadDepartments);
  const launch = async () => {
    if (!everyone && !departments.length) { setLaunchError("Choose at least one department, or include everyone."); return; }
    setSaving(true);
    setLaunchError("");
    try { await performanceApi.launchCycle(params.id, everyone ? { all_active: true } : { departments }); setLaunchOpen(false); reload(); }
    catch (caught) { setLaunchError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const [closing, setClosing] = useState(false);
  const close = async () => {
    setSaving(true);
    try { await performanceApi.closeCycle(params.id); setClosing(false); reload(); }
    catch (caught) { setPageError(getApiErrorMessage(caught)); setClosing(false); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <BackNavigation fallback="/performance" label="Performance" />
      <PageHeader
        eyebrow="Performance"
        title={cycle?.name ?? "Review cycle"}
        description={cycle ? `${formatDate(cycle.period_start)} – ${formatDate(cycle.period_end)}${cycle.self_assessment_due ? ` · self-assessments due ${formatDate(cycle.self_assessment_due)}` : ""}${cycle.manager_review_due ? ` · manager reviews due ${formatDate(cycle.manager_review_due)}` : ""}` : undefined}
        icon={Target}
        accent="hr"
        meta={cycle ? <Badge tone={CYCLE_STATUS_TONES[cycle.status]}>{CYCLE_STATUS_LABELS[cycle.status]}</Badge> : undefined}
        actions={canManage && cycle ? (cycle.status === "DRAFT" ? <Button leadingIcon={<Rocket className="h-4 w-4" />} onClick={() => { setLaunchError(""); setLaunchOpen(true); }}>Launch cycle</Button> : cycle.status === "ACTIVE" ? <Button variant="secondary" leadingIcon={<Lock className="h-4 w-4" />} onClick={() => setClosing(true)}>Close cycle</Button> : null) : null}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {pageError && <Alert tone="danger" onDismiss={() => setPageError("")}>{pageError}</Alert>}

      {cycle?.status === "DRAFT" ? (
        <Card title="Ready to launch" icon={Rocket} accent="hr">
          <p className="text-support text-ink-muted">Launching opens a review for each participant, rated on: <span className="font-semibold text-ink-strong">{cycle.competency_names.join(", ")}</span>. Each employee is notified to complete their self-assessment; their reviewer is taken from their reporting line.</p>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Cycle progress">
            <MetricCard label="Reviews" value={summary ? formatNumber(summary.total) : "—"} icon={Users} accent="hr" loading={initial} />
            <MetricCard label="Completed" value={summary ? `${summary.completion_rate.toFixed(0)}%` : "—"} description={summary ? `${formatNumber(summary.by_status.COMPLETED)} signed off` : undefined} icon={CheckCircle2} accent="attendance" loading={initial} />
            <MetricCard label="Awaiting managers" value={summary ? formatNumber(summary.by_status.MANAGER_REVIEW) : "—"} description={summary ? `${formatNumber(summary.by_status.SELF_ASSESSMENT)} self-assessments open` : undefined} icon={BarChart3} accent="leave" loading={initial} />
            <MetricCard label="Average rating" value={summary?.average_rating ? summary.average_rating.toFixed(1) : "—"} description={summary?.average_rating ? RATING_LABELS[Math.round(summary.average_rating)] : "Shown once reviews are signed off"} icon={Star} accent="audit" loading={initial} />
          </section>
          {summary && summary.by_status.COMPLETED > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Rating distribution" description="Overall ratings of signed-off reviews." icon={BarChart3} accent="hr">
                <ul className="space-y-2">
                  {[...summary.rating_distribution].reverse().map((row) => (
                    <li key={row.rating} className="grid grid-cols-[minmax(0,11rem)_1fr_2.5rem] items-center gap-3 text-caption">
                      <span className="text-ink">{row.rating} · {row.label}</span>
                      <span className="h-3 rounded-sm bg-surface-muted"><span className="block h-full rounded-sm bg-primary" style={{ width: `${(row.count / maxCount) * 100}%` }} /></span>
                      <span className="text-right font-semibold tabular-nums text-ink-strong">{row.count}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Average by department" icon={Users} accent="hr">
                <ul className="divide-y divide-line-soft">
                  {summary.by_department.map((row) => (
                    <li key={row.department} className="flex items-center justify-between py-2 text-support">
                      <span className="text-ink">{row.department}</span>
                      <span className="font-semibold tabular-nums text-ink-strong">{row.average_rating.toFixed(1)} <span className="text-caption font-normal text-ink-muted">({row.reviews})</span></span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
          <DataTable<ReviewListItem>
            caption="Reviews in this cycle"
            rows={rows}
            rowKey={(row) => row.id}
            loading={initial}
            minWidth={760}
            onRowClick={(row) => router.push(`/reviews/${row.id}`)}
            toolbar={<DataToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search employee or reviewer…" filters={<Select size="sm" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value={ALL}>All statuses</option>{(Object.keys(REVIEW_STATUS_LABELS) as ReviewStatus[]).map((value) => <option key={value} value={value}>{REVIEW_STATUS_LABELS[value]}</option>)}</Select>} onClear={search || status !== ALL ? () => { setSearch(""); setStatus(ALL); } : undefined} />}
            empty={{ title: "No reviews found", icon: Target }}
            columns={[
              { key: "employee", header: "Employee", sortValue: (row) => row.employee_name, cell: (row) => <span><span className="block font-semibold text-ink-strong">{row.employee_name}</span><span className="text-caption text-ink-muted">{row.employee_number}</span></span> },
              { key: "reviewer", header: "Reviewer", sortValue: (row) => row.reviewer_name, cell: (row) => row.reviewer_name || <Badge size="sm" tone="warning">Not assigned</Badge> },
              { key: "status", header: "Stage", cell: (row) => <Badge size="sm" tone={REVIEW_STATUS_TONES[row.status]}>{REVIEW_STATUS_LABELS[row.status]}</Badge> },
              { key: "rating", header: "Overall", sortValue: (row) => row.overall_rating ?? 0, cell: (row) => row.overall_rating ? <span><span className="font-semibold text-ink-strong">{row.overall_rating}</span> <span className="text-caption text-ink-muted">{RATING_LABELS[row.overall_rating]}</span></span> : <span className="text-ink-subtle">—</span> },
            ]}
          />
        </>
      )}

      <Dialog open={launchOpen} onClose={() => setLaunchOpen(false)} dismissible={!saving} title="Launch review cycle" description="A review opens for each active employee you include." footer={<><Button variant="secondary" onClick={() => setLaunchOpen(false)} disabled={saving}>Cancel</Button><Button leadingIcon={<Rocket className="h-4 w-4" />} onClick={() => void launch()} loading={saving}>Launch</Button></>}>
        <div className="space-y-4">
          {launchError && <Alert tone="danger">{launchError}</Alert>}
          <Checkbox label="Include every active employee" checked={everyone} onChange={(event) => setEveryone(event.target.checked)} />
          {!everyone && (
            <Field label="Departments">
              <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{(departmentPage?.results ?? []).map((department) => <Checkbox key={department.id} label={department.name} checked={departments.includes(department.id)} onChange={() => setDepartments((current) => current.includes(department.id) ? current.filter((id) => id !== department.id) : [...current, department.id])} />)}</div>
            </Field>
          )}
        </div>
      </Dialog>
      <ConfirmDialog open={closing} title="Close review cycle" description="Closing stops any further changes. Reviews not yet signed off stay as they are." confirmLabel="Close cycle" loading={saving} onCancel={() => setClosing(false)} onConfirm={() => void close()} />
    </div>
  );
}
