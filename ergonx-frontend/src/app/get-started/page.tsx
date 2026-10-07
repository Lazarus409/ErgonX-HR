"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Lock, MailCheck } from "lucide-react";

import AuthShell from "@/components/brand/AuthShell";
import Alert from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { authApi, getApiErrorMessage, isApiRequestError } from "@/lib/api";
import type { InstitutionAccessRequestPayload } from "@/lib/api/auth";

const COUNTRIES: Array<[string, string]> = [["GH", "Ghana"], ["NG", "Nigeria"], ["KE", "Kenya"], ["ZA", "South Africa"], ["GB", "United Kingdom"], ["US", "United States"]];
const INSTITUTION_TYPES: Array<[string, string]> = [["PRIVATE", "Private / Commercial"], ["SME", "SME"], ["GOVERNMENT", "Government / Public Sector"], ["NGO", "NGO / Nonprofit"], ["EDUCATION", "Educational Institution"], ["HEALTHCARE", "Healthcare Institution"], ["OTHER", "Other"]];
const SIZES: Array<[string, string]> = [["1-50", "1–50 employees"], ["51-200", "51–200 employees"], ["201-1000", "201–1,000 employees"], ["1000+", "More than 1,000 employees"]];

type FormState = { institution_name: string; institution_type: string; country_code: string; organization_size: string; website_url: string; first_name: string; last_name: string; email: string; phone: string; accepted_terms: boolean; website: string };
const EMPTY: FormState = { institution_name: "", institution_type: "", country_code: "", organization_size: "", website_url: "", first_name: "", last_name: "", email: "", phone: "", accepted_terms: false, website: "" };
type FieldName = keyof FormState;
const SERVER_FIELDS: FieldName[] = ["institution_name", "institution_type", "country_code", "organization_size", "website_url", "email", "phone", "accepted_terms"];

