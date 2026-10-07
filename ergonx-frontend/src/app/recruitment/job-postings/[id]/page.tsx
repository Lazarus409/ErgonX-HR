"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CircleCheck,
  ClipboardList,
  FileText,
  History,
  ListChecks,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { HIRING_REASONS, HIRING_TEAM_ROLES, INTERVIEW_PLANS, type JobPosting } from "@/types/recruitment";

type Action = "publish" | "close" | "cancel" | "submit" | null;

const STEPS = ["Draft", "Approval", "Open", "Hiring", "Closed"];
const HISTORY_LABELS: Record<string, string> = {
  "recruitment.requisition.submitted": "Submitted for approval",
  "recruitment.requisition.approved": "Approved",
  "recruitment.requisition.returned": "Returned for changes",
  "recruitment.requisition.team_added": "Hiring team member added",
  "recruitment.requisition.team_removed": "Hiring team member removed",
};

function stepOf(posting: JobPosting): number {
  if (posting.status === "CLOSED" || posting.status === "CANCELLED") return 4;
  if (posting.status === "OPEN") return (posting.application_counts?.total ?? 0) > 0 ? 3 : 2;
  if (posting.status === "APPROVED") return 2;
  if (posting.status === "PENDING_APPROVAL") return 1;
  return 0;
}

const lines = (text?: string) => (text ?? "").split("\n").map((line) => line.trim().replace(/^[-•*]\s*/, "")).filter(Boolean);
const choice = (options: Array<[string, string]>, value?: string) => options.find(([key]) => key === value)?.[1] ?? (value ? humanizeEnum(value) : EM_DASH);

