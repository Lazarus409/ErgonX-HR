"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock3,
  Download,
  FileSignature,
  FileText,
  GraduationCap,
  Info,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Send,
  Trash2,
  Upload,
  UserRound,
  XCircle,
} from "lucide-react";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import {
  CANDIDATE_DOCUMENT_TYPES,
  COMPETENCY_RATINGS,
  EMPLOYMENT_STATUSES,
  QUALIFICATIONS,
  type ApplicationOverview,
  type ApplicationScorecard,
  type Candidate,
  type CandidateDocument,
} from "@/types/recruitment";

type Tab = "overview" | "scorecard" | "interviews" | "documents" | "activity";

const ACTIVITY_LABELS: Record<string, string> = {
  "recruitment.application.submitted": "Application submitted",
  "recruitment.application.stage_moved": "Moved to a new stage",
  "recruitment.application.withdrawn": "Application withdrawn",
  "recruitment.application.rejected": "Application rejected",
  "recruitment.application.scorecard_submitted": "Evaluation submitted",
  "recruitment.candidate.document_added": "Document added",
  "recruitment.candidate.document_removed": "Document removed",
  "recruitment.interview.status_changed": "Interview updated",
  "recruitment.offer.extended": "Offer extended",
};
const RATING_DOT: Record<string, string> = { NOT_ASSESSED: "bg-ink-subtle", DOES_NOT_MEET: "bg-danger", PARTIALLY_MEETS: "bg-warning", MEETS: "bg-success", EXCEEDS: "bg-primary" };
const choice = (options: Array<[string, string]>, value?: string | null) => options.find(([key]) => key === value)?.[1] ?? (value ? humanizeEnum(value) : EM_DASH);

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Concept "Candidate detail" (option 3), one application at a time. */
export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const load = useCallback(async () => {
    const [candidate, applications] = await Promise.all([
      recruitmentApi.getCandidate(id),
      recruitmentApi.listApplications({ candidate: id, ordering: "-created_at", page_size: 50 }),
    ]);
    return { candidate, applications: applications.results };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [selected, setSelected] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("application")));

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Candidate not found."} onRetry={reload} />;
  const applicationId = data.applications.find((item) => item.id === selected)?.id ?? data.applications[0]?.id ?? null;
  if (!applicationId) return <ProfileOnly candidate={data.candidate} />;
  return (
    <ApplicationView
      key={applicationId}
      candidateId={id}
      applicationId={applicationId}
      onSwitch={(next) => { setSelected(next); router.replace(`/recruitment/candidates/${id}?application=${next}`); }}
    />
  );
}

