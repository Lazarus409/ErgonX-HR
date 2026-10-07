"use client";

import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, ClipboardCheck, RotateCcw, Send, Star, Target, UserCheck } from "lucide-react";

import Alert from "@/components/ui/Alert";
import BackNavigation from "@/components/ui/BackNavigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, performanceApi } from "@/lib/api";
import { RATING_LABELS, REVIEW_STATUS_LABELS, REVIEW_STATUS_TONES, type PerformanceReview, type RatingInput } from "@/lib/api/performance";
import { cx } from "@/lib/cx";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

const STAGES = ["SELF_ASSESSMENT", "MANAGER_REVIEW", "HR_REVIEW", "COMPLETED"] as const;

function RatingPicker({ value, onChange, disabled, label }: { value: number | null; onChange: (value: number) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((score) => (
        <button key={score} type="button" role="radio" aria-checked={value === score} disabled={disabled} title={RATING_LABELS[score]} onClick={() => onChange(score)}
          className={cx("h-9 w-9 rounded-lg border text-sm font-semibold transition-colors disabled:cursor-not-allowed", value === score ? "border-primary bg-primary text-white" : "border-line-strong bg-surface text-ink hover:bg-surface-hover", disabled && value !== score && "opacity-50")}>
          {score}
        </button>
      ))}
    </div>
  );
}

function Score({ value }: { value: number | null }) {
  if (!value) return <span className="text-caption text-ink-subtle">Not rated</span>;
  return <span className="text-support"><span className="font-semibold text-ink-strong">{value}</span> <span className="text-ink-muted">{RATING_LABELS[value]}</span></span>;
}

/** One performance review, shown to its employee, reviewer and HR with the parts each may see and edit. */
export default function PerformanceReviewPage() {
  const params = useParams<{ id: string }>();
  const load = useCallback(() => performanceApi.getReview(params.id), [params.id]);
  const { data: review, loading, error, reload } = useApiResource(load);
  if (loading && !review) return <p className="text-support text-ink-muted">Loading review…</p>;
  if (error || !review) return <Alert tone="danger">{error ?? "Review not found."}</Alert>;
  // Re-key the form when the review moves on, so its fields start from the saved values.
  const stage = [review.status, review.self_submitted_at, review.manager_submitted_at, review.signed_off_at, review.hr_comment].join("|");
  return <ReviewBody key={stage} review={review} reload={reload} />;
}

