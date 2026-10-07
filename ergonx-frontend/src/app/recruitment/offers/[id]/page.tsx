"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  FileSignature,
  FileText,
  Hourglass,
  Info,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Send,
  Undo2,
  UserCheck,
  UserRound,
  UsersRound,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { getApiErrorMessage, organizationApi, payrollApi, recruitmentApi } from "@/lib/api";
import { isModuleOffered } from "@/lib/product";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { EM_DASH, formatAmount, formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { WORKING_PATTERNS, type RecruitmentOffer, type RequisitionHistoryEntry } from "@/types/recruitment";

type Tab = "overview" | "letter" | "approvals" | "activity";
type Dialogs = "terms" | "submit" | "send" | "response" | "withdraw" | "hire" | null;

const ACTIVITY_LABELS: Record<string, string> = {
  "recruitment.offer.submitted": "Submitted for approval",
  "recruitment.offer.approved": "Offer approved",
  "recruitment.offer.returned": "Returned for changes",
  "recruitment.offer.extended": "Offer sent to candidate",
  "recruitment.offer.accepted": "Candidate accepted",
  "recruitment.offer.declined": "Candidate declined",
  "recruitment.offer.withdrawn": "Offer withdrawn",
  "recruitment.offer.letter_generated": "Offer letter generated",
  "recruitment.offer.hired": "Candidate hired",
};

function lifecycle(offer: RecruitmentOffer) {
  const declined = offer.status === "DECLINED";
  const sent = ["EXTENDED", "ACCEPTED", "DECLINED", "HIRED"].includes(offer.status);
  const approved = sent || offer.status === "APPROVED";
  return [
    { name: "Draft", done: true, active: offer.status === "DRAFT", note: formatDate(offer.created_at) },
    { name: "Approval", done: approved, active: offer.status === "PENDING_APPROVAL", note: approved ? formatDate(offer.approved_at ?? offer.extended_at) : offer.status === "PENDING_APPROVAL" ? "Awaiting approval" : "Not started" },
    { name: "Sent", done: sent, active: offer.status === "APPROVED", note: sent ? formatDate(offer.extended_at) : "Not started" },
    { name: "Accepted", done: offer.status === "ACCEPTED" || offer.status === "HIRED", active: offer.status === "EXTENDED", note: offer.accepted_at ? formatDate(offer.accepted_at) : offer.status === "EXTENDED" ? "Awaiting response" : "Not started" },
    { name: "Declined", done: declined, active: false, note: offer.declined_at ? formatDate(offer.declined_at) : "Not started", danger: declined },
  ];
}

/** Concept "Offer management" (option 3). */
export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, user } = useAccess();
  const load = useCallback(async () => {
    const [offer, activity] = await Promise.all([recruitmentApi.getOffer(id), recruitmentApi.getOfferActivity(id).catch(() => [] as RequisitionHistoryEntry[])]);
    return { offer, activity };
  }, [id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [comment, setComment] = useState("");
  const [accepted, setAccepted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>, after?: (value: unknown) => void) => {
    setBusy(true);
    setProblem(null);
    try {
      const value = await work();
      setDialog(null);
      setComment("");
      after?.(value);
      reload();
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Offer not found."} onRetry={reload} />;
  const { offer, activity } = data;
  const canEdit = can("offer.create") && (offer.status === "DRAFT" || offer.status === "APPROVED");
  const canApprove = can("offer.approve");
  const isSubmitter = Boolean(user?.id && offer.submitted_by === user.id);
  const hasPay = offer.base_salary !== null && offer.base_salary !== undefined;
  const steps = lifecycle(offer);
  const primary = (() => {
    if (offer.status === "DRAFT" && can("offer.create")) return <Button size="lg" trailingIcon={<ArrowRight className="h-5 w-5" />} disabled={!hasPay} onClick={() => setDialog("submit")}>Submit for approval</Button>;
    if (offer.status === "PENDING_APPROVAL" && canApprove && !isSubmitter) return <Button size="lg" leadingIcon={<Check className="h-5 w-5" />} onClick={() => setTab("approvals")}>Review approval</Button>;
    if (offer.status === "APPROVED" && can("offer.create")) return <Button size="lg" leadingIcon={<Send className="h-5 w-5" />} onClick={() => setDialog("send")}>Send offer</Button>;
    if (offer.status === "EXTENDED" && can("offer.manage")) return <Button size="lg" leadingIcon={<Pencil className="h-5 w-5" />} onClick={() => setDialog("response")}>Record response</Button>;
    if (offer.status === "ACCEPTED" && can("offer.manage")) return <Button size="lg" leadingIcon={<UserCheck className="h-5 w-5" />} onClick={() => setDialog("hire")}>Complete hire</Button>;
    return null;
  })();
  const terms: Array<[typeof UserRound, string, string]> = [
    [BriefcaseBusiness, "Position", offer.position_title ?? EM_DASH],
    [BadgeCheck, "Employment type", humanizeEnum(offer.employment_type)],
    [CircleDollarSign, "Salary / Grade", `${hasPay ? `${formatAmount(offer.base_salary, offer.currency)} / month` : EM_DASH} · ${offer.grade_name ?? EM_DASH}`],
    [FileText, "Contract length", offer.contract_length_months ? `${offer.contract_length_months} months` : offer.employment_type === "PERMANENT" ? "Permanent" : EM_DASH],
    [CalendarDays, "Start date", formatDate(offer.proposed_start_date)],
    [Clock3, "Working pattern", WORKING_PATTERNS.find(([value]) => value === offer.working_pattern)?.[1] ?? EM_DASH],
    [UserRound, "Reporting to", offer.reports_to_title ?? EM_DASH],
    [MapPin, "Location", offer.location_name ?? EM_DASH],
    [CalendarDays, "Offer expires", formatDate(offer.expires_on)],
  ];
  const letterText = letter ?? offer.letter_body ?? "";

  return (
    <div className="space-y-5">
      <Link href={offer.candidate_id ? `/recruitment/candidates/${offer.candidate_id}?application=${offer.application}` : "/recruitment/offers"} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to candidate</Link>

      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <Avatar name={offer.candidate_name ?? "Candidate"} size="lg" className="!h-[4.5rem] !w-[4.5rem] !text-[1.5rem]" />
          <div>
            <div className="flex flex-wrap items-center gap-3"><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline">{offer.candidate_name}</h1><StatusBadge status={offer.status === "EXTENDED" ? "SENT" : offer.status} /></div>
            <p className="text-[1.125rem] font-medium text-heading-support">{offer.job_title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-support text-ink-muted">
              <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4" aria-hidden="true" />{offer.department_name}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden="true" />{offer.location_name}</span>
              {offer.job_posting_id && <Link href={`/recruitment/job-postings/${offer.job_posting_id}`} className="inline-flex items-center gap-1.5 hover:underline"><CalendarDays className="h-4 w-4" aria-hidden="true" />{offer.job_code}</Link>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("offer.manage") && ["DRAFT", "PENDING_APPROVAL", "APPROVED", "EXTENDED"].includes(offer.status) || (offer.status === "DRAFT" && canApprove) ? (
            <Menu label="More actions" trigger={(props) => <Button {...props} variant="secondary" size="lg" aria-label="More actions"><MoreHorizontal className="h-5 w-5" /></Button>}>
              {(close) => (
                <div className="p-1.5">
                  {offer.status === "DRAFT" && canApprove && hasPay && <MenuItem icon={<Send className="h-4 w-4" />} description="Records you as the approver" onSelect={() => { close(); setDialog("send"); }}>Approve and send now</MenuItem>}
                  {can("offer.manage") && ["DRAFT", "PENDING_APPROVAL", "APPROVED", "EXTENDED"].includes(offer.status) && <MenuItem tone="danger" icon={<XCircle className="h-4 w-4" />} onSelect={() => { close(); setDialog("withdraw"); }}>Withdraw offer</MenuItem>}
                </div>
              )}
            </Menu>
          ) : null}
          {canEdit && <Button size="lg" variant="secondary" leadingIcon={<Pencil className="h-5 w-5" />} onClick={() => setDialog("terms")}>Edit</Button>}
          {primary}
        </div>
      </header>

      {problem && <ErrorState variant="inline" title="Action not completed" message={problem} />}

      <section className="rounded-2xl border border-line bg-surface px-4 py-4 shadow-elevation-1">
        <h2 className="text-heading font-bold text-headline">Offer lifecycle</h2>
        <ol className="mt-3 grid grid-cols-5" aria-label="Offer lifecycle">
          {steps.map((step, index) => (
            <li key={step.name} className="relative flex flex-col items-center gap-1 text-center" aria-current={step.active ? "step" : undefined}>
              {index > 0 && <span aria-hidden="true" className={cx("absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2", step.done || step.active ? "bg-primary" : "bg-line")} />}
              <span className={cx("relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2", step.danger ? "border-danger bg-danger text-white" : step.done ? "border-primary bg-primary text-white" : step.active ? "border-primary bg-surface ring-4 ring-primary-soft" : "border-line-strong bg-surface")}>{(step.done || step.danger) && <Check className="h-4 w-4" aria-hidden="true" />}</span>
              <span className={cx("text-sm font-semibold", step.active ? "text-primary-ink" : step.done ? "text-ink-strong" : "text-ink-muted")}>{step.name}</span>
              <span className="text-caption text-ink-muted">{step.note}</span>
            </li>
          ))}
        </ol>
      </section>

      <Tabs label="Offer sections" value={tab} onChange={(value) => setTab(value as Tab)} items={[{ value: "overview", label: "Overview" }, { value: "letter", label: "Offer letter" }, { value: "approvals", label: "Approvals" }, { value: "activity", label: "Activity" }]} />

      {tab === "overview" && (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <div className="space-y-5">
            <Panel icon={FileText} title="Compensation and terms" description="Employment details for this offer." action={canEdit ? <Button variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />} onClick={() => setDialog("terms")}>Edit</Button> : undefined}>
              {!hasPay && (
                <div className="mb-4 rounded-xl bg-primary-soft/60 p-4 text-sm">
                  <p className="flex gap-2 font-semibold text-headline"><Info className="h-5 w-5 shrink-0" aria-hidden="true" />No compensation details added yet</p>
                  <p className="mt-1 text-ink">Add salary and employment terms to include in the offer letter. This information is visible to approvers and recorded in the audit trail.</p>
                  {canEdit && <Button className="mt-3" variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setDialog("terms")}>Add compensation and terms</Button>}
                </div>
              )}
              <dl className="space-y-2.5 text-sm">
                {terms.map(([Icon, label, text]) => <div key={label} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3"><dt className="flex items-center gap-2 text-ink"><Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />{label}</dt><dd className="font-medium text-ink-strong">{text}</dd></div>)}
              </dl>
              {offer.terms && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-sm text-ink">{offer.terms}</p>}
            </Panel>
            <ApprovalsPanel offer={offer} canApprove={canApprove} isSubmitter={isSubmitter} busy={busy} comment={comment} setComment={setComment}
              onApprove={() => void run(() => recruitmentApi.approveOffer(id, comment.trim()))} onReturn={() => void run(() => recruitmentApi.returnOffer(id, comment.trim()))} onOpen={() => setTab("approvals")} />
          </div>
          <div className="space-y-5">
            <Panel icon={FileSignature} title="Offer letter" description="Preview and manage the offer letter for this candidate." action={canEdit ? <Button variant="secondary" leadingIcon={<FileText className="h-4 w-4" />} loading={busy && dialog === null && tab === "overview"} onClick={() => void run(() => recruitmentApi.generateOfferLetter(id), () => setLetter(null))}>{offer.letter_body ? "Regenerate" : "Generate offer letter"}</Button> : undefined}>
              {offer.letter_body ? (
                <>
                  <pre className="max-h-64 overflow-hidden whitespace-pre-wrap rounded-xl bg-surface-muted p-4 font-sans text-sm text-ink [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">{offer.letter_body}</pre>
                  <div className="mt-3 flex items-center justify-between text-caption text-ink-muted"><span>Generated {formatDateTime(offer.letter_generated_at)}</span><button type="button" onClick={() => setTab("letter")} className="font-semibold text-primary-ink hover:underline">Open full letter</button></div>
                </>
              ) : (
                <Empty icon={FileText} title="No offer letter generated yet" text="Generate the letter from the compensation and terms. You can review and edit it before sending." />
              )}
            </Panel>
            <Panel icon={UserRound} title="Candidate response" description="Track the candidate's response to the offer." action={offer.status === "EXTENDED" && can("offer.manage") ? <Button variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />} onClick={() => setDialog("response")}>Record response</Button> : undefined}>
              {offer.status === "ACCEPTED" || offer.status === "HIRED" || offer.status === "DECLINED" ? (
                <div className={cx("rounded-xl p-4 text-sm", offer.status === "DECLINED" ? "bg-danger-soft" : "bg-success-soft")}>
                  <p className={cx("font-semibold", offer.status === "DECLINED" ? "text-danger-ink" : "text-success-ink")}>{offer.status === "DECLINED" ? "Declined" : "Accepted"} {formatDate(offer.accepted_at ?? offer.declined_at)}</p>
                  {offer.response_note && <p className="mt-1 text-ink">{offer.response_note}</p>}
                  {offer.response_recorded_by_name && <p className="mt-1 text-caption text-ink-muted">Recorded by {offer.response_recorded_by_name}</p>}
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl bg-surface-muted p-4 text-sm"><Hourglass className="h-6 w-6 text-headline" aria-hidden="true" /><div><p className="font-semibold text-headline">Response pending</p><p className="text-ink">{offer.status === "EXTENDED" ? `Sent ${formatDate(offer.extended_at)}${offer.expires_on ? `; expires ${formatDate(offer.expires_on)}` : ""}.` : offer.status === "WITHDRAWN" ? "The offer was withdrawn." : "The offer has not been sent to the candidate yet."}</p></div></div>
              )}
            </Panel>
            <Panel icon={Clock3} title="Activity timeline" description="Key events in the offer process."><Timeline offer={offer} entries={activity.slice(0, 5)} /></Panel>
          </div>
        </div>
      )}

      {tab === "letter" && (
        <Panel icon={FileSignature} title="Offer letter" description={offer.letter_generated_at ? `Generated ${formatDateTime(offer.letter_generated_at)}. Edits are saved to the offer.` : "Generate the letter from the offer terms."}
          action={<div className="flex gap-2">{canEdit && <Button variant="secondary" onClick={() => void run(() => recruitmentApi.generateOfferLetter(id), () => setLetter(null))}>{offer.letter_body ? "Regenerate" : "Generate"}</Button>}{offer.letter_body && <Button variant="secondary" leadingIcon={<Printer className="h-4 w-4" />} onClick={() => printLetter(offer)}>Print</Button>}</div>}>
          {canEdit ? (
            <>
              <textarea rows={22} value={letterText} onChange={(event) => setLetter(event.target.value)} className="w-full rounded-xl border border-line-strong bg-surface p-4 font-sans text-sm leading-6" aria-label="Offer letter" />
              <div className="mt-3 flex justify-end gap-2">{letter !== null && <Button variant="ghost" onClick={() => setLetter(null)}>Discard edits</Button>}<Button disabled={letter === null} loading={busy} onClick={() => void run(() => recruitmentApi.updateOffer(id, { letter_body: letterText }), () => setLetter(null))}>Save letter</Button></div>
            </>
          ) : offer.letter_body ? <pre className="whitespace-pre-wrap rounded-xl bg-surface-muted p-5 font-sans text-sm leading-6 text-ink">{offer.letter_body}</pre> : <Empty icon={FileText} title="No offer letter yet" text="The letter appears here once generated." />}
        </Panel>
      )}

      {tab === "approvals" && (
        <ApprovalsPanel offer={offer} canApprove={canApprove} isSubmitter={isSubmitter} busy={busy} comment={comment} setComment={setComment} expanded
          onApprove={() => void run(() => recruitmentApi.approveOffer(id, comment.trim()))} onReturn={() => void run(() => recruitmentApi.returnOffer(id, comment.trim()))} onOpen={() => undefined} />
      )}

      {tab === "activity" && <Panel icon={Clock3} title="Activity timeline" description="Every recorded event for this offer."><Timeline offer={offer} entries={activity} /></Panel>}

      {dialog === "terms" && <TermsDialog offer={offer} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); reload(); }} />}
      <ConfirmDialog open={dialog === "submit"} title="Submit offer for approval?" description="Approvers are notified. The offer can't be edited while it is pending." confirmLabel="Submit" loading={busy} onCancel={() => setDialog(null)} onConfirm={() => void run(() => recruitmentApi.submitOfferForApproval(id))} />
      <ConfirmDialog open={dialog === "send"} title={offer.status === "DRAFT" ? "Approve and send the offer?" : "Send the offer?"} description={offer.status === "DRAFT" ? "You'll be recorded as the approver. The application moves to Offered." : "The application moves to Offered and the candidate's response can then be recorded."} confirmLabel="Send offer" loading={busy} onCancel={() => setDialog(null)} onConfirm={() => void run(() => recruitmentApi.offerAction(id, "extend"))} />
      <ConfirmDialog open={dialog === "withdraw"} record={{ name: offer.candidate_name ?? "Candidate", detail: offer.job_title }} title="Withdraw offer?" description="The offer is closed and the application returns to the active pipeline." confirmLabel="Withdraw" destructive loading={busy} onCancel={() => setDialog(null)} onConfirm={() => void run(() => recruitmentApi.offerAction(id, "withdraw"))} />
      <ConfirmDialog open={dialog === "hire"} tone="approval" record={{ name: offer.candidate_name ?? "Candidate", detail: `${offer.position_title ?? offer.job_title} · starts ${formatDate(offer.proposed_start_date)}` }} title="Complete the hire?" description="Creates the employee record, current employment and compensation from this offer, and marks the candidate hired." confirmLabel="Complete hire" loading={busy} onCancel={() => setDialog(null)} onConfirm={() => void run(() => recruitmentApi.hireOfferCandidate(id), (value) => { const hired = value as { employee_id: string }; if (hired?.employee_id) router.push(`/hr/employees/${hired.employee_id}`); })} />
      <Dialog open={dialog === "response"} onClose={() => setDialog(null)} title="Record candidate response" description="Record how the candidate responded to the offer."
        footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button variant={accepted ? "primary" : "danger"} loading={busy} onClick={() => void run(() => recruitmentApi.recordOfferResponse(id, accepted, comment.trim()))}>{accepted ? "Record acceptance" : "Record decline"}</Button></>}>
        <div className="space-y-3">
          <fieldset className="flex gap-4"><legend className="sr-only">Response</legend>
            <label className="inline-flex items-center gap-2 text-sm"><input type="radio" checked={accepted} onChange={() => setAccepted(true)} className="h-4 w-4" />Accepted</label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="radio" checked={!accepted} onChange={() => setAccepted(false)} className="h-4 w-4" />Declined</label>
          </fieldset>
          <label className="block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Note (optional)</span><textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="e.g. Accepted by email on 3 October" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
        </div>
      </Dialog>
    </div>
  );
}