/** Get Started (Stitch S002 visual): request an invitation for a new organization. */
export default function GetStartedPage() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedTo, setSubmittedTo] = useState<string | null>(null);

  const update = <K extends FieldName>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Partial<Record<FieldName, string>> = {};
    if (!form.institution_name.trim()) next.institution_name = "Enter the institution's legal name.";
    if (!form.institution_type) next.institution_type = "Choose an institution type.";
    if (!form.country_code) next.country_code = "Choose a country.";
    if (!form.first_name.trim()) next.first_name = "Enter a first name.";
    if (!form.last_name.trim()) next.last_name = "Enter a last name.";
    if (!form.email.trim()) next.email = "Enter a work email.";
    if (!form.accepted_terms) next.accepted_terms = "Agree to continue.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true); setFormError(null);
    const payload: InstitutionAccessRequestPayload = {
      institution_name: form.institution_name.trim(), institution_type: form.institution_type, country_code: form.country_code,
      organization_size: form.organization_size as InstitutionAccessRequestPayload["organization_size"], website_url: form.website_url.trim(),
      contact_name: `${form.first_name.trim()} ${form.last_name.trim()}`, email: form.email.trim(), phone: form.phone.trim(),
      accepted_terms: true, website: form.website,
    };
    try {
      await authApi.submitInstitutionAccessRequest(payload);
      setSubmittedTo(form.email.trim());
      setForm(EMPTY);
    } catch (caught) {
      if (isApiRequestError(caught) && caught.status === 429) {
        setFormError("Too many requests from this network. Please try again in an hour.");
      } else if (isApiRequestError(caught) && caught.fieldErrors) {
        const server: Partial<Record<FieldName, string>> = {};
        for (const name of SERVER_FIELDS) { const message = caught.fieldError(name); if (message) server[name] = message; }
        const contact = caught.fieldError("contact_name"); if (contact) server.first_name = contact;
        setErrors(server);
        setFormError(Object.keys(server).length ? "Please correct the highlighted fields." : getApiErrorMessage(caught));
      } else {
        setFormError(getApiErrorMessage(caught));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const intro = (
    <div>
      <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to sign in</Link>
      <h1 className="mt-10 text-[2.75rem] font-bold leading-[1.05] tracking-tight text-ink-strong">Get your ErgonX account</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-muted">Create your organization to set up access for your team.</p>
      <p className="mt-6 inline-flex items-center gap-2 text-caption text-ink-subtle"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Encrypted connection · every request is reviewed</p>
      <p className="mt-8 border-t border-line pt-6 text-support text-ink-muted">Joining an organization already on ErgonX? Ask its administrator or HR team to invite you, then use the link in the email.</p>
    </div>
  );

  if (submittedTo) {
    return (
      <AuthShell intro={intro}>
        <div className="flex flex-col items-center py-8 text-center" role="status">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true"><CheckCircle2 className="h-7 w-7" /></span>
          <h2 className="mt-5 text-section-title font-bold text-ink-strong">Request received</h2>
          <p className="mt-2 max-w-md text-support text-ink-muted">An ErgonX Super Admin will review it. Once approved, a secure single-use link is sent to <span className="font-semibold text-ink-strong">{submittedTo}</span> to finish setting up your organization and create your password.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/login" variant="strong" trailingIcon={<ArrowRight className="h-4 w-4" />}>Go to sign in</ButtonLink>
            <Button variant="secondary" onClick={() => setSubmittedTo(null)}>Send another request</Button>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell intro={intro}>
      <form onSubmit={submit} noValidate>
        {formError && <Alert tone="danger" title="Request not sent" className="mb-6">{formError}</Alert>}
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          <section className="space-y-4" aria-labelledby="institution-details">
            <h2 id="institution-details" className="text-card-title font-bold text-ink-strong">Institution details</h2>
            <Field label="Legal name of institution" required error={errors.institution_name}><Input value={form.institution_name} maxLength={200} autoComplete="organization" onChange={(event) => update("institution_name", event.target.value)} placeholder="e.g. Acme University" /></Field>
            <Field label="Institution type" required error={errors.institution_type}>
              <Select value={form.institution_type} onChange={(event) => update("institution_type", event.target.value)}>
                <option value="">Select institution type</option>
                {INSTITUTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Country" required error={errors.country_code}>
              <Select value={form.country_code} onChange={(event) => update("country_code", event.target.value)}>
                <option value="">Select country</option>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </Select>
            </Field>
            <Field label="Employee size" optional error={errors.organization_size}>
              <Select value={form.organization_size} onChange={(event) => update("organization_size", event.target.value)}>
                <option value="">Select employee size</option>
                {SIZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Website" optional error={errors.website_url}><Input type="url" value={form.website_url} autoComplete="url" onChange={(event) => update("website_url", event.target.value)} placeholder="https://www.yourinstitution.edu" /></Field>
          </section>

          <section className="space-y-4" aria-labelledby="admin-details">
            <h2 id="admin-details" className="text-card-title font-bold text-ink-strong">Admin details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" required error={errors.first_name}><Input value={form.first_name} maxLength={75} autoComplete="given-name" onChange={(event) => update("first_name", event.target.value)} placeholder="e.g. Jordan" /></Field>
              <Field label="Last name" required error={errors.last_name}><Input value={form.last_name} maxLength={74} autoComplete="family-name" onChange={(event) => update("last_name", event.target.value)} placeholder="e.g. Taylor" /></Field>
            </div>
            <Field label="Work email" required error={errors.email}><Input type="email" value={form.email} autoComplete="email" onChange={(event) => update("email", event.target.value)} placeholder="e.g. jordan.taylor@yourinstitution.edu" /></Field>
            <Field label="Phone number" optional error={errors.phone}><Input type="tel" value={form.phone} maxLength={40} autoComplete="tel" onChange={(event) => update("phone", event.target.value)} placeholder="e.g. +233 20 123 4567" /></Field>
            <div className="flex gap-3 rounded-lg bg-primary-soft/60 p-3 text-support text-ink">
              <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>This person becomes the first administrator. After approval they receive a secure single-use link to create their password and finish setup.</p>
            </div>
          </section>
        </div>

        {/* Honeypot for bots: hidden from people and assistive technology. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => update("website", event.target.value)} /></label>
        </div>

        <div className="mt-8 border-t border-line-soft pt-6">
          <label className="flex items-start gap-3 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.accepted_terms} onChange={(event) => update("accepted_terms", event.target.checked)} />
            <span>I agree to the ErgonX Terms of Service and acknowledge the Privacy Policy.</span>
          </label>
          {errors.accepted_terms && <p className="mt-1 text-caption text-danger-ink">{errors.accepted_terms}</p>}
          <Button type="submit" variant="strong" size="lg" block className="mt-6" loading={submitting} loadingLabel="Sending request…" trailingIcon={<ArrowRight className="h-4 w-4" />}>Request invitation</Button>
          <p className="mt-4 text-center text-caption text-ink-subtle">Your information is used only to set up your organization in ErgonX.</p>
        </div>
      </form>
    </AuthShell>
  );
}