function ApplicationView({ candidateId, applicationId, onSwitch }: { candidateId: string; applicationId: string; onSwitch: (id: string) => void }) {
  const { can } = useAccess();
  const router = useRouter();
  const load = useCallback(async () => {
    const [overview, scorecard] = await Promise.all([
      recruitmentApi.getApplicationOverview(applicationId),
      recruitmentApi.getApplicationScorecard(applicationId).catch(() => null),
    ]);
    return { overview, scorecard };
  }, [applicationId]);
  const { data, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<"next" | "move" | "reject" | "withdraw" | "submit" | null>(null);
  const [comment, setComment] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Application not found."} onRetry={reload} />;
  const { overview, scorecard } = data;
  const { application, candidate, job, stages, actions } = overview;
  const status = application.status;
  const inProcess = status === "ACTIVE" || status === "OFFERED";
  const statusLabel = status === "ACTIVE" ? "In process" : humanizeEnum(status);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      setDialog(null);
      setComment("");
      reload();
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };
  // Draft, the institution's active stages, then Hired.
  const steps = [{ id: "draft", name: "Draft" }, ...stages.map((stage) => ({ id: stage.id, name: stage.name })), { id: "hired", name: "Hired" }];
  const currentIndex = status === "DRAFT" ? 0 : status === "HIRED" ? steps.length - 1 : Math.max(1, steps.findIndex((step) => step.id === application.current_stage));
  const documents = overview.documents;
  const allFeedback = [...overview.interviews.flatMap((item) => item.feedback.map((row) => ({ ...row, context: `${item.interview_type || "Interview"} · ${formatDate(item.scheduled_at)}` }))), ...overview.general_feedback.map((row) => ({ ...row, context: "General evaluation" }))];

  return (
    <div className="space-y-5">
      <Link href="/recruitment/candidates" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to candidates</Link>

      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <Avatar name={candidate.full_name || `${candidate.first_name} ${candidate.last_name}`} size="lg" className="!h-[4.5rem] !w-[4.5rem] !text-[1.5rem]" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline">{candidate.full_name || `${candidate.first_name} ${candidate.last_name}`}</h1>
              <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", inProcess ? "bg-success-soft text-success-ink" : status === "HIRED" ? "bg-primary-soft text-primary-ink" : status === "DRAFT" ? "bg-surface-muted text-ink-muted" : "bg-danger-soft text-danger-ink")}><span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />{statusLabel}</span>
            </div>
            <p className="mt-0.5 text-[1.125rem] font-medium text-heading-support">
              <Link href={`/recruitment/job-postings/${job.id}`} className="hover:underline">{job.title}</Link>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-support text-ink-muted">
              <span className="inline-flex items-center gap-1.5"><BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />{job.department_name}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden="true" />{job.location_name}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden="true" />{application.applied_at ? `Applied ${formatDate(application.applied_at)}` : "Not yet submitted"}</span>
            </p>
            {overview.other_applications.length > 0 && (
              <label className="mt-2 inline-flex items-center gap-2 text-caption text-ink-muted">Also applied for
                <select value="" onChange={(event) => event.target.value && onSwitch(event.target.value)} className="h-8 rounded-lg border border-line bg-surface px-2 text-caption text-ink-strong">
                  <option value="">{overview.other_applications.length} other role{overview.other_applications.length === 1 ? "" : "s"}</option>
                  {overview.other_applications.map((item) => <option key={item.id} value={item.id}>{item.job_title} · {humanizeEnum(item.status)}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {(actions.can_reject || actions.can_create_offer || (status === "DRAFT" && can("candidate.create"))) && (
            <Menu label="More actions" trigger={(props) => <Button {...props} variant="secondary" size="lg" aria-label="More actions"><MoreHorizontal className="h-5 w-5" /></Button>}>
              {(close) => (
                <div className="p-1.5">
                  {status === "DRAFT" && can("candidate.create") && <MenuItem icon={<Send className="h-4 w-4" />} onSelect={() => { close(); setDialog("submit"); }}>Submit application</MenuItem>}
                  {actions.can_move && <MenuItem icon={<ArrowRight className="h-4 w-4" />} onSelect={() => { close(); setMoveTo(""); setDialog("move"); }}>Move to another stage</MenuItem>}
                  {actions.can_create_offer && <MenuItem icon={<FileSignature className="h-4 w-4" />} onSelect={() => { close(); router.push(`/recruitment/offers/new?application=${application.id}`); }}>Create offer</MenuItem>}
                  {actions.can_reject && <MenuItem icon={<XCircle className="h-4 w-4" />} onSelect={() => { close(); setDialog("withdraw"); }}>Withdraw application</MenuItem>}
                  {actions.can_reject && <MenuItem tone="danger" icon={<Trash2 className="h-4 w-4" />} onSelect={() => { close(); setDialog("reject"); }}>Reject candidate</MenuItem>}
                </div>
              )}
            </Menu>
          )}
          {actions.can_schedule_interview && <ButtonLink href={`/recruitment/interviews/new?application=${application.id}`} size="lg" variant="secondary" leadingIcon={<CalendarPlus className="h-5 w-5" />}>Schedule interview</ButtonLink>}
          {actions.can_move && overview.next_stage && <Button size="lg" trailingIcon={<ArrowRight className="h-5 w-5" />} onClick={() => setDialog("next")}>Move to next stage</Button>}
        </div>
      </header>

      {problem && <ErrorState variant="inline" title="Action not completed" message={problem} />}
      {status === "REJECTED" && application.rejection_reason && <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-ink"><p className="font-semibold">Rejected</p><p>{application.rejection_reason}</p></div>}

      <ol className="flex overflow-x-auto rounded-2xl border border-line bg-surface px-2 py-4 shadow-elevation-1" aria-label="Application stages">
        {steps.map((step, index) => {
          const done = index < currentIndex || (status === "HIRED" && index === currentIndex);
          const active = index === currentIndex && status !== "HIRED";
          return (
            <li key={step.id} className="relative flex min-w-[6.5rem] flex-1 flex-col items-center gap-1.5" aria-current={active ? "step" : undefined}>
              {index > 0 && <span aria-hidden="true" className={cx("absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2", index <= currentIndex ? "bg-primary" : "bg-line")} />}
              <span className={cx("relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2", index === 0 && currentIndex > 0 ? "border-ink-subtle bg-ink-subtle" : done ? "border-primary bg-primary text-white" : active ? "border-mod-recruitment bg-surface ring-4 ring-mod-recruitment-soft" : "border-line-strong bg-surface")}>
                {done && index > 0 && <Check className="h-4 w-4" aria-hidden="true" />}
              </span>
              <span className={cx("text-center text-sm font-semibold", active ? "text-mod-recruitment" : done ? "text-primary-ink" : "text-ink-muted")}>{step.name}</span>
            </li>
          );
        })}
      </ol>

      <Tabs
        label="Candidate sections"
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        items={[
          { value: "overview", label: "Overview" },
          { value: "scorecard", label: "Scorecard" },
          { value: "interviews", label: "Interviews", count: overview.interviews.length },
          { value: "documents", label: "Documents", count: documents.length },
          { value: "activity", label: "Activity" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            {scorecard && <ScorecardPanel applicationId={application.id} scorecard={scorecard} active={inProcess} onSaved={reload} compact />}
            {scorecard && !scorecard.can_evaluate && <ViewOnlyNotice />}
            <ProfilePanel candidate={candidate} />
          </div>
          <div className="space-y-5">
            <Panel icon={CalendarDays} title="Interview feedback" description="Review feedback from all interviewers." action={<Button variant="secondary" onClick={() => setTab("interviews")}>View interview schedule</Button>}>
              {allFeedback.length ? <FeedbackList items={allFeedback.slice(0, 3)} /> : <EmptyBlock icon={CalendarDays} title="No interview feedback yet" text="Feedback from scheduled and completed interviews will appear here." />}
            </Panel>
            <Panel icon={FileText} title="Candidate documents" description="" action={<Button variant="secondary" onClick={() => setTab("documents")}>View all documents</Button>}>
              <DocumentList candidateId={candidateId} documents={documents.slice(0, 4)} />
            </Panel>
            <Panel icon={Clock3} title="Activity" description="">
              <ActivityList entries={overview.activity.slice(0, 5)} />
            </Panel>
          </div>
        </div>
      )}

      {tab === "scorecard" && scorecard && (
        <div className="space-y-5">
          <ScorecardPanel applicationId={application.id} scorecard={scorecard} active={inProcess} onSaved={reload} />
          {!scorecard.can_evaluate && <ViewOnlyNotice />}
          <PanelSummary scorecard={scorecard} />
        </div>
      )}

      {tab === "interviews" && (
        <Panel icon={CalendarDays} title="Interviews" description="Scheduled and completed interviews for this application, with interviewer feedback." action={actions.can_schedule_interview ? <ButtonLink href={`/recruitment/interviews/new?application=${application.id}`} variant="secondary" leadingIcon={<CalendarPlus className="h-4 w-4" />}>Schedule interview</ButtonLink> : undefined}>
          {overview.interviews.length ? (
            <ul className="space-y-3">
              {overview.interviews.map((item) => (
                <li key={item.id} className="rounded-xl border border-line-soft p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink-strong">{item.interview_type || "Interview"} · {formatDateTime(item.scheduled_at)}</p>
                    <StatusBadge status={item.status} size="sm" />
                  </div>
                  <p className="mt-0.5 text-caption text-ink-muted">{item.duration_minutes} min · {item.interviewer_name ?? "No interviewer"}{item.location_or_link ? ` · ${item.location_or_link}` : ""}</p>
                  {item.feedback.length > 0 && <div className="mt-3"><FeedbackList items={item.feedback.map((row) => ({ ...row, context: "" }))} /></div>}
                </li>
              ))}
            </ul>
          ) : <EmptyBlock icon={CalendarDays} title="No interviews yet" text="Schedule an interview to start collecting feedback." />}
          {overview.general_feedback.length > 0 && <div className="mt-4"><p className="mb-2 font-semibold text-ink-strong">Other evaluations</p><FeedbackList items={overview.general_feedback.map((row) => ({ ...row, context: "" }))} /></div>}
        </Panel>
      )}

      {tab === "documents" && (
        <Panel icon={FileText} title="Candidate documents" description="CVs, cover letters and supporting documents. Stored as confidential.">
          {actions.can_upload_documents && <DocumentUpload candidateId={candidateId} onUploaded={reload} />}
          <DocumentList candidateId={candidateId} documents={documents} onRemoved={actions.can_upload_documents ? reload : undefined} />
        </Panel>
      )}

      {tab === "activity" && (
        <Panel icon={Clock3} title="Activity" description="Updates, comments and actions related to this candidate." action={<Link href={`/records/application/${application.id}`} className="text-sm font-semibold text-primary-ink hover:underline">History &amp; lineage →</Link>}>
          <ActivityList entries={overview.activity} />
        </Panel>
      )}

      <Dialog
        open={dialog === "next" || dialog === "move"}
        onClose={() => setDialog(null)}
        title={dialog === "next" ? `Move to ${overview.next_stage?.name ?? "next stage"}?` : "Move to another stage"}
        description={`Currently at ${application.current_stage_name ?? "no stage"}.`}
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={dialog === "move" && !moveTo} onClick={() => void run(() => recruitmentApi.moveApplicationStage(application.id, dialog === "next" ? overview.next_stage!.id : moveTo, comment.trim()))}>Move candidate</Button></>}
      >
        <div className="space-y-3">
          {dialog === "move" && (
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Stage</span>
              <select value={moveTo} onChange={(event) => setMoveTo(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm"><option value="">Select stage</option>{stages.filter((stage) => stage.id !== application.current_stage).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select>
            </label>
          )}
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Comment (optional)</span><textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        title="Reject candidate?"
        description="The application leaves the pipeline. The reason is kept on the record and in the audit trail."
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button variant="danger" loading={busy} disabled={!comment.trim()} onClick={() => void run(() => recruitmentApi.rejectApplication(application.id, comment.trim()))}>Reject</Button></>}
      >
        <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Reason</span><textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
      </Dialog>
      <ConfirmDialog
        open={dialog === "withdraw" || dialog === "submit"}
        title={dialog === "submit" ? "Submit application?" : "Withdraw application?"}
        description={dialog === "submit" ? "The application enters the first stage of the pipeline and the hiring manager is notified." : "Use this when the candidate withdraws. The application leaves the pipeline."}
        confirmLabel={dialog === "submit" ? "Submit" : "Withdraw"}
        destructive={dialog === "withdraw"}
        loading={busy}
        onConfirm={() => void run(() => (dialog === "submit" ? recruitmentApi.submitApplication(application.id) : recruitmentApi.withdrawApplication(application.id)))}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

function ScorecardPanel({ applicationId, scorecard, active, onSaved, compact }: { applicationId: string; scorecard: ApplicationScorecard; active: boolean; onSaved: () => void; compact?: boolean }) {
  const [ratings, setRatings] = useState<Record<string, { rating: string; comment: string }>>(() => Object.fromEntries(scorecard.competencies.map((item) => [item.id, scorecard.mine[item.id] ?? { rating: "NOT_ASSESSED", comment: "" }])));
  const [openComment, setOpenComment] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const editable = scorecard.can_evaluate && !scorecard.locked && active;
  const rows = scorecard.competencies.filter((item) => filter === "all" || (filter === "open" ? ratings[item.id]?.rating === "NOT_ASSESSED" : ratings[item.id]?.rating !== "NOT_ASSESSED"));
  const assessed = Object.values(ratings).filter((row) => row.rating !== "NOT_ASSESSED").length;
  const save = async (submit: boolean) => {
    setSaving(submit ? "submit" : "draft");
    setProblem(null);
    try {
      await recruitmentApi.saveApplicationScorecard(applicationId, Object.entries(ratings).map(([competency, row]) => ({ competency, ...row })), submit);
      onSaved();
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setSaving(null);
    }
  };
  return (
    <Panel
      icon={BarChart3}
      title="Evaluation scorecard"
      description="Assess the candidate against role requirements. All evaluators score independently."
      action={
        <label className="relative"><span className="sr-only">Filter criteria</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)} className="h-10 appearance-none rounded-lg border border-line-strong bg-surface pl-3 pr-9 text-sm font-medium text-primary-ink"><option value="all">All criteria</option><option value="open">Not yet assessed</option><option value="done">Assessed</option></select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        </label>
      }
    >
      {problem && <div className="mb-3"><ErrorState variant="inline" title="Evaluation not saved" message={problem} /></div>}
      <div className="overflow-x-auto rounded-xl border border-line-soft">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong">
            <tr><th className="px-3 py-2.5">Competency</th><th className="px-3 py-2.5">Your assessment</th><th className="px-3 py-2.5">Comments</th></tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((item) => {
              const row = ratings[item.id];
              return (
                <tr key={item.id} className="align-top">
                  <td className="px-3 py-2.5"><p className="font-semibold text-primary-ink">{item.name}</p><p className="text-caption text-ink-muted">{item.description}</p></td>
                  <td className="px-3 py-2.5">
                    <label className="relative block w-48"><span className="sr-only">{item.name} assessment</span>
                      <span aria-hidden="true" className={cx("pointer-events-none absolute left-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full", RATING_DOT[row.rating])} />
                      <select disabled={!editable} value={row.rating} onChange={(event) => setRatings((current) => ({ ...current, [item.id]: { ...row, rating: event.target.value } }))} className="h-10 w-full appearance-none rounded-lg border border-line bg-surface pl-8 pr-8 text-sm disabled:bg-surface-muted disabled:text-ink-muted">
                        {COMPETENCY_RATINGS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                    </label>
                  </td>
                  <td className="px-3 py-2.5">
                    {openComment === item.id && editable ? (
                      <textarea autoFocus rows={2} maxLength={2000} value={row.comment} onChange={(event) => setRatings((current) => ({ ...current, [item.id]: { ...row, comment: event.target.value } }))} onBlur={() => setOpenComment(null)} className="w-full rounded-lg border border-line-strong px-2 py-1.5 text-sm" />
                    ) : row.comment ? (
                      <button type="button" disabled={!editable} onClick={() => setOpenComment(item.id)} className="text-left text-sm text-ink">{row.comment}</button>
                    ) : (
                      <button type="button" disabled={!editable} onClick={() => setOpenComment(item.id)} className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-primary-ink disabled:text-ink-subtle"><MessageSquare className="h-4 w-4" aria-hidden="true" />Add comment</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-xl bg-primary-soft/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex gap-2.5 text-sm"><Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" />
          <span>{scorecard.locked
            ? <><span className="font-semibold text-primary-ink">Your evaluation was submitted{scorecard.my_submitted_at ? ` on ${formatDateTime(scorecard.my_submitted_at)}` : ""}.</span> It is visible to the recruitment panel and can no longer be changed.</>
            : <><span className="font-semibold text-primary-ink">Your evaluation will be visible to the recruitment panel once submitted.</span> Please ensure your feedback is fair, objective and evidence-based.</>}</span>
        </p>
        {editable && !compact && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" loading={saving === "draft"} onClick={() => void save(false)}>Save draft</Button>
            <Button loading={saving === "submit"} disabled={assessed < scorecard.competencies.length} onClick={() => void save(true)}>Submit evaluation</Button>
          </div>
        )}
        {editable && compact && <Button variant="secondary" loading={saving === "draft"} onClick={() => void save(false)}>Save ({assessed}/{scorecard.competencies.length})</Button>}
      </div>
    </Panel>
  );
}

function PanelSummary({ scorecard }: { scorecard: ApplicationScorecard }) {
  if (scorecard.can_evaluate && !scorecard.locked) {
    return <Panel icon={Lock} title="Panel results" description="Submit your own evaluation to see the panel's combined results."><p className="text-sm text-ink-muted">Results stay hidden until you submit, so every evaluator scores independently.</p></Panel>;
  }
  const levels = COMPETENCY_RATINGS.filter(([value]) => value !== "NOT_ASSESSED");
  return (
    <Panel icon={BarChart3} title="Panel results" description={`${scorecard.evaluator_count} evaluator${scorecard.evaluator_count === 1 ? "" : "s"} submitted. Individual scores stay private; counts are combined.`}>
      {scorecard.evaluator_count ? (
        <div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-sm">
          <thead><tr className="text-left text-caption text-ink-muted"><th className="py-2">Competency</th>{levels.map(([value, text]) => <th key={value} className="py-2 text-center">{text}</th>)}</tr></thead>
          <tbody className="divide-y divide-line-soft">
            {scorecard.competencies.map((item) => {
              const counts = scorecard.summary.find((row) => row.competency === item.id)?.counts ?? {};
              return <tr key={item.id}><td className="py-2 font-semibold text-ink-strong">{item.name}</td>{levels.map(([value]) => <td key={value} className="py-2 text-center tabular-nums">{counts[value] ? <span className={cx("inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-white", RATING_DOT[value])}>{counts[value]}</span> : <span className="text-ink-subtle">0</span>}</td>)}</tr>;
            })}
          </tbody>
        </table></div>
      ) : <EmptyBlock icon={BarChart3} title="No evaluations submitted yet" text="Combined results appear once panel members submit their scorecards." />}
    </Panel>
  );
}

function ViewOnlyNotice() {
  return (
    <div className="flex gap-3 rounded-2xl border border-mod-recruitment/25 bg-mod-recruitment-soft/60 p-5">
      <Lock className="mt-0.5 h-6 w-6 shrink-0 text-headline" aria-hidden="true" />
      <div><p className="font-semibold text-headline">You have view-only access to some information</p><p className="mt-0.5 text-sm text-ink">Adding or editing evaluations is restricted to members of the recruitment panel: the requisition&apos;s hiring manager and hiring team.</p></div>
    </div>
  );
}

function ProfilePanel({ candidate }: { candidate: Candidate }) {
  const rows: Array<[typeof UserRound, string, string]> = [
    [Mail, "Email", candidate.email],
    [Phone, "Phone", candidate.phone || EM_DASH],
    [MapPin, "Location", candidate.location || EM_DASH],
    [BriefcaseBusiness, "Current role", [candidate.current_title, candidate.current_employer].filter(Boolean).join(" at ") || choice(EMPLOYMENT_STATUSES, candidate.employment_status)],
    [Clock3, "Experience / notice", `${candidate.years_experience ?? EM_DASH} years · ${candidate.notice_period_weeks != null ? `${candidate.notice_period_weeks} weeks notice` : "notice not recorded"}`],
    [GraduationCap, "Education", [choice(QUALIFICATIONS, candidate.highest_qualification), candidate.field_of_study, candidate.education_institution].filter((part) => part && part !== EM_DASH).join(", ") || EM_DASH],
    [UserRound, "Source", candidate.source || EM_DASH],
  ];
  return (
    <Panel icon={UserRound} title="Candidate profile" description="Details captured with the application." action={candidate.linkedin_url ? <a href={candidate.linkedin_url} target="_blank" rel="noreferrer noopener" className="text-sm font-semibold text-primary-ink hover:underline">LinkedIn profile</a> : undefined}>
      <dl className="divide-y divide-line-soft rounded-xl border border-line-soft">
        {rows.map(([Icon, label, value]) => <div key={label} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 px-3 py-2 text-sm"><dt className="flex items-center gap-2 font-semibold text-ink-strong"><Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />{label}</dt><dd className="break-words text-ink">{value}</dd></div>)}
      </dl>
      {candidate.skills && <div className="mt-3 flex flex-wrap gap-1.5">{candidate.skills.split("\n").map((skill) => skill.trim()).filter(Boolean).map((skill) => <span key={skill} className="rounded-full bg-surface-muted px-2.5 py-0.5 text-caption font-medium text-ink">{skill}</span>)}</div>}
    </Panel>
  );
}

function FeedbackList({ items }: { items: Array<{ id: string; interviewer_name: string | null; score: string | number; recommendation: string; comments: string; context: string }> }) {
  return (
    <ul className="space-y-3">
      {items.map((row) => (
        <li key={row.id} className="flex gap-3">
          <Avatar name={row.interviewer_name ?? "?"} size="sm" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="flex flex-wrap items-center gap-2"><span className="font-semibold text-ink-strong">{row.interviewer_name ?? "Interviewer"}</span><span className="rounded-full bg-surface-muted px-2 py-0.5 text-caption font-semibold">{humanizeEnum(row.recommendation)} · {Number(row.score)}</span></p>
            {row.context && <p className="text-caption text-ink-muted">{row.context}</p>}
            {row.comments && <p className="mt-0.5 text-ink">{row.comments}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DocumentUpload({ candidateId, onUploaded }: { candidateId: string; onUploaded: () => void }) {
  const [type, setType] = useState("CV");
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setProgress(0);
    setProblem(null);
    try {
      await recruitmentApi.uploadCandidateDocument(candidateId, file, type, setProgress);
      onUploaded();
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setProgress(null);
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border-2 border-dashed border-line-strong p-3">
        <select aria-label="Document type" value={type} onChange={(event) => setType(event.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-sm">{CANDIDATE_DOCUMENT_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
        <input ref={ref} type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
        <Button variant="secondary" leadingIcon={<Upload className="h-4 w-4" />} loading={progress !== null} loadingLabel={`Uploading ${progress ?? 0}%`} onClick={() => ref.current?.click()}>Upload document</Button>
      </div>
      {problem && <ErrorState variant="inline" title="Upload failed" message={problem} />}
    </div>
  );
}

function DocumentList({ candidateId, documents, onRemoved }: { candidateId: string; documents: CandidateDocument[]; onRemoved?: () => void }) {
  const [removing, setRemoving] = useState<CandidateDocument | null>(null);
  const [busy, setBusy] = useState(false);
  if (!documents.length) return <EmptyBlock icon={FileText} title="No documents yet" text="Uploaded CVs, cover letters and supporting documents will appear here." />;
  return (
    <>
      <ul className="divide-y divide-line-soft">
        {documents.map((document) => (
          <li key={document.id} className="flex items-center gap-3 py-2.5 text-sm">
            <FileText className={cx("h-5 w-5 shrink-0", document.content_type.includes("pdf") ? "text-danger-ink" : "text-section-icon")} aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink-strong">{choice(CANDIDATE_DOCUMENT_TYPES, document.category)}</span><span className="block truncate text-caption text-ink-muted">{document.original_filename}</span></span>
            <span className="hidden text-caption text-ink-muted sm:block">Added {formatDate(document.created_at)}</span>
            <Button variant="ghost" size="sm" aria-label={`Download ${document.original_filename}`} onClick={() => void recruitmentApi.downloadCandidateDocument(candidateId, document.id).then((blob) => saveBlob(blob, document.original_filename))}><Download className="h-4 w-4" /></Button>
            {onRemoved && <Button variant="ghost" size="sm" aria-label={`Remove ${document.original_filename}`} onClick={() => setRemoving(document)}><Trash2 className="h-4 w-4" /></Button>}
          </li>
        ))}
      </ul>
      <ConfirmDialog open={removing !== null} title="Remove document?" description="The file is archived and no longer shown on the candidate. The removal is recorded in the audit trail." confirmLabel="Remove" destructive loading={busy} onCancel={() => setRemoving(null)} onConfirm={() => { if (!removing) return; setBusy(true); void recruitmentApi.removeCandidateDocument(candidateId, removing.id).then(() => { setRemoving(null); onRemoved?.(); }).finally(() => setBusy(false)); }} />
    </>
  );
}

function ActivityList({ entries }: { entries: ApplicationOverview["activity"] }) {
  const [filter, setFilter] = useState("all");
  const shown = useMemo(() => entries.filter((entry) => filter === "all" || entry.action.includes(filter)), [entries, filter]);
  if (!entries.length) return <EmptyBlock icon={Clock3} title="No recent activity" text="Updates, comments and actions related to this candidate will appear here." />;
  return (
    <>
      <select aria-label="Filter activity" value={filter} onChange={(event) => setFilter(event.target.value)} className="mb-3 h-9 rounded-lg border border-line bg-surface px-2 text-sm"><option value="all">All activity</option><option value="application">Application</option><option value="document">Documents</option><option value="interview">Interviews</option><option value="offer">Offers</option></select>
      <ol className="space-y-3">
        {shown.map((entry) => (
          <li key={entry.id} className="flex gap-3 text-sm">
            <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
            <span><span className="block font-semibold text-ink-strong">{ACTIVITY_LABELS[entry.action] ?? humanizeEnum(entry.action.split(".").slice(-1)[0])}{typeof entry.metadata?.filename === "string" ? ` · ${entry.metadata.filename}` : ""}</span><span className="text-caption text-ink-muted">{entry.actor} · {formatDateTime(entry.created_at)}</span></span>
          </li>
        ))}
      </ol>
    </>
  );
}

function ProfileOnly({ candidate }: { candidate: Candidate }) {
  const { can } = useAccess();
  useEffect(() => { document.title = `${candidate.first_name} ${candidate.last_name} · ErgonX`; }, [candidate]);
  return (
    <div className="space-y-5">
      <Link href="/recruitment/candidates" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to candidates</Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4"><Avatar name={`${candidate.first_name} ${candidate.last_name}`} size="lg" /><div><h1 className="text-[1.75rem] font-bold text-headline">{candidate.full_name || `${candidate.first_name} ${candidate.last_name}`}</h1><p className="text-heading-support">No applications yet</p></div></div>
        {can("candidate.create") && <ButtonLink href={`/recruitment/applications/new?candidate=${candidate.id}`} size="lg" leadingIcon={<Send className="h-5 w-5" />}>Add to a requisition</ButtonLink>}
      </header>
      <ProfilePanel candidate={candidate} />
    </div>
  );
}

function Panel({ icon: Icon, title, description, action, children }: { icon: typeof FileText; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><Icon className="mt-0.5 h-7 w-7 shrink-0 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">{title}</h2>{description && <p className="text-support text-heading-support">{description}</p>}</div></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyBlock({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-section-icon"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <p className="mt-2 font-bold text-ink-strong">{title}</p>
      <p className="mt-0.5 max-w-sm text-support text-ink-muted">{text}</p>
    </div>
  );
}
