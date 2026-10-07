"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Eye, Info, Lock, Save, Send } from "lucide-react";

import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog } from "@/components/ui/Overlay";
import { getApiErrorMessage, organizationApi, recruitmentApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { HIRING_REASONS, INTERVIEW_PLANS, type JobPosting, type JobPostingPayload } from "@/types/recruitment";

const EMPLOYMENT_TYPES: Array<[string, string]> = [["PERMANENT", "Permanent"], ["CONTRACT", "Contract"], ["TEMPORARY", "Temporary"], ["INTERN", "Intern"], ["CASUAL", "Casual"]];
const LIMIT = 2000;

type FormState = Record<"title" | "description" | "department" | "position" | "location" | "employment_type" | "hiring_reason" | "responsibilities" | "qualifications_essential" | "qualifications_desirable" | "openings" | "target_start_date" | "salary_currency" | "salary_min" | "salary_max" | "hiring_manager" | "interview_plan" | "grade" | "reports_to" | "closes_on", string>;

function toForm(posting?: JobPosting | null): FormState {
  return {
    title: posting?.title ?? "",
    description: posting?.description ?? "",
    department: posting?.department ?? "",
    position: posting?.position ?? "",
    location: posting?.location ?? "",
    employment_type: posting?.employment_type ?? "",
    hiring_reason: posting?.hiring_reason ?? "",
    responsibilities: posting?.responsibilities ?? "",
    qualifications_essential: posting?.qualifications_essential ?? "",
    qualifications_desirable: posting?.qualifications_desirable ?? "",
    openings: String(posting?.openings ?? 1),
    target_start_date: posting?.target_start_date ?? "",
    salary_currency: posting?.salary_currency || "GHS",
    salary_min: posting?.salary_min ?? "",
    salary_max: posting?.salary_max ?? "",
    hiring_manager: posting?.hiring_manager ?? "",
    interview_plan: posting?.interview_plan ?? "",
    grade: posting?.grade ?? "",
    reports_to: posting?.reports_to ?? "",
    closes_on: posting?.closes_on ?? "",
  };
}

function toPayload(form: FormState): JobPostingPayload {
  const empty = (value: string) => (value.trim() ? value.trim() : null);
  return {
    title: form.title.trim(),
    description: form.description,
    department: form.department,
    position: form.position,
    location: form.location,
    employment_type: form.employment_type,
    hiring_reason: form.hiring_reason,
    responsibilities: form.responsibilities,
    qualifications_essential: form.qualifications_essential,
    qualifications_desirable: form.qualifications_desirable,
    openings: Math.max(1, Number(form.openings) || 1),
    target_start_date: empty(form.target_start_date),
    salary_currency: form.salary_min || form.salary_max ? form.salary_currency : "",
    salary_min: empty(form.salary_min),
    salary_max: empty(form.salary_max),
    hiring_manager: empty(form.hiring_manager),
    interview_plan: form.interview_plan,
    grade: empty(form.grade),
    reports_to: empty(form.reports_to),
    closes_on: empty(form.closes_on),
  };
}

/** Concept "Create requisition" (option 3); also used to edit a draft or approved requisition. */
export default function RequisitionForm({ posting }: { posting?: JobPosting | null }) {
  const router = useRouter();
  const load = useCallback(async () => {
    const [lookups, people] = await Promise.all([organizationApi.loadOrganizationLookups(), recruitmentApi.listRecruitmentPeople().catch(() => [])]);
    return { lookups, people };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const [form, setForm] = useState<FormState>(() => toForm(posting));
  const [savedId, setSavedId] = useState<string | null>(posting?.id ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(posting?.updated_at ?? null);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [errors, setErrors] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const update = (field: keyof FormState, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const positions = useMemo(() => data?.lookups.positions.filter((position) => !form.department || position.department === form.department) ?? [], [data, form.department]);
  const detailsDone = Boolean(form.title && form.department && form.position && form.location && form.employment_type && form.hiring_reason);
  const briefDone = Boolean(form.responsibilities.trim() && form.qualifications_essential.trim());
  const planDone = Boolean(form.openings && form.target_start_date && form.hiring_manager);
  const step = !detailsDone || !briefDone ? 1 : !planDone ? 2 : 3;

  const save = async (mode: "draft" | "submit") => {
    if (!form.title || !form.department || !form.position || !form.location || !form.employment_type) {
      setErrors("Job title, department / functional area, position, location and employment type are needed to save.");
      return;
    }
    setSaving(mode);
    setErrors(null);
    try {
      const payload = toPayload(form);
      const saved = savedId ? await recruitmentApi.updateJobPosting(savedId, payload) : await recruitmentApi.createJobPosting(payload);
      setSavedId(saved.id);
      setSavedAt(saved.updated_at);
      if (mode === "submit") {
        await recruitmentApi.submitJobPostingForApproval(saved.id);
        router.push(`/recruitment/job-postings/${saved.id}`);
      }
    } catch (caught) {
      setErrors(getApiErrorMessage(caught));
    } finally {
      setSaving(null);
    }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load organisation choices."} onRetry={reload} />;
  const { lookups, people } = data;
  const label = (list: Array<{ id: string; name?: string; title?: string }>, id: string) => list.find((item) => item.id === id)?.name ?? list.find((item) => item.id === id)?.title ?? "—";

  return (
    <div className="space-y-5 pb-24">
      <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">{posting ? "Edit requisition" : "Create requisition"}</h1>
          <p className="mt-1.5 text-[1.0625rem] text-heading-support">Define the role, set the hiring plan and submit for approval.</p>
        </div>
        <ol className="flex flex-wrap items-center gap-3" aria-label="Requisition progress">
          {["Requisition details", "Hiring plan", "Review & submit"].map((name, index) => {
            const number = index + 1;
            const active = step === number;
            const done = step > number;
            return (
              <li key={name} className="flex items-center gap-3">
                {index > 0 && <span aria-hidden="true" className="hidden h-px w-8 bg-line sm:block" />}
                <span className={cx("flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold", active ? "bg-primary text-white" : done ? "bg-primary-soft text-primary-ink" : "bg-surface-muted text-ink-muted")} aria-current={active ? "step" : undefined}>{number}</span>
                <span className={cx("text-sm font-semibold", active ? "text-headline" : "text-ink-muted")}>{name}</span>
              </li>
            );
          })}
        </ol>
      </header>

      {posting?.approval_note && posting.status === "DRAFT" && (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning-ink"><p className="font-semibold">Returned for changes</p><p className="mt-0.5">{posting.approval_note}</p></div>
      )}
      {errors && <ErrorState variant="inline" title="Requisition not saved" message={errors} />}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="space-y-8 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6">
          <div>
            <h2 className="text-heading font-bold text-headline">1. Requisition details</h2>
            <p className="text-support text-ink-muted">Start with the essentials. Fields marked with <span className="text-danger-ink">*</span> are required.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <FormField label="Job title" required><input value={form.title} maxLength={200} onChange={(event) => update("title", event.target.value)} placeholder="e.g. Senior Research Officer" className={inputClass} /></FormField>
              <FormField label="Department / Functional Area" required><select value={form.department} onChange={(event) => { update("department", event.target.value); update("position", ""); }} className={inputClass}><option value="">Select department / functional area</option>{lookups.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
              <FormField label="Position" required><select value={form.position} disabled={!form.department} onChange={(event) => update("position", event.target.value)} className={inputClass}><option value="">{form.department ? "Select position" : "Choose a department / functional area first"}</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></FormField>
              <FormField label="Location" required><select value={form.location} onChange={(event) => update("location", event.target.value)} className={inputClass}><option value="">Select location</option>{lookups.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
              <FormField label="Employment type" required><select value={form.employment_type} onChange={(event) => update("employment_type", event.target.value)} className={inputClass}><option value="">Select employment type</option>{EMPLOYMENT_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></FormField>
              <FormField label="Hiring reason" required><select value={form.hiring_reason} onChange={(event) => update("hiring_reason", event.target.value)} className={inputClass}><option value="">Select hiring reason</option>{HIRING_REASONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></FormField>
            </div>
          </div>
          <div className="border-t border-line-soft pt-6">
            <h2 className="text-heading font-bold text-headline">2. Role brief</h2>
            <p className="text-support text-ink-muted">Provide a clear and compelling role brief to attract the right candidates.</p>
            <div className="mt-5 space-y-4">
              <LongText label="Role summary" value={form.description} onChange={(value) => update("description", value)} placeholder="A short summary of the role, its purpose and what the successful candidate will do…" />
              <LongText label="Key responsibilities" required value={form.responsibilities} onChange={(value) => update("responsibilities", value)} placeholder="Enter the main responsibilities for this role… (one per line)" />
              <LongText label="Required qualifications and experience" required value={form.qualifications_essential} onChange={(value) => update("qualifications_essential", value)} placeholder="Enter the required qualifications, skills and experience… (one per line)" />
              <LongText label="Desirable qualifications" value={form.qualifications_desirable} onChange={(value) => update("qualifications_desirable", value)} placeholder="Nice-to-have experience or credentials… (one per line)" />
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="text-heading font-bold text-headline">Hiring plan summary</h2>
            <p className="text-support text-heading-support">Set the key details for this requisition.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FormField label="Target headcount" required><input type="number" min={1} value={form.openings} onChange={(event) => update("openings", event.target.value)} className={inputClass} /></FormField>
              <FormField label="Proposed start date" required><input type="date" value={form.target_start_date} onChange={(event) => update("target_start_date", event.target.value)} className={inputClass} /></FormField>
            </div>
            <FormField label="Compensation range" className="mt-4">
              <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <input aria-label="Currency" value={form.salary_currency} maxLength={3} onChange={(event) => update("salary_currency", event.target.value.toUpperCase())} className={inputClass} />
                <input aria-label="Minimum" type="number" min={0} value={form.salary_min} onChange={(event) => update("salary_min", event.target.value)} placeholder="Min" className={inputClass} />
                <span className="text-ink-muted">–</span>
                <input aria-label="Maximum" type="number" min={0} value={form.salary_max} onChange={(event) => update("salary_max", event.target.value)} placeholder="Max" className={inputClass} />
              </div>
            </FormField>
            <FormField label="Hiring manager" required className="mt-4"><select value={form.hiring_manager} onChange={(event) => update("hiring_manager", event.target.value)} className={inputClass}><option value="">Select hiring manager</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${person.role}` : ""}</option>)}</select></FormField>
            <FormField label="Interview plan" className="mt-4"><select value={form.interview_plan} onChange={(event) => update("interview_plan", event.target.value)} className={inputClass}><option value="">Select interview plan</option>{INTERVIEW_PLANS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></FormField>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FormField label="Grade"><select value={form.grade} onChange={(event) => update("grade", event.target.value)} className={inputClass}><option value="">Not set</option>{lookups.grades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></FormField>
              <FormField label="Reports to"><select value={form.reports_to} onChange={(event) => update("reports_to", event.target.value)} className={inputClass}><option value="">Not set</option>{lookups.positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></FormField>
            </div>
            <FormField label="Applications close" className="mt-4"><input type="date" value={form.closes_on} onChange={(event) => update("closes_on", event.target.value)} className={inputClass} /></FormField>
            <FormField label="Approval route" className="mt-4">
              <div className="flex h-11 items-center justify-between rounded-lg border border-line bg-surface-muted px-3 text-sm text-ink-muted">Standard HR approval route<Lock className="h-4 w-4" aria-hidden="true" /></div>
              <p className="mt-1 flex items-start gap-1.5 text-caption text-ink-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Approved by an HR Admin, Director or Institution Admin other than the submitter.</p>
            </FormField>
          </section>
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="text-heading font-bold text-headline">Requisition status</h2>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface-muted px-3 py-1 font-semibold text-ink-strong"><span className="h-2.5 w-2.5 rounded-full bg-ink-subtle" aria-hidden="true" />{posting ? humanizeEnum(posting.status) : "Draft"}</p>
            <p className="mt-2 text-support text-ink-muted">This requisition will be saved as a draft until submitted for approval.</p>
          </section>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(15_35_69/0.25)] backdrop-blur lg:left-[var(--shell-sidebar-expanded)]">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button size="lg" variant="secondary" loading={saving === "draft"} loadingLabel="Saving…" leadingIcon={<Save className="h-5 w-5" />} onClick={() => void save("draft")}>Save draft</Button>
            <span className="text-caption text-ink-muted">Last saved: {savedAt ? formatDateTime(savedAt) : "Not yet saved"}</span>
          </div>
          <div className="flex gap-2">
            <Button size="lg" variant="secondary" leadingIcon={<Eye className="h-5 w-5" />} onClick={() => setPreview(true)}>Preview</Button>
            <Button size="lg" loading={saving === "submit"} loadingLabel="Submitting…" leadingIcon={<Send className="h-5 w-5" />} disabled={step < 3 || (posting ? !["DRAFT", "APPROVED"].includes(posting.status) : false)} onClick={() => void save("submit")}>Submit for approval</Button>
          </div>
        </div>
      </div>

      <Dialog open={preview} onClose={() => setPreview(false)} size="lg" title={form.title || "Untitled requisition"} description={`${label(lookups.departments, form.department)} · ${label(lookups.locations, form.location)} · ${form.employment_type ? humanizeEnum(form.employment_type) : "—"}`} footer={<Button onClick={() => setPreview(false)}>Close preview</Button>}>
        <div className="space-y-4 text-sm">
          <PreviewBlock title="Key responsibilities" text={form.responsibilities} />
          <PreviewBlock title="Required qualifications and experience" text={form.qualifications_essential} />
          {form.qualifications_desirable && <PreviewBlock title="Desirable" text={form.qualifications_desirable} />}
          <p className="text-ink-muted">Headcount {form.openings} · Start {form.target_start_date || "—"}{form.salary_min || form.salary_max ? ` · ${form.salary_currency} ${form.salary_min || "…"}–${form.salary_max || "…"}` : ""}</p>
        </div>
      </Dialog>
    </div>
  );
}

const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong disabled:bg-surface-muted";

function FormField({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={cx("block", className)}><span className="mb-1.5 block text-sm font-semibold text-ink-strong">{label}{required && <span className="ml-0.5 text-danger-ink">*</span>}</span>{children}</label>;
}

function LongText({ label, required, value, onChange, placeholder }: { label: string; required?: boolean; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-strong">{label}{required && <span className="ml-0.5 text-danger-ink">*</span>}</span>
      <textarea rows={5} maxLength={LIMIT} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink-strong" />
      <span className="mt-1 block text-right text-caption text-ink-muted">{value.length} / {LIMIT}</span>
    </label>
  );
}

function PreviewBlock({ title, text }: { title: string; text: string }) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <div>
      <p className="font-bold text-headline">{title}</p>
      {lines.length ? <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">{lines.map((line, index) => <li key={index}>{line.replace(/^[-•]\s*/, "")}</li>)}</ul> : <p className="text-ink-muted">Not provided yet.</p>}
    </div>
  );
}
