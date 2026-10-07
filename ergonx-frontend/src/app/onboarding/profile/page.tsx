"use client";

import Link from "next/link";
import { useCallback, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Globe2, Sparkles } from "lucide-react";

import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, institutionsApi } from "@/lib/api";
import type { InstitutionProfilePayload, LocaleCatalogues } from "@/lib/api/institutions";
import { useApiResource } from "@/lib/useApiResource";
import { buttonClasses } from "@/components/ui/Button";

type Option = { value: string; label: string };

const institutionTypeOptions: Option[] = [
  { value: "PRIVATE", label: "Private / Commercial" },
  { value: "SME", label: "SME" },
  { value: "GOVERNMENT", label: "Government / Public Sector" },
  { value: "NGO", label: "NGO / Nonprofit" },
  { value: "EDUCATION", label: "Educational Institution" },
  { value: "HEALTHCARE", label: "Healthcare Institution" },
  { value: "OTHER", label: "Other" },
];

export default function OnboardingProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState<InstitutionProfilePayload>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [institution, catalogues] = await Promise.all([
      institutionsApi.getCurrentInstitution(),
      institutionsApi.getLocaleCatalogues(),
    ]);
    return { ...institution, catalogues };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const catalogueOptions = useMemo(() => data ? optionsFor(data.catalogues) : null, [data]);
  const suggestedCurrency = data?.catalogues.countries.find((item) => item.code === (form.country_code ?? data.institution.country_code))?.default_currency;

  const update = (key: keyof InstitutionProfilePayload, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setSaveError(null);
    try {
      await institutionsApi.updateCurrentInstitution({
        name: form.name ?? data.institution.name,
        email: form.email ?? data.institution.email,
        phone: form.phone ?? data.institution.phone,
        address: form.address ?? data.institution.address,
        country_code: form.country_code ?? data.institution.country_code,
        default_currency: form.default_currency ?? data.institution.default_currency,
        timezone: form.timezone ?? data.institution.timezone,
        institution_type: form.institution_type ?? data.institution.institution_type,
      });
      await institutionsApi.validateInstitutionOnboarding();
      router.replace("/onboarding");
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error || !data || !catalogueOptions) {
    return <ErrorState message={error ?? "Could not load the institution profile."} onRetry={reload} />;
  }

  const institution = data.institution;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Institution profile"
        description="Set the organization details that tailor ErgonX to your location and operations."
        actions={<Link href="/onboarding" className={buttonClasses({ variant: "secondary" })}>Back to setup</Link>}
      />
      {saveError && <ErrorState title="Could not save the profile" message={saveError} />}
      <section className="overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 border-b border-line-soft bg-gradient-to-r from-surface-muted to-primary-soft/50 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-white shadow-sm"><Building2 className="h-5 w-5" /></div><div><h2 className="text-base font-bold text-headline">Organization details</h2><p className="mt-1 text-sm text-ink-muted">Contact information and operating location.</p></div></div>
          <div className="inline-flex items-center gap-2 self-start rounded-full border border-primary/25 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-ink sm:self-auto"><Sparkles className="h-3.5 w-3.5" />You can update this anytime</div>
        </div>
        <div className="p-6 sm:p-8">
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <Field label="Organization name" value={form.name ?? institution.name ?? ""} onChange={(value) => update("name", value)} />
            <Field label="Institution email" type="email" value={form.email ?? institution.email ?? ""} onChange={(value) => update("email", value)} />
            <CatalogueField label="Country or region" value={form.country_code ?? institution.country_code ?? "GH"} options={catalogueOptions.countries} onChange={(value) => update("country_code", value)} />
            <div><CatalogueField label="Default currency" value={form.default_currency ?? institution.default_currency ?? "GHS"} options={catalogueOptions.currencies} onChange={(value) => update("default_currency", value)} />{suggestedCurrency && suggestedCurrency !== (form.default_currency ?? institution.default_currency) && <p className="mt-2 text-xs font-normal text-primary-ink">Suggested for {form.country_code ?? institution.country_code}: <strong>{suggestedCurrency}</strong>. <button type="button" onClick={() => update("default_currency", suggestedCurrency)} className="font-semibold underline">Use suggestion</button></p>}</div>
            <CatalogueField label="Timezone" value={form.timezone ?? institution.timezone ?? "Africa/Accra"} options={catalogueOptions.timezones} onChange={(value) => update("timezone", value)} />
            <SelectField label="Institution type" value={form.institution_type ?? institution.institution_type ?? "PRIVATE"} options={institutionTypeOptions} onChange={(value) => update("institution_type", value)} />
            <Field label="Phone (optional)" value={form.phone ?? institution.phone ?? ""} onChange={(value) => update("phone", value)} />
            <div className="sm:col-span-2"><Field label="Address (optional)" value={form.address ?? institution.address ?? ""} onChange={(value) => update("address", value)} /></div>
          </div>
          <div className="mt-7 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary-soft/60 px-4 py-3 text-sm text-ink-muted"><Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" /><p>Country, currency, and timezone are independent settings. Choosing a country never changes currency, localization, or accounting and payroll configuration. Institution type may inform an optional future accounting recommendation; it never applies a preset automatically.</p></div>
          <div className="mt-8 flex justify-end border-t border-line-soft pt-6"><button type="button" disabled={saving} onClick={() => void save()} className={buttonClasses({ variant: "primary", size: "lg" })}>{saving ? "Saving..." : "Save profile"}</button></div>
        </div>
      </section>
    </div>
  );
}

function optionsFor(catalogues: LocaleCatalogues): Record<"countries" | "currencies" | "timezones", Option[]> {
  return {
    countries: catalogues.countries.map(({ code, name }) => ({ value: code, label: `${name} (${code})` })),
    currencies: catalogues.currencies.map(({ code, name, symbol }) => ({ value: code, label: `${symbol} — ${name} (${code})` })),
    timezones: catalogues.timezones.map(({ id, name }) => ({ value: id, label: `${name} (${id})` })),
  };
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="block text-sm font-semibold text-ink">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink-strong shadow-sm outline-none transition placeholder:text-ink-subtle focus:border-primary focus:ring-4 focus:ring-primary/15" /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly Option[]; onChange: (value: string) => void }) {
  const knownValue = options.some((option) => option.value === value);
  return <label className="block text-sm font-semibold text-ink">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink-strong shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15">{!knownValue && <option value={value}>{value}</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function CatalogueField({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const listId = useId();
  const knownValue = options.some((option) => option.value === value);
  return <label className="block text-sm font-semibold text-ink">{label}<input aria-describedby={`${listId}-hint`} list={listId} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink-strong shadow-sm outline-none transition placeholder:text-ink-subtle focus:border-primary focus:ring-4 focus:ring-primary/15" /><datalist id={listId}>{!knownValue && <option value={value}>{value}</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist><span id={`${listId}-hint`} className="mt-1 block text-xs font-normal text-ink-muted">Type to search, then select a listed value.</span></label>;
}
