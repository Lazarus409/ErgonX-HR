"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, CalendarDays, Clock3, FileText, Info, Link2, MapPin, Save, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDate, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { CANDIDATE_DOCUMENT_TYPES, EMPLOYMENT_STATUSES, QUALIFICATIONS, type CandidateDocument, type CandidatePayload } from "@/types/recruitment";

const STEPS = ["Personal details", "Experience and education", "Documents", "Review and submit"];
const DIAL_CODES = ["+233", "+234", "+225", "+254", "+27", "+44", "+1"];
const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong";

class FormProblem extends Error {}

type Form = Record<"first_name" | "last_name" | "email" | "dial" | "phone" | "location" | "employment_status" | "linkedin_url" | "source" | "current_employer" | "current_title" | "years_experience" | "highest_qualification" | "field_of_study" | "education_institution" | "skills" | "notice_period_weeks" | "notes", string>;

const EMPTY: Form = { first_name: "", last_name: "", email: "", dial: "+233", phone: "", location: "", employment_status: "", linkedin_url: "", source: "", current_employer: "", current_title: "", years_experience: "", highest_qualification: "", field_of_study: "", education_institution: "", skills: "", notice_period_weeks: "", notes: "" };

function payloadOf(form: Form): CandidatePayload {
  const number = (value: string) => (value.trim() === "" ? null : Math.max(0, Math.round(Number(value))));
  return {
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    email: form.email.trim(),
    phone: form.phone.trim() ? `${form.dial} ${form.phone.trim()}` : "",
    location: form.location.trim(),
    employment_status: form.employment_status,
    linkedin_url: form.linkedin_url.trim(),
    source: form.source.trim(),
    current_employer: form.current_employer.trim(),
    current_title: form.current_title.trim(),
    years_experience: number(form.years_experience),
    highest_qualification: form.highest_qualification,
    field_of_study: form.field_of_study.trim(),
    education_institution: form.education_institution.trim(),
    skills: form.skills.trim(),
    notice_period_weeks: number(form.notice_period_weeks),
  };
}

/**
 * Concept "Candidate application submission" (option 1), operated by the
 * recruitment team: the candidate is saved after step 1 so work can resume,
 * documents upload against that record, and the last step files the
 * application against an open requisition.
 */
