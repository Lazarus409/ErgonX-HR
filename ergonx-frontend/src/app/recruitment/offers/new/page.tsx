"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ArrowLeft, FilePlus2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { getApiErrorMessage, organizationApi, recruitmentApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";

const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink-strong";
const EMPLOYMENT_TYPES: Array<[string, string]> = [["PERMANENT", "Permanent"], ["CONTRACT", "Contract"], ["TEMPORARY", "Temporary"], ["INTERN", "Intern"], ["CASUAL", "Casual"]];

/**
 * Starts a draft offer from an application. Placement defaults come from the
 * requisition; compensation and the letter are completed on the offer page.
 */
export default function NewOfferPage() {
  const router = useRouter();
  const [applicationId] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("application") ?? ""));
  const load = useCallback(async () => {
    const [lookups, applications, candidates, postings] = await Promise.all([
      organizationApi.loadOrganizationLookups(),
      recruitmentApi.listApplications({ status: "ACTIVE", page_size: 100 }),
      recruitmentApi.listCandidates({ page_size: 200 }),
      recruitmentApi.listJobPostings({ page_size: 100 }),
    ]);
    return { lookups, applications: applications.results, candidates: candidates.results, postings: postings.results };
  }, []);
  const { data, loading, error } = useApiResource(load);
  const [form, setForm] = useState<Record<string, string>>({ application: applicationId, proposed_start_date: "", expires_on: "" });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const application = data?.applications.find((item) => item.id === form.application);
  const posting = data?.postings.find((item) => item.id === application?.job_posting);
  // Requisition defaults unless the user overrides them.
  const value = (field: string, fallback?: string | null) => form[field] ?? fallback ?? "";
  const department = value("department", posting?.department);
  const positions = data?.lookups.positions.filter((item) => !department || item.department === department) ?? [];
  const update = (field: string, next: string) => setForm((current) => ({ ...current, [field]: next }));
  const name = (candidateId?: string) => { const row = data?.candidates.find((item) => item.id === candidateId); return row ? `${row.first_name} ${row.last_name}` : "Candidate"; };

  const submit = async () => {
    const payload = {
      application: form.application,
      proposed_start_date: form.proposed_start_date,
      expires_on: form.expires_on || null,
      employment_type: value("employment_type", posting?.employment_type),
      department,
      position: value("position", posting?.position),
      grade: value("grade", posting?.grade),
      location: value("location", posting?.location),
      reports_to: value("reports_to", posting?.reports_to) || null,
    };
    if (!payload.application || !payload.proposed_start_date || !payload.department || !payload.position || !payload.grade || !payload.location || !payload.employment_type) {
      setProblem("Application, start date, department / functional area, position, grade, location and employment type are required.");
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const offer = await recruitmentApi.createOffer(payload);
      router.push(`/recruitment/offers/${offer.id}`);
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load offer choices."} />;
  const { lookups } = data;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/recruitment/offers" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to offers</Link>
      <div><h1 className="text-[1.75rem] font-bold leading-9 text-headline sm:text-title">Create offer</h1><p className="mt-1.5 text-heading-support">Start a draft offer. Placement comes from the requisition; add compensation and generate the letter next.</p></div>
      {problem && <ErrorState variant="inline" title="Offer not created" message={problem} />}
      <section className="grid gap-4 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 sm:grid-cols-2 sm:p-6">
        <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Candidate application <span className="text-danger-ink">*</span></span>
          <select value={form.application} onChange={(event) => setForm({ application: event.target.value, proposed_start_date: form.proposed_start_date, expires_on: form.expires_on })} className={inputClass}>
            <option value="">Select an active application</option>
            {data.applications.map((item) => <option key={item.id} value={item.id}>{name(item.candidate)} · {data.postings.find((row) => row.id === item.job_posting)?.title ?? "Role"}</option>)}
          </select>
        </label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Proposed start date <span className="text-danger-ink">*</span></span><input type="date" value={form.proposed_start_date} onChange={(event) => update("proposed_start_date", event.target.value)} className={inputClass} /></label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Offer expires on</span><input type="date" value={form.expires_on} onChange={(event) => update("expires_on", event.target.value)} className={inputClass} /></label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Department / Functional Area <span className="text-danger-ink">*</span></span><select value={department} onChange={(event) => { update("department", event.target.value); update("position", ""); }} className={inputClass}><option value="">Select department / functional area</option>{lookups.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Position <span className="text-danger-ink">*</span></span><select value={value("position", posting?.position)} onChange={(event) => update("position", event.target.value)} className={inputClass}><option value="">Select position</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Grade <span className="text-danger-ink">*</span></span><select value={value("grade", posting?.grade)} onChange={(event) => update("grade", event.target.value)} className={inputClass}><option value="">Select grade</option>{lookups.grades.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Location <span className="text-danger-ink">*</span></span><select value={value("location", posting?.location)} onChange={(event) => update("location", event.target.value)} className={inputClass}><option value="">Select location</option>{lookups.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Employment type <span className="text-danger-ink">*</span></span><select value={value("employment_type", posting?.employment_type)} onChange={(event) => update("employment_type", event.target.value)} className={inputClass}><option value="">Select type</option>{EMPLOYMENT_TYPES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
        <label><span className="mb-1.5 block text-sm font-semibold text-ink-strong">Reporting to</span><select value={value("reports_to", posting?.reports_to)} onChange={(event) => update("reports_to", event.target.value)} className={inputClass}><option value="">Not set</option>{lookups.positions.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <div className="flex justify-end gap-3 sm:col-span-2"><Link href="/recruitment/offers" className="inline-flex h-11 items-center px-3 font-semibold text-primary-ink">Cancel</Link><Button size="lg" loading={saving} leadingIcon={<FilePlus2 className="h-5 w-5" />} onClick={() => void submit()}>Create draft offer</Button></div>
      </section>
    </div>
  );
}