function ReviewBody({ review, reload }: { review: PerformanceReview; reload: () => void }) {
  const id = review.id;
  const [selfRatings, setSelfRatings] = useState<Record<string, RatingInput>>(() => Object.fromEntries(review.ratings.map((row) => [row.competency_id, { competency: row.competency_id, rating: row.self_rating, comment: row.self_comment }])));
  const [managerRatings, setManagerRatings] = useState<Record<string, RatingInput>>(() => Object.fromEntries(review.ratings.map((row) => [row.competency_id, { competency: row.competency_id, rating: row.manager_rating, comment: row.manager_comment }])));
  const [selfSummary, setSelfSummary] = useState(review.self_summary ?? "");
  const [managerSummary, setManagerSummary] = useState(review.manager_summary ?? "");
  const [developmentPlan, setDevelopmentPlan] = useState(review.development_plan ?? "");
  const [overall, setOverall] = useState<number | null>(review.overall_rating);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [hrDialog, setHrDialog] = useState<"sign-off" | "return" | null>(null);
  const [hrComment, setHrComment] = useState("");

  const run = async (work: () => Promise<PerformanceReview>, done: string) => {
    setSaving(true);
    setActionError("");
    setMessage("");
    try { await work(); setMessage(done); setHrDialog(null); reload(); }
    catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const saveSelf = (submit: boolean) => run(() => performanceApi.saveSelfAssessment(id, { ratings: Object.values(selfRatings), summary: selfSummary, submit }), submit ? "Self-assessment submitted to your reviewer." : "Draft saved.");
  const saveManager = (submit: boolean) => run(() => performanceApi.saveManagerReview(id, { ratings: Object.values(managerRatings), summary: managerSummary, development_plan: developmentPlan, overall_rating: overall, submit }), submit ? "Review submitted to HR for sign-off." : "Draft saved.");

  const { viewer } = review;
  const stageIndex = STAGES.indexOf(review.status as (typeof STAGES)[number]);
  const showSelf = review.ratings.some((row) => row.self_rating !== null) || viewer.can_self_assess || review.self_summary;
  const showManager = viewer.can_manager_review || review.ratings.some((row) => row.manager_rating !== null) || review.overall_rating;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <BackNavigation fallback={viewer.is_hr ? `/performance/cycles/${review.cycle}` : "/me/performance"} />
      <PageHeader
        title={viewer.is_employee ? "My performance review" : `Performance review · ${review.employee_name}`}
        description={`${review.cycle_name}${review.reviewer_name ? ` · reviewer ${review.reviewer_name}` : ""}`}
        meta={<Badge tone={REVIEW_STATUS_TONES[review.status]}>{REVIEW_STATUS_LABELS[review.status]}</Badge>}
      />

      {review.status !== "CANCELLED" && (
        <ol className="grid gap-2 sm:grid-cols-4" aria-label="Review stages">
          {STAGES.map((stage, index) => (
            <li key={stage} className={cx("rounded-xl border px-3 py-2 text-caption font-semibold", index < stageIndex ? "border-success/30 bg-success-soft text-success-ink" : index === stageIndex ? "border-primary bg-primary-soft text-primary-ink" : "border-line text-ink-muted")}>
              {index + 1}. {REVIEW_STATUS_LABELS[stage]}
            </li>
          ))}
        </ol>
      )}

      {message && <Alert tone="success" onDismiss={() => setMessage("")}>{message}</Alert>}
      {actionError && <Alert tone="danger" onDismiss={() => setActionError("")}>{actionError}</Alert>}
      {review.hr_comment && review.status === "MANAGER_REVIEW" && viewer.is_reviewer && <Alert tone="warning" title="Returned by HR">{review.hr_comment}</Alert>}
      {viewer.can_self_assess && review.self_assessment_due && <Alert tone="info">Please complete your self-assessment by {formatDate(review.self_assessment_due)}.</Alert>}
      {viewer.is_employee && !viewer.can_self_assess && review.status !== "COMPLETED" && <Alert tone="info">{"Your manager's assessment will be shared with you once HR has signed the review off."}</Alert>}

      <Card title="Competencies" description="Rated from 1 (unsatisfactory) to 5 (outstanding)." icon={ClipboardCheck} accent="hr">
        <ul className="divide-y divide-line-soft">
          {review.ratings.map((row) => (
            <li key={row.competency_id} className="grid gap-4 py-4 lg:grid-cols-[minmax(0,14rem)_1fr_1fr]">
              <div><p className="font-semibold text-ink-strong">{row.competency}</p>{row.description && <p className="mt-0.5 text-caption text-ink-muted">{row.description}</p>}</div>
              {showSelf && (
                <div className="space-y-2">
                  <p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Self</p>
                  {viewer.can_self_assess ? (
                    <>
                      <RatingPicker label={`Self rating for ${row.competency}`} value={selfRatings[row.competency_id]?.rating ?? null} onChange={(value) => setSelfRatings((current) => ({ ...current, [row.competency_id]: { ...current[row.competency_id], rating: value } }))} />
                      <Textarea rows={2} placeholder="Examples that support your rating (optional)" value={selfRatings[row.competency_id]?.comment ?? ""} onChange={(event) => setSelfRatings((current) => ({ ...current, [row.competency_id]: { ...current[row.competency_id], comment: event.target.value } }))} />
                    </>
                  ) : <><Score value={row.self_rating} />{row.self_comment && <p className="text-caption text-ink-muted">{row.self_comment}</p>}</>}
                </div>
              )}
              {showManager && (
                <div className="space-y-2">
                  <p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Manager</p>
                  {viewer.can_manager_review ? (
                    <>
                      <RatingPicker label={`Manager rating for ${row.competency}`} value={managerRatings[row.competency_id]?.rating ?? null} onChange={(value) => setManagerRatings((current) => ({ ...current, [row.competency_id]: { ...current[row.competency_id], rating: value } }))} />
                      <Textarea rows={2} placeholder="Evidence and feedback (optional)" value={managerRatings[row.competency_id]?.comment ?? ""} onChange={(event) => setManagerRatings((current) => ({ ...current, [row.competency_id]: { ...current[row.competency_id], comment: event.target.value } }))} />
                    </>
                  ) : <><Score value={row.manager_rating} />{row.manager_comment && <p className="text-caption text-ink-muted">{row.manager_comment}</p>}</>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {(viewer.can_self_assess || review.self_summary) && (
        <Card title="Self-assessment summary" icon={UserCheck} accent="hr">
          {viewer.can_self_assess ? (
            <div className="space-y-4">
              <Field label="Your summary" helper="Achievements, challenges and what you would like to develop."><Textarea rows={4} value={selfSummary} onChange={(event) => setSelfSummary(event.target.value)} /></Field>
              <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" loading={saving} onClick={() => void saveSelf(false)}>Save draft</Button><Button leadingIcon={<Send className="h-4 w-4" />} loading={saving} onClick={() => void saveSelf(true)}>Submit to reviewer</Button></div>
            </div>
          ) : <p className="whitespace-pre-line text-support text-ink">{review.self_summary}</p>}
        </Card>
      )}

      {(viewer.can_manager_review || review.manager_summary || review.overall_rating) && (
        <Card title="Manager assessment" icon={Star} accent="hr">
          {viewer.can_manager_review ? (
            <div className="space-y-4">
              <Field label="Overall rating" required><RatingPicker label="Overall rating" value={overall} onChange={setOverall} /></Field>
              {overall && <p className="-mt-2 text-caption text-ink-muted">{RATING_LABELS[overall]}</p>}
              <Field label="Summary"><Textarea rows={4} value={managerSummary} onChange={(event) => setManagerSummary(event.target.value)} /></Field>
              <Field label="Development plan" optional><Textarea rows={3} value={developmentPlan} onChange={(event) => setDevelopmentPlan(event.target.value)} placeholder="Training, stretch assignments or support for the next period." /></Field>
              <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" loading={saving} onClick={() => void saveManager(false)}>Save draft</Button><Button leadingIcon={<Send className="h-4 w-4" />} loading={saving} onClick={() => void saveManager(true)}>Submit for HR sign-off</Button></div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-support">Overall: <Score value={review.overall_rating} /></p>
              {review.manager_summary && <p className="whitespace-pre-line text-support text-ink">{review.manager_summary}</p>}
              {review.development_plan && <div><p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Development plan</p><p className="whitespace-pre-line text-support text-ink">{review.development_plan}</p></div>}
            </div>
          )}
        </Card>
      )}

      {review.status === "COMPLETED" && (
        <Card title="Signed off" icon={CheckCircle2} accent="hr">
          <p className="text-support text-ink-muted">Signed off by {review.signed_off_by_name || "HR"} on {formatDate(review.signed_off_at)}.</p>
          {review.hr_comment && <p className="mt-2 whitespace-pre-line text-support text-ink">{review.hr_comment}</p>}
        </Card>
      )}

      {viewer.is_hr && (viewer.can_sign_off || viewer.can_manage) && (
        <Card title="HR actions" icon={Target} accent="hr">
          <div className="flex flex-wrap gap-2">
            {viewer.can_sign_off && <Button leadingIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => { setHrComment(""); setHrDialog("sign-off"); }}>Sign off</Button>}
            {viewer.can_sign_off && <Button variant="secondary" leadingIcon={<RotateCcw className="h-4 w-4" />} onClick={() => { setHrComment(""); setHrDialog("return"); }}>Return to reviewer</Button>}
            {review.status === "SELF_ASSESSMENT" && <Button variant="secondary" loading={saving} onClick={() => void run(() => performanceApi.releaseReview(id), "Released to the reviewer without a self-assessment.")}>Release to reviewer</Button>}
            {viewer.can_manage && <Button variant="ghost" className="text-danger-ink" loading={saving} onClick={() => void run(() => performanceApi.cancelReview(id, "Cancelled by HR"), "Review cancelled.")}>Cancel review</Button>}
          </div>
        </Card>
      )}

      <Dialog open={hrDialog !== null} onClose={() => setHrDialog(null)} title={hrDialog === "return" ? "Return to reviewer" : "Sign off review"} description={hrDialog === "return" ? "Tell the reviewer what to change." : "The employee is notified and can then see the full review."} footer={<><Button variant="secondary" onClick={() => setHrDialog(null)} disabled={saving}>Cancel</Button><Button loading={saving} onClick={() => void (hrDialog === "return" ? run(() => performanceApi.returnReview(id, hrComment), "Returned to the reviewer.") : run(() => performanceApi.signOffReview(id, hrComment), "Review signed off."))}>{hrDialog === "return" ? "Return" : "Sign off"}</Button></>}>
        <Field label={hrDialog === "return" ? "What should change" : "Comment"} required={hrDialog === "return"} optional={hrDialog !== "return"}><Textarea rows={3} value={hrComment} onChange={(event) => setHrComment(event.target.value)} data-autofocus /></Field>
      </Dialog>
    </div>
  );
}