export default function ApplicationWizard({ initialJob }: { initialJob?: string }) {
  const router = useRouter();
  const loadJobs = useCallback(() => recruitmentApi.listJobPostings({ status: "OPEN", page_size: 100 }).then((page) => page.results), []);
  const { data: jobs, loading, error } = useApiResource(loadJobs);
  const [jobId, setJobId] = useState(initialJob ?? "");
  const [changingJob, setChangingJob] = useState(!initialJob);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<Form>(EMPTY);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<CandidateDocument[]>([]);
  const [docType, setDocType] = useState("CV");
  const [uploading, setUploading] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (field: keyof Form, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const job = jobs?.find((item) => item.id === jobId) ?? null;

  const saveCandidate = async () => {
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) throw new FormProblem("First name, last name and email address are required.");
    if (step === 1 && (!form.phone.trim() || !form.location.trim() || !form.employment_status)) throw new FormProblem("Phone number, location and current employment status are required.");
    const payload = payloadOf(form);
    const saved = candidateId ? await recruitmentApi.updateCandidate(candidateId, payload) : await recruitmentApi.createCandidate(payload);
    setCandidateId(saved.id);
    return saved.id;
  };

  const run = async (work: () => Promise<void>) => {
    setSaving(true);
    setProblem(null);
    try {
      await work();
    } catch (caught) {
      setProblem(caught instanceof FormProblem ? caught.message : getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const next = () => run(async () => {
    if (step <= 2) await saveCandidate();
    setStep((current) => Math.min(4, current + 1));
  });
  const later = () => run(async () => {
    const id = await saveCandidate();
    router.push(`/recruitment/candidates/${id}`);
  });
  const submit = () => run(async () => {
    const id = await saveCandidate();
    if (!jobId) {
      router.push(`/recruitment/candidates/${id}`);
      return;
    }
    const application = await recruitmentApi.createApplication({ job_posting: jobId, candidate: id, notes: form.notes.trim() });
    await recruitmentApi.submitApplication(application.id);
    router.push(`/recruitment/candidates/${id}?application=${application.id}`);
  });

  const upload = async (file: File) => {
    if (!candidateId) return;
    setProblem(null);
    setUploading(0);
    try {
      const document = await recruitmentApi.uploadCandidateDocument(candidateId, file, docType, setUploading);
      setDocuments((current) => [document, ...current]);
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const remove = async (document: CandidateDocument) => {
    if (!candidateId) return;
    try {
      await recruitmentApi.removeCandidateDocument(candidateId, document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    }
  };

  if (loading && !jobs) return <LoadingState />;
  if (error && !jobs) return <ErrorState message={error} />;

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-6">
        <Link href="/recruitment/candidates" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to candidates</Link>
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">{job ? "Apply for this role" : "Add candidate"}</h1>
          <p className="mt-1.5 max-w-3xl text-[1.0625rem] text-heading-support">Complete the sections below to submit the application. Progress is saved after each step, so you can come back at any time.</p>
        </div>

        <ol className="grid grid-cols-4" aria-label="Application progress">
          {STEPS.map((name, index) => {
            const number = index + 1;
            const done = step > number;
            const active = step === number;
            return (
              <li key={name} className="relative flex flex-col items-center gap-2 text-center" aria-current={active ? "step" : undefined}>
                {index > 0 && <span aria-hidden="true" className={cx("absolute right-1/2 top-[1.125rem] h-0.5 w-full", step >= number ? "bg-primary" : "bg-line")} />}
                <span className={cx("relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold", active ? "border-primary bg-primary text-white" : done ? "border-primary bg-primary-soft text-primary-ink" : "border-line-strong bg-surface text-ink-muted")}>{number}</span>
                <span className={cx("hidden text-sm font-semibold sm:block", active ? "text-primary-ink" : "text-ink-muted")}>{name}</span>
              </li>
            );
          })}
        </ol>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6">
          {problem && <div className="mb-4"><ErrorState variant="inline" title="Not saved" message={problem} /></div>}

          {step === 1 && (
            <>
              <SectionTitle title="Personal details" text="Tell us about the candidate. Fields marked with an asterisk (*) are required." />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="First name" required><input value={form.first_name} onChange={(event) => update("first_name", event.target.value)} placeholder="Enter first name" className={inputClass} /></Field>
                <Field label="Last name" required><input value={form.last_name} onChange={(event) => update("last_name", event.target.value)} placeholder="Enter last name" className={inputClass} /></Field>
                <Field label="Email address" required><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="name@example.com" className={inputClass} /></Field>
                <Field label="Phone number" required>
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
                    <select aria-label="Country code" value={form.dial} onChange={(event) => update("dial", event.target.value)} className={inputClass}>{DIAL_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select>
                    <input type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="e.g. 24 123 4567" className={inputClass} />
                  </div>
                </Field>
                <Field label="Location" required><input value={form.location} onChange={(event) => update("location", event.target.value)} placeholder="City, country" className={inputClass} /></Field>
                <Field label="Current employment status" required><select value={form.employment_status} onChange={(event) => update("employment_status", event.target.value)} className={inputClass}><option value="">Select an option</option>{EMPLOYMENT_STATUSES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
                <Field label="LinkedIn profile (optional)" className="sm:col-span-2">
                  <div className="relative"><Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input type="url" value={form.linkedin_url} onChange={(event) => update("linkedin_url", event.target.value)} placeholder="https://www.linkedin.com/in/profile" className={cx(inputClass, "pl-9")} /></div>
                </Field>
                <Field label="How did they hear about the role? (optional)" className="sm:col-span-2"><input value={form.source} onChange={(event) => update("source", event.target.value)} placeholder="e.g. LinkedIn, Employee referral, Careers page" className={inputClass} /></Field>
              </div>
              <div className="mt-5 flex gap-3 rounded-xl bg-primary-soft/60 px-4 py-3 text-sm"><Info className="mt-0.5 h-5 w-5 shrink-0 text-primary-ink" aria-hidden="true" /><div><p className="font-semibold text-primary-ink">Keep the profile up to date</p><p className="text-ink">These details are used to contact the candidate about this application and match them with suitable roles.</p></div></div>
            </>
          )}

          {step === 2 && (
            <>
              <SectionTitle title="Experience and education" text="Current role, experience and highest qualification. All fields are optional." />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Current or most recent job title"><input value={form.current_title} onChange={(event) => update("current_title", event.target.value)} className={inputClass} /></Field>
                <Field label="Current or most recent employer"><input value={form.current_employer} onChange={(event) => update("current_employer", event.target.value)} className={inputClass} /></Field>
                <Field label="Years of relevant experience"><input type="number" min={0} max={60} value={form.years_experience} onChange={(event) => update("years_experience", event.target.value)} className={inputClass} /></Field>
                <Field label="Notice period (weeks)"><input type="number" min={0} max={52} value={form.notice_period_weeks} onChange={(event) => update("notice_period_weeks", event.target.value)} className={inputClass} /></Field>
                <Field label="Highest qualification"><select value={form.highest_qualification} onChange={(event) => update("highest_qualification", event.target.value)} className={inputClass}><option value="">Select qualification</option>{QUALIFICATIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
                <Field label="Field of study"><input value={form.field_of_study} onChange={(event) => update("field_of_study", event.target.value)} className={inputClass} /></Field>
                <Field label="Institution attended" className="sm:col-span-2"><input value={form.education_institution} onChange={(event) => update("education_institution", event.target.value)} className={inputClass} /></Field>
                <Field label="Key skills" className="sm:col-span-2"><textarea rows={4} maxLength={2000} value={form.skills} onChange={(event) => update("skills", event.target.value)} placeholder="One skill per line" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm" /></Field>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <SectionTitle title="Documents" text="Upload the CV, cover letter and any supporting documents. Files are stored as confidential." />
              <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border-2 border-dashed border-line-strong p-4">
                <Field label="Document type"><select value={docType} onChange={(event) => setDocType(event.target.value)} className={cx(inputClass, "w-56")}>{CANDIDATE_DOCUMENT_TYPES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>
                <input ref={fileRef} type="file" className="sr-only" id="candidate-file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
                <Button variant="secondary" size="lg" leadingIcon={<Upload className="h-5 w-5" />} loading={uploading !== null} loadingLabel={`Uploading ${uploading ?? 0}%`} onClick={() => fileRef.current?.click()}>Choose file</Button>
                <p className="text-caption text-ink-muted">Any file type, up to 25 MB.</p>
              </div>
              <ul className="mt-4 divide-y divide-line-soft">
                {documents.map((document) => (
                  <li key={document.id} className="flex items-center gap-3 py-2.5">
                    <FileText className="h-5 w-5 text-section-icon" aria-hidden="true" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-ink-strong">{document.original_filename}</span><span className="text-caption text-ink-muted">{CANDIDATE_DOCUMENT_TYPES.find(([value]) => value === document.category)?.[1]} · {Math.max(1, Math.round(document.size_bytes / 1024))} KB</span></span>
                    <Button variant="ghost" size="sm" aria-label={`Remove ${document.original_filename}`} onClick={() => void remove(document)}><Trash2 className="h-4 w-4" /></Button>
                  </li>
                ))}
                {!documents.length && <li className="py-3 text-sm text-ink-muted">No documents uploaded yet. You can continue and add them later.</li>}
              </ul>
            </>
          )}

          {step === 4 && (
            <>
              <SectionTitle title="Review and submit" text={job ? "Check the details below, then submit the application." : "Check the details below. Choose a role in the summary panel to file an application, or save the candidate only."} />
              <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ["Name", `${form.first_name} ${form.last_name}`],
                  ["Email", form.email],
                  ["Phone", form.phone ? `${form.dial} ${form.phone}` : "—"],
                  ["Location", form.location || "—"],
                  ["Employment status", form.employment_status ? humanizeEnum(form.employment_status) : "—"],
                  ["Current role", [form.current_title, form.current_employer].filter(Boolean).join(" at ") || "—"],
                  ["Experience", form.years_experience ? `${form.years_experience} years` : "—"],
                  ["Qualification", QUALIFICATIONS.find(([value]) => value === form.highest_qualification)?.[1] ?? "—"],
                  ["Documents", documents.length ? documents.map((item) => item.original_filename).join(", ") : "None"],
                ].map(([label, value]) => <div key={label}><dt className="font-semibold text-ink-strong">{label}</dt><dd className="text-ink">{value}</dd></div>)}
              </dl>
              <Field label="Application notes (optional)" className="mt-5"><textarea rows={4} value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Anything the hiring team should know" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm" /></Field>
            </>
          )}

          <div className="mt-6 flex flex-col-reverse gap-4 border-t border-line-soft pt-5 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => void later()} disabled={saving} className="flex items-start gap-3 text-left disabled:opacity-50">
              <Save className="mt-0.5 h-6 w-6 text-primary-ink" aria-hidden="true" />
              <span><span className="block font-semibold text-primary-ink">Save and return later</span><span className="text-caption text-ink-muted">Progress is saved to the candidate record.</span></span>
            </button>
            <div className="flex items-center gap-3">
              {step > 1 ? <Button variant="ghost" size="lg" onClick={() => setStep((current) => current - 1)}>Back</Button> : <Link href="/recruitment/candidates" className="px-3 font-semibold text-primary-ink hover:underline">Cancel</Link>}
              {step < 4
                ? <Button size="lg" loading={saving} loadingLabel="Saving…" trailingIcon={<ArrowRight className="h-5 w-5" />} onClick={() => void next()}>Save and continue</Button>
                : <Button size="lg" loading={saving} loadingLabel="Submitting…" onClick={() => void submit()}>{job ? "Submit application" : "Save candidate"}</Button>}
            </div>
          </div>
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-[calc(var(--shell-topbar)+1.5rem)]">
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
          <div className="flex items-center justify-between"><h2 className="text-heading font-bold text-headline">Role summary</h2>{job && <button type="button" onClick={() => setChangingJob((current) => !current)} className="text-sm font-semibold text-primary-ink hover:underline">{changingJob ? "Done" : "Edit"}</button>}</div>
          {(changingJob || !job) && (
            <label className="mt-3 block"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Applying for</span>
              <select value={jobId} onChange={(event) => { setJobId(event.target.value); setChangingJob(false); }} className={inputClass}><option value="">No role yet (save candidate only)</option>{(jobs ?? []).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.code}</option>)}</select>
            </label>
          )}
          {job ? (
            <div className="mt-3">
              <p className="text-[1.125rem] font-bold text-ink-strong">{job.title}</p>
              <ul className="mt-3 space-y-2.5 text-sm text-ink">
                <li className="flex items-center gap-2.5"><Building2 className="h-4 w-4 text-ink-muted" aria-hidden="true" />{job.department_name}</li>
                <li className="flex items-center gap-2.5"><MapPin className="h-4 w-4 text-ink-muted" aria-hidden="true" />{job.location_name}</li>
                <li className="flex items-center gap-2.5"><Clock3 className="h-4 w-4 text-ink-muted" aria-hidden="true" />{humanizeEnum(job.employment_type)}</li>
                <li className="flex items-center gap-2.5"><CalendarDays className="h-4 w-4 text-ink-muted" aria-hidden="true" />{job.closes_on ? `Closes ${formatDate(job.closes_on)}` : "No closing date"}</li>
              </ul>
            </div>
          ) : !jobs?.length && <p className="mt-2 text-sm text-ink-muted">No requisitions are open. The candidate can be saved now and added to a role later.</p>}
        </section>
        <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
          <h2 className="flex items-center gap-2 text-heading font-bold text-headline"><Info className="h-5 w-5 text-section-icon" aria-hidden="true" />Need help?</h2>
          <p className="mt-2 text-sm text-ink">Duplicate email addresses are rejected so each candidate has one record. To add an existing candidate to another role, use their profile instead.</p>
          <Link href="/recruitment/applications/new" className="mt-3 inline-flex h-10 items-center rounded-lg border border-primary px-3 text-sm font-semibold text-primary-ink hover:bg-primary-soft/50">Add existing candidate</Link>
        </section>
      </aside>
    </div>
  );
}

function SectionTitle({ title, text }: { title: string; text: string }) {
  return <div><h2 className="text-heading font-bold text-headline">{title}</h2><p className="text-support text-ink-muted">{text}</p></div>;
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return <label className={cx("block", className)}><span className="mb-1.5 block text-sm font-semibold text-ink-strong">{label}{required && <span className="ml-0.5 text-danger-ink">*</span>}</span>{children}</label>;
}