function printLetter(offer: RecruitmentOffer) {
  const popup = window.open("", "_blank", "noopener,width=800,height=900");
  if (!popup) return;
  const escaped = (offer.letter_body ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  popup.document.write(`<!doctype html><title>Offer letter – ${offer.candidate_name ?? ""}</title><body style="font-family:Arial,sans-serif;max-width:680px;margin:48px auto;line-height:1.6;white-space:pre-wrap">${escaped}</body>`);
  popup.document.close();
  popup.print();
}

function ApprovalsPanel({ offer, canApprove, isSubmitter, busy, comment, setComment, onApprove, onReturn, onOpen, expanded }: { offer: RecruitmentOffer; canApprove: boolean; isSubmitter: boolean; busy: boolean; comment: string; setComment: (value: string) => void; onApprove: () => void; onReturn: () => void; onOpen: () => void; expanded?: boolean }) {
  const pending = offer.status === "PENDING_APPROVAL";
  return (
    <Panel icon={UsersRound} title="Approvals" description="Approval status for this offer." action={!expanded ? <Button variant="secondary" onClick={onOpen}>View approval workflow</Button> : undefined}>
      {offer.status === "DRAFT" && !offer.submitted_at ? (
        <div className="flex gap-3 rounded-xl bg-primary-soft/60 p-4 text-sm"><Info className="h-6 w-6 shrink-0 text-headline" aria-hidden="true" /><div><p className="font-semibold text-headline">Approval not started</p><p className="text-ink">Submit the offer for approval to route it to an HR Admin, Director or Institution Admin other than you.</p></div></div>
      ) : (
        <ol className="space-y-3 text-sm">
          <Step done title="Submitted for approval" detail={`${offer.submitted_by_name ?? EM_DASH}${offer.submitted_at ? ` · ${formatDateTime(offer.submitted_at)}` : ""}`} />
          {offer.status === "DRAFT" && offer.approval_note && <Step done={false} danger title="Returned for changes" detail={offer.approval_note} />}
          {pending ? (
            <li className="rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
              <p className="font-semibold text-ink-strong">Awaiting approval</p>
              {canApprove && !isSubmitter ? (
                <div className="mt-2 space-y-2">
                  <textarea rows={3} value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} placeholder="Comment (required to return for changes)" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" aria-label="Decision comment" />
                  <div className="flex flex-wrap gap-2"><Button loading={busy} leadingIcon={<Check className="h-4 w-4" />} onClick={onApprove}>Approve</Button><Button variant="secondary" leadingIcon={<Undo2 className="h-4 w-4" />} disabled={busy || !comment.trim()} onClick={onReturn}>Return for changes</Button></div>
                </div>
              ) : <p className="text-caption text-ink-muted">{isSubmitter ? "You submitted this offer, so someone else must approve it." : "An approver will review it."}</p>}
            </li>
          ) : offer.approved_by_name ? <Step done title="Approved" detail={`${offer.approved_by_name}${offer.approved_at ? ` · ${formatDateTime(offer.approved_at)}` : ""}${offer.approval_note ? ` · “${offer.approval_note}”` : ""}`} /> : null}
        </ol>
      )}
    </Panel>
  );
}

