"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock } from "lucide-react";

import AuthShell from "@/components/brand/AuthShell";
import { useAuth } from "@/components/guards/AuthProvider";
import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import { Field, Input, Select } from "@/components/ui/Field";
import PasswordStrength from "@/components/ui/PasswordStrength";
import { FormSkeleton } from "@/components/ui/Skeleton";
import { authApi, getApiErrorMessage } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";

/** Country → base currency and time zone. Both can be changed later in Institution profile. */
const COUNTRIES: Array<{ code: string; name: string; currency: string; timezone: string }> = [
  { code: "GH", name: "Ghana", currency: "GHS", timezone: "Africa/Accra" },
  { code: "NG", name: "Nigeria", currency: "NGN", timezone: "Africa/Lagos" },
  { code: "KE", name: "Kenya", currency: "KES", timezone: "Africa/Nairobi" },
  { code: "ZA", name: "South Africa", currency: "ZAR", timezone: "Africa/Johannesburg" },
  { code: "GB", name: "United Kingdom", currency: "GBP", timezone: "Europe/London" },
  { code: "US", name: "United States", currency: "USD", timezone: "America/New_York" },
];
const SIZES: Array<[string, string]> = [["1-50", "1–50 employees"], ["51-200", "51–200 employees"], ["201-1000", "201–1,000 employees"], ["1000+", "More than 1,000 employees"]];

type FormState = { institution_name: string; institution_type: string; country_code: string; employee_size: string; website: string; first_name: string; last_name: string; phone: string; password: string; accepted_terms: boolean };
const EMPTY: FormState = { institution_name: "", institution_type: "", country_code: "", employee_size: "", website: "", first_name: "", last_name: "", phone: "", password: "", accepted_terms: false };

/** Invitation acceptance (Stitch S002 visual): the first administrator creates the organization. */
export default function CreateOrganizationPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { refreshSession } = useAuth();
  const load = useCallback(() => authApi.getInstitutionAdminInvitation(token), [token]);
  const { data, loading, error, reload } = useApiResource(load);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [prefilled, setPrefilled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Start from what the access request already told us (organization, name, phone, country, size).
  useEffect(() => {
    if (!data || prefilled) return;
    const prefill = data.prefill ?? {};
    queueMicrotask(() => {
      setForm((current) => ({ ...current, ...Object.fromEntries(Object.entries(prefill).filter(([, value]) => typeof value === "string" && value)) }));
      setPrefilled(true);
    });
  }, [data, prefilled]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const country = COUNTRIES.find((item) => item.code === form.country_code);
  const ready = Boolean(form.institution_name.trim() && form.institution_type && form.country_code && form.first_name.trim() && form.last_name.trim() && form.password.length >= 8 && form.accepted_terms);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true); setSaveError(null);
    try {
      await authApi.acceptInstitutionAdminInvitation(token, {
        institution_name: form.institution_name.trim(), institution_type: form.institution_type, country_code: form.country_code,
        employee_size: form.employee_size, website: form.website.trim(), first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        phone: form.phone.trim(), password: form.password, accepted_terms: form.accepted_terms,
        default_currency: country?.currency ?? "GHS", timezone: country?.timezone ?? "Africa/Accra",
      });
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
      setSaving(false);
      return;
    }
    // The organization exists now and the invitation is spent, so a failed
    // session load must not look like a failed create; signing in recovers.
    try {
      await refreshSession();
      router.replace("/onboarding");
    } catch {
      router.replace("/login?next=%2Fonboarding");
    }
  };

  const intro = (
    <div>
      <Link href="/login" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-ink hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to sign in</Link>
      <h1 className="mt-10 text-[2.75rem] font-bold leading-[1.05] tracking-tight text-ink-strong">Get your ErgonX account</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-muted">Create your organization to set up access for your team.</p>
      <p className="mt-6 inline-flex items-center gap-2 text-caption text-ink-subtle"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Encrypted connection · invitation-only sign-up</p>
    </div>
  );

  return (
    <AuthShell intro={intro}>
      {loading ? (
        <FormSkeleton fields={8} label="Loading invitation" />
      ) : error || !data ? (
        <ErrorState title="Invitation unavailable" message={error ?? "This invitation is invalid or expired."} onRetry={reload} />
      ) : (
        <form onSubmit={submit} noValidate>
          {saveError && <Alert tone="danger" title="Could not create the organization" className="mb-6">{saveError}</Alert>}
          <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
            <section className="space-y-4" aria-labelledby="institution-details">
              <h2 id="institution-details" className="text-card-title font-bold text-ink-strong">Institution details</h2>
              <Field label="Legal name of institution" required><Input value={form.institution_name} onChange={(event) => update("institution_name", event.target.value)} placeholder="e.g. Acme University" autoComplete="organization" /></Field>
              <Field label="Institution type" required>
                <Select value={form.institution_type} onChange={(event) => update("institution_type", event.target.value)}>
                  <option value="">Select institution type</option>
                  {data.institution_types?.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </Select>
              </Field>
              <Field label="Country" required helper={country ? `Base currency ${country.currency} · time zone ${country.timezone}. You can change these later.` : undefined}>
                <Select value={form.country_code} onChange={(event) => update("country_code", event.target.value)}>
                  <option value="">Select country</option>
                  {COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                </Select>
              </Field>
              <Field label="Employee size" optional>
                <Select value={form.employee_size} onChange={(event) => update("employee_size", event.target.value)}>
                  <option value="">Select employee size</option>
                  {SIZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label="Website" optional><Input type="url" value={form.website} onChange={(event) => update("website", event.target.value)} placeholder="https://www.yourinstitution.edu" autoComplete="url" /></Field>
            </section>

            <section className="space-y-4" aria-labelledby="admin-details">
              <h2 id="admin-details" className="text-card-title font-bold text-ink-strong">Admin details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" required><Input value={form.first_name} onChange={(event) => update("first_name", event.target.value)} placeholder="e.g. Jordan" autoComplete="given-name" /></Field>
                <Field label="Last name" required><Input value={form.last_name} onChange={(event) => update("last_name", event.target.value)} placeholder="e.g. Taylor" autoComplete="family-name" /></Field>
              </div>
              <Field label="Work email" helper="Set by your invitation."><Input value={data.email} disabled /></Field>
              <Field label="Phone number" optional><Input type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="e.g. +233 20 123 4567" autoComplete="tel" /></Field>
              <Field label="Create a password" required helper="At least 8 characters; avoid common or all-number passwords.">
                <div className="relative">
                  <Input type={showPassword ? "text" : "password"} minLength={8} value={form.password} onChange={(event) => update("password", event.target.value)} placeholder="Enter a password" autoComplete="new-password" className="pr-10" />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:text-ink-strong" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </Field>
              <PasswordStrength value={form.password} />
            </section>
          </div>

          <div className="mt-8 border-t border-line-soft pt-6">
            <label className="flex items-start gap-3 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.accepted_terms} onChange={(event) => update("accepted_terms", event.target.checked)} />
              <span>I agree to the ErgonX Terms of Service and acknowledge the Privacy Policy.</span>
            </label>
            <Button type="submit" variant="strong" size="lg" block className="mt-6" disabled={!ready} loading={saving} loadingLabel="Creating organization…" trailingIcon={<ArrowRight className="h-4 w-4" />}>Create organization</Button>
            <p className="mt-4 text-center text-caption text-ink-subtle">Your information is used only to set up your organization in ErgonX.</p>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