/** Concept "Requisition detail": brief, approvals, hiring team, candidate activity and audit history. */
export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAccess();
  const load = useCallback(async () => {
    const [posting, team, activity, history] = await Promise.all([
      recruitmentApi.getJobPosting(id),
      recruitmentApi.listHiringTeam(id).catch(() => []),
      recruitmentApi.getRequisitionActivity(id).catch(() => null),
      recruitmentApi.getRequisitionHistory(id).catch(() => []),
    ]);
    return { posting, team, activity, history };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [action, setAction] = useState<Action>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [teamOpen, setTeamOpen] = useState(false);
  const [allHistory, setAllHistory] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setSaving(true);
    setActionError(null);
    try {
      await work();
      setAction(null);
      setComment("");
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
      setAction(null);
    } finally {
      setSaving(false);
    }
  };
  const confirm = () => {
    if (action === "publish") void run(() => recruitmentApi.publishJobPosting(id));
    else if (action === "submit") void run(() => recruitmentApi.submitJobPostingForApproval(id));
    else if (action) void run(() => recruitmentApi.closeJobPosting(id, action === "cancel"));
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Requisition not found."} onRetry={reload} />;
  const { posting, team, activity, history } = data;
  const step = stepOf(posting);
  const canUpdate = can("job_posting.update");
  const canApprove = can("job_posting.approve");
  const editable = canUpdate && ["DRAFT", "APPROVED", "OPEN"].includes(posting.status);
  // Only an approved requisition can be published; drafts go through approval first (BQ-06).
  const publishable = canUpdate && posting.status === "APPROVED";
  const isSubmitter = Boolean(user?.id && posting.submitted_by === user.id);
  const salary = posting.salary_min || posting.salary_max
    ? `${formatAmount(posting.salary_min, posting.salary_currency)} – ${formatAmount(posting.salary_max, posting.salary_currency)}`
    : null;
  const brief: Array<[typeof UserRound, string, string]> = [
    [BriefcaseBusiness, "Job title", posting.title],
    [Building2, "Department / Functional Area", posting.department_name ?? EM_DASH],
    [ClipboardList, "Position", posting.position_title ?? EM_DASH],
    [BadgeCheck, "Employment type", humanizeEnum(posting.employment_type)],
    [FileText, "Grade / Salary range", [posting.grade_name, salary].filter(Boolean).join(" · ") || EM_DASH],
    [MapPin, "Location", posting.location_name ?? EM_DASH],
    [UserRound, "Reports to", posting.reports_to_title ?? EM_DASH],
    [CalendarDays, "Target start date", formatDate(posting.target_start_date)],
    [UsersRound, "Headcount", String(posting.openings)],
    [ListChecks, "Hiring reason / plan", `${choice(HIRING_REASONS, posting.hiring_reason)} · ${choice(INTERVIEW_PLANS, posting.interview_plan)}`],
    [CalendarDays, "Applications close", formatDate(posting.closes_on)],
  ];
  const essential = lines(posting.qualifications_essential);
  const desirable = lines(posting.qualifications_desirable);
  const responsibilities = lines(posting.responsibilities);
  const shownHistory = allHistory ? history : history.slice(0, 4);

  return (
    <div className="space-y-5">
      <Link href="/recruitment/job-postings" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to requisitions</Link>

      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <span className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-soft text-section-icon sm:flex"><BriefcaseBusiness className="h-7 w-7" aria-hidden="true" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline">{posting.title}</h1>
              <StatusBadge status={posting.status} />
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-support text-heading-support">
              <span className="font-medium text-ink-muted">{posting.code}</span>
              <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4" aria-hidden="true" />{posting.department_name}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden="true" />{posting.location_name}</span>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden="true" />Created {formatDate(posting.created_at)}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate && ["DRAFT", "APPROVED", "OPEN", "PENDING_APPROVAL"].includes(posting.status) && (
            <Menu label="More actions" trigger={(props) => <Button {...props} variant="secondary" size="lg" aria-label="More actions"><MoreHorizontal className="h-5 w-5" /></Button>}>
              {(close) => (
                <div className="p-1.5">
                  {posting.status === "DRAFT" && <MenuItem icon={<Send className="h-4 w-4" />} onSelect={() => { close(); setAction("submit"); }}>Submit for approval</MenuItem>}
                  <MenuItem tone="danger" icon={<Trash2 className="h-4 w-4" />} onSelect={() => { close(); setAction("cancel"); }}>Cancel requisition</MenuItem>
                </div>
              )}
            </Menu>
          )}
          {editable && <ButtonLink href={`/recruitment/job-postings/${id}/edit`} size="lg" variant="secondary" leadingIcon={<Pencil className="h-5 w-5" />}>Edit</ButtonLink>}
          {publishable && <Button size="lg" leadingIcon={<Send className="h-5 w-5" />} onClick={() => setAction("publish")}>Publish</Button>}
          {canUpdate && posting.status === "OPEN" && <Button size="lg" variant="secondary" leadingIcon={<X className="h-5 w-5" />} onClick={() => setAction("close")}>Close</Button>}
        </div>
      </header>

      {actionError && <ErrorState variant="inline" title="Action not completed" message={actionError} />}

      <ol className="grid grid-cols-5 rounded-2xl border border-line bg-surface px-2 py-4 shadow-elevation-1" aria-label="Requisition lifecycle">
        {STEPS.map((name, index) => {
          const done = index < step || (index === 4 && step === 4);
          const active = index === step && step !== 4;
          return (
            <li key={name} className="relative flex flex-col items-center gap-1.5" aria-current={active ? "step" : undefined}>
              {index > 0 && <span aria-hidden="true" className={cx("absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2", index <= step ? "bg-primary" : "bg-line")} />}
              <span className={cx("relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2", done ? "border-success bg-success text-white" : active ? "border-mod-recruitment bg-surface ring-4 ring-mod-recruitment-soft" : "border-line-strong bg-surface")}>
                {done && <Check className="h-4 w-4" aria-hidden="true" />}
              </span>
              <span className={cx("text-sm font-semibold", active ? "text-mod-recruitment" : done ? "text-success-ink" : "text-ink-muted")}>{posting.status === "CANCELLED" && index === 4 ? "Cancelled" : name}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel icon={FileText} title="Job brief" description="An overview of the role, its purpose and key details." action={editable ? <ButtonLink href={`/recruitment/job-postings/${id}/edit`} variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink> : undefined}>
            <dl className="divide-y divide-line-soft rounded-xl border border-line-soft">
              {brief.map(([Icon, label, text]) => (
                <div key={label} className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] gap-3 px-3 py-2 text-sm">
                  <dt className="flex items-center gap-2 font-semibold text-ink-strong"><Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />{label}</dt>
                  <dd className="text-ink">{text}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex items-start gap-3">
              <FileText className="mt-0.5 h-6 w-6 text-section-icon" aria-hidden="true" />
              <div><h3 className="text-heading font-bold text-headline">Role description</h3><p className="text-support text-heading-support">A summary of the role, its purpose and what the successful candidate will be expected to do.</p></div>
            </div>
            <div className="mt-3 space-y-3 rounded-xl bg-surface-muted p-4 text-sm text-ink">
              {posting.description ? <p className="whitespace-pre-wrap">{posting.description}</p> : !responsibilities.length && <p className="text-ink-muted">No role description has been written yet.</p>}
              {responsibilities.length > 0 && (
                <div><p className="font-semibold text-ink-strong">Key responsibilities</p><ul className="mt-1 list-disc space-y-0.5 pl-5">{responsibilities.map((line, index) => <li key={index}>{line}</li>)}</ul></div>
              )}
            </div>

            <div className="mt-6 flex items-start gap-3">
              <ListChecks className="mt-0.5 h-6 w-6 text-section-icon" aria-hidden="true" />
              <div><h3 className="text-heading font-bold text-headline">Key requirements</h3><p className="text-support text-heading-support">Essential and desirable criteria for this role.</p></div>
            </div>
            <div className="mt-3 grid rounded-xl border border-line-soft sm:grid-cols-2 sm:divide-x sm:divide-line-soft">
              {([["Essential", essential], ["Desirable", desirable]] as const).map(([heading, items]) => (
                <div key={heading} className="p-4 text-sm">
                  <p className="font-bold text-ink-strong">{heading}</p>
                  {items.length ? <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink">{items.map((line, index) => <li key={index}>{line}</li>)}</ul> : <p className="mt-1.5 text-ink-muted">None recorded.</p>}
                </div>
              ))}
            </div>
          </Panel>

          <Panel icon={UsersRound} title="Candidate activity" description="Applications and candidate progress for this requisition." action={can("candidate.view") ? <ButtonLink href="/recruitment/applications" variant="secondary">View all candidates</ButtonLink> : undefined}>
            {activity && activity.total > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {activity.by_stage.map((row) => <span key={row.stage} className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary-ink">{row.stage} · {row.count}</span>)}
                  <span className="rounded-full bg-surface-muted px-3 py-1 text-sm font-semibold text-ink-muted">{activity.total} total</span>
                </div>
                <ul className="mt-4 divide-y divide-line-soft">
                  {activity.recent.map((item) => (
                    <li key={item.id}>
                      <Link href={`/recruitment/applications/${item.id}`} className="flex items-center gap-3 py-2.5 hover:bg-surface-hover">
                        <Avatar name={item.candidate} size="sm" />
                        <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink-strong">{item.candidate}</span><span className="text-caption text-ink-muted">{item.stage ?? "Not staged"} · {item.applied_at ? formatDate(item.applied_at) : "Draft"}</span></span>
                        <StatusBadge status={item.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyBlock icon={UsersRound} title="No candidates yet" text="Once the requisition is published, applications will appear here." />
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel icon={CircleCheck} title="Approvals" description="This requisition requires approval before it can be published.">
            {posting.status === "DRAFT" && !posting.approved_by_name ? (
              <div className="text-center">
                {posting.approval_note ? (
                  <div className="mb-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-left text-sm text-warning-ink"><p className="font-semibold">Returned for changes</p><p className="mt-0.5">{posting.approval_note}</p></div>
                ) : (
                  <EmptyBlock icon={FileText} title="Approval not started yet" text="Once submitted, the approval workflow will appear here." />
                )}
                {canUpdate && <Button className="mt-3" leadingIcon={<Send className="h-4 w-4" />} onClick={() => setAction("submit")}>Submit for approval</Button>}
              </div>
            ) : (
              <ol className="space-y-3">
                <ApprovalStep done title="Submitted" who={posting.submitted_by_name} when={posting.submitted_at} />
                {posting.status === "PENDING_APPROVAL" ? (
                  <li className="rounded-xl border border-mod-recruitment/30 bg-mod-recruitment-soft/50 p-3">
                    <p className="font-semibold text-ink-strong">Awaiting approval</p>
                    <p className="text-caption text-ink-muted">Any HR Admin, Director or Institution Admin other than the submitter can decide.</p>
                    {canApprove && !isSubmitter && (
                      <div className="mt-3 space-y-2">
                        <label className="block"><span className="sr-only">Decision comment</span><textarea rows={3} value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="Comment (required to return for changes)" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
                        <div className="flex flex-wrap gap-2">
                          <Button loading={saving} leadingIcon={<Check className="h-4 w-4" />} onClick={() => void run(() => recruitmentApi.approveJobPosting(id, comment.trim()))}>Approve</Button>
                          <Button variant="secondary" disabled={saving || !comment.trim()} onClick={() => void run(() => recruitmentApi.returnJobPosting(id, comment.trim()))}>Return for changes</Button>
                        </div>
                      </div>
                    )}
                    {isSubmitter && <p className="mt-2 text-caption font-medium text-ink-muted">You submitted this requisition, so someone else must approve it.</p>}
                  </li>
                ) : (
                  <ApprovalStep done={Boolean(posting.approved_by_name)} title={posting.approved_by_name ? "Approved" : "Approval"} who={posting.approved_by_name} when={posting.approved_at} note={posting.approval_note} />
                )}
              </ol>
            )}
          </Panel>

          <Panel icon={UsersRound} title="Hiring team" description="People involved in hiring for this requisition." action={canUpdate && !["CLOSED", "CANCELLED"].includes(posting.status) ? <Button variant="secondary" onClick={() => setTeamOpen(true)}>Manage team</Button> : undefined}>
            <ul className="divide-y divide-line-soft">
              {posting.hiring_manager_name && (
                <li className="flex items-center gap-3 py-2.5"><Avatar name={posting.hiring_manager_name} /><span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{posting.hiring_manager_name}</span><span className="text-caption text-ink-muted">Hiring manager</span></span><span className="rounded-full bg-success-soft px-2.5 py-0.5 text-caption font-semibold text-success-ink">Owner</span></li>
              )}
              {team.map((member) => (
                <li key={member.id} className="flex items-center gap-3 py-2.5"><Avatar name={member.user_name} /><span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{member.user_name}</span><span className="text-caption text-ink-muted">{choice(HIRING_TEAM_ROLES, member.role)}</span></span><span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary-ink">{member.role === "INTERVIEW_PANEL" ? "Panel member" : "Team member"}</span></li>
              ))}
              {!posting.hiring_manager_name && !team.length && <li className="py-3 text-sm text-ink-muted">No hiring team assigned yet.</li>}
            </ul>
            {canUpdate && !["CLOSED", "CANCELLED"].includes(posting.status) && (
              <button type="button" onClick={() => setTeamOpen(true)} className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-muted"><Plus className="h-4 w-4" aria-hidden="true" /></span>Add team member</button>
            )}
          </Panel>

          <Panel icon={History} title="Audit history" description="A record of key changes and actions on this requisition." action={history.length > 4 ? <Button variant="secondary" onClick={() => setAllHistory((current) => !current)}>{allHistory ? "Show recent" : "View full history"}</Button> : undefined}>
            {history.length ? (
              <ol className="space-y-3">
                {shownHistory.map((entry) => (
                  <li key={entry.id} className="flex gap-3 text-sm">
                    <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                    <span><span className="block font-semibold text-ink-strong">{HISTORY_LABELS[entry.action] ?? humanizeEnum(entry.action.split(".").pop())}</span><span className="text-caption text-ink-muted">{entry.actor} · {formatDateTime(entry.created_at)}</span>{typeof entry.metadata?.comment === "string" && entry.metadata.comment && <span className="mt-0.5 block text-caption text-ink">“{entry.metadata.comment}”</span>}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyBlock icon={FileText} title="No activity yet" text="Audit history will appear here once changes are made to this requisition." />
            )}
          </Panel>
        </div>
      </div>

      <TeamDialog open={teamOpen} onClose={() => setTeamOpen(false)} postingId={id} team={team} onChanged={reload} />

      <ConfirmDialog
        open={action !== null}
        title={action === "publish" ? "Publish requisition?" : action === "submit" ? "Submit for approval?" : action === "cancel" ? "Cancel requisition?" : "Close requisition?"}
        description={action === "publish" ? "This opens the requisition for applications." : action === "submit" ? "Approvers will be notified. You can't edit it while it's pending." : "No further applications will be accepted."}
        confirmLabel={action === "publish" ? "Publish" : action === "submit" ? "Submit" : action === "cancel" ? "Cancel requisition" : "Close requisition"}
        destructive={action === "cancel"}
        loading={saving}
        onConfirm={confirm}
        onCancel={() => setAction(null)}
      />
    </div>
  );
}

function Panel({ icon: Icon, title, description, action, children }: { icon: typeof FileText; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-7 w-7 shrink-0 text-section-icon" aria-hidden="true" />
          <div><h2 className="text-heading font-bold text-headline">{title}</h2><p className="text-support text-heading-support">{description}</p></div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyBlock({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center py-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <p className="mt-2 font-bold text-ink-strong">{title}</p>
      <p className="mt-0.5 max-w-sm text-support text-ink-muted">{text}</p>
    </div>
  );
}

function ApprovalStep({ done, title, who, when, note }: { done: boolean; title: string; who?: string | null; when?: string | null; note?: string }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", done ? "bg-success text-white" : "border-2 border-line-strong")}>{done && <Check className="h-3.5 w-3.5" aria-hidden="true" />}</span>
      <span className="text-sm"><span className="block font-semibold text-ink-strong">{title}</span><span className="text-caption text-ink-muted">{who ?? EM_DASH}{when ? ` · ${formatDateTime(when)}` : ""}</span>{note && <span className="mt-0.5 block text-caption text-ink">“{note}”</span>}</span>
    </li>
  );
}

function TeamDialog({ open, onClose, postingId, team, onChanged }: { open: boolean; onClose: () => void; postingId: string; team: Array<{ id: string; user: string; user_name: string; role: string }>; onChanged: () => void }) {
  const loadPeople = useCallback(() => (open ? recruitmentApi.listRecruitmentPeople() : Promise.resolve([])), [open]);
  const { data: people } = useApiResource(loadPeople);
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("INTERVIEW_PANEL");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      setPerson("");
      onChanged();
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Manage hiring team" description="Add or remove the people involved in hiring for this requisition." size="md" footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <div className="space-y-4">
        {problem && <ErrorState variant="inline" title="Team not updated" message={problem} />}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_auto]">
          <label><span className="sr-only">Person</span><select value={person} onChange={(event) => setPerson(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm"><option value="">Select a person</option>{(people ?? []).filter((item) => !team.some((member) => member.user === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}{item.role ? ` · ${item.role}` : ""}</option>)}</select></label>
          <label><span className="sr-only">Role</span><select value={role} onChange={(event) => setRole(event.target.value)} className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm">{HIRING_TEAM_ROLES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <Button disabled={!person} loading={busy} leadingIcon={<Plus className="h-4 w-4" />} onClick={() => void act(() => recruitmentApi.addHiringTeamMember(postingId, person, role))}>Add</Button>
        </div>
        <ul className="divide-y divide-line-soft rounded-xl border border-line-soft">
          {team.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={member.user_name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block font-semibold text-ink-strong">{member.user_name}</span><span className="text-caption text-ink-muted">{choice(HIRING_TEAM_ROLES, member.role)}</span></span>
              <Button variant="ghost" size="sm" aria-label={`Remove ${member.user_name}`} disabled={busy} onClick={() => void act(() => recruitmentApi.removeHiringTeamMember(postingId, member.id))}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
          {!team.length && <li className="px-3 py-3 text-sm text-ink-muted">No team members yet.</li>}
        </ul>
      </div>
    </Dialog>
  );
}