function Step({ done, danger, title, detail }: { done: boolean; danger?: boolean; title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span className={cx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", danger ? "bg-warning text-white" : done ? "bg-success text-white" : "border-2 border-line-strong")}>{(done || danger) && <Check className="h-3.5 w-3.5" aria-hidden="true" />}</span>
      <span><span className="block font-semibold text-ink-strong">{title}</span><span className="text-caption text-ink-muted">{detail}</span></span>
    </li>
  );
}

function Timeline({ offer, entries }: { offer: RecruitmentOffer; entries: RequisitionHistoryEntry[] }) {
  const [filter, setFilter] = useState("all");
  const rows = useMemo(() => entries.filter((entry) => filter === "all" || (filter === "approval" ? /submitted|approved|returned/.test(entry.action) : /extended|accepted|declined|withdrawn|hired/.test(entry.action))), [entries, filter]);
  return (
    <>
      {entries.length > 0 && <select aria-label="Filter activity" value={filter} onChange={(event) => setFilter(event.target.value)} className="mb-3 h-9 rounded-lg border border-line bg-surface px-2 text-sm"><option value="all">All activity</option><option value="approval">Approvals</option><option value="candidate">Candidate</option></select>}
      <ol className="space-y-3">
        {rows.map((entry) => (
          <li key={entry.id} className="flex gap-3 text-sm"><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-headline" /><span className="flex-1"><span className="block font-semibold text-ink-strong">{ACTIVITY_LABELS[entry.action] ?? humanizeEnum(entry.action.split(".").slice(-1)[0])}</span><span className="text-caption text-ink-muted">{formatDateTime(entry.created_at)}</span>{typeof entry.metadata?.comment === "string" && entry.metadata.comment && <span className="block text-caption text-ink">“{entry.metadata.comment}”</span>}</span><span className="text-caption text-ink-muted">{entry.actor}</span></li>
        ))}
        <li className="flex gap-3 text-sm"><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-headline" /><span className="flex-1"><span className="block font-semibold text-ink-strong">Offer created</span><span className="text-caption text-ink-muted">{formatDateTime(offer.created_at)}</span></span></li>
        {!entries.length && <li className="flex gap-3 text-sm"><span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-line-strong" /><span><span className="block text-ink-strong">No further activity</span><span className="text-caption text-ink-muted">Activity will appear here as the offer progresses.</span></span></li>}
      </ol>
    </>
  );
}

function TermsDialog({ offer, onClose, onSaved }: { offer: RecruitmentOffer; onClose: () => void; onSaved: () => void }) {
  const load = useCallback(async () => {
    const [lookups, structures] = await Promise.all([organizationApi.loadOrganizationLookups(), (isModuleOffered("PAYROLL") ? payrollApi.listSalaryStructures({ is_active: true, page_size: 100 }).then((page) => page.results).catch(() => []) : Promise.resolve([]))]);
    return { lookups, structures };
  }, []);
  const { data } = useApiResource(load);
  const [form, setForm] = useState({
    salary_structure: offer.salary_structure ?? "", base_salary: offer.base_salary ?? "", currency: offer.currency || "GHS",
    contract_length_months: offer.contract_length_months ? String(offer.contract_length_months) : "", working_pattern: offer.working_pattern ?? "",
    reports_to: offer.reports_to ?? "", proposed_start_date: offer.proposed_start_date, expires_on: offer.expires_on ?? "", grade: offer.grade, terms: offer.terms ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const update = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm";
  const save = async () => {
    if (Boolean(form.base_salary) !== Boolean(form.salary_structure)) { setProblem("Choose a salary structure and enter the base salary together."); return; }
    setBusy(true);
    setProblem(null);
    try {
      await recruitmentApi.updateOffer(offer.id, {
        salary_structure: form.salary_structure || null, base_salary: form.base_salary || null, currency: form.salary_structure ? form.currency.toUpperCase() : "",
        contract_length_months: form.contract_length_months ? Number(form.contract_length_months) : null, working_pattern: form.working_pattern,
        reports_to: form.reports_to || null, proposed_start_date: form.proposed_start_date, expires_on: form.expires_on || null, grade: form.grade, terms: form.terms,
      });
      onSaved();
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title="Compensation and terms" description={offer.status === "APPROVED" ? "Changing approved terms sends the offer back to draft for re-approval." : "Terms are included in the offer letter and shown to approvers."}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save terms</Button></>}>
      {!data ? <LoadingState /> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {problem && <div className="sm:col-span-2"><ErrorState variant="inline" title="Not saved" message={problem} /></div>}
          {isModuleOffered("PAYROLL") && <><label><span className="mb-1.5 block text-sm font-semibold">Salary structure</span><select value={form.salary_structure} onChange={(event) => update("salary_structure", event.target.value)} className={inputClass}><option value="">{data.structures.length ? "Select structure" : "No structures available to you"}</option>{data.structures.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Monthly base salary</span><div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2"><input aria-label="Currency" maxLength={3} value={form.currency} onChange={(event) => update("currency", event.target.value.toUpperCase())} className={inputClass} /><input type="number" min={0} step="0.01" value={form.base_salary} onChange={(event) => update("base_salary", event.target.value)} className={inputClass} /></div></label></>}
          <label><span className="mb-1.5 block text-sm font-semibold">Grade</span><select value={form.grade} onChange={(event) => update("grade", event.target.value)} className={inputClass}>{data.lookups.grades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Contract length (months)</span><input type="number" min={1} max={120} value={form.contract_length_months} onChange={(event) => update("contract_length_months", event.target.value)} placeholder="Leave blank if permanent" className={inputClass} /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Start date</span><input type="date" value={form.proposed_start_date} onChange={(event) => update("proposed_start_date", event.target.value)} className={inputClass} /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Offer expires on</span><input type="date" value={form.expires_on} onChange={(event) => update("expires_on", event.target.value)} className={inputClass} /></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Working pattern</span><select value={form.working_pattern} onChange={(event) => update("working_pattern", event.target.value)} className={inputClass}><option value="">Not set</option>{WORKING_PATTERNS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <label><span className="mb-1.5 block text-sm font-semibold">Reporting to</span><select value={form.reports_to} onChange={(event) => update("reports_to", event.target.value)} className={inputClass}><option value="">Not set</option>{data.lookups.positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Additional terms</span><textarea rows={4} value={form.terms} onChange={(event) => update("terms", event.target.value)} placeholder="Benefits, probation, conditions…" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
        </div>
      )}
    </Dialog>
  );
}

function Panel({ icon: Icon, title, description, action, children }: { icon: typeof FileText; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3"><Icon className="mt-0.5 h-7 w-7 shrink-0 text-section-icon" aria-hidden="true" /><div><h2 className="text-heading font-bold text-headline">{title}</h2><p className="text-support text-heading-support">{description}</p></div></div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ icon: Icon, title, text }: { icon: typeof FileText; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-surface-muted/60 px-4 py-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-section-icon"><Icon className="h-6 w-6" aria-hidden="true" /></span>
      <p className="mt-2 font-bold text-headline">{title}</p>
      <p className="mt-0.5 max-w-sm text-support text-ink-muted">{text}</p>
    </div>
  );
}
