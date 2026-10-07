"use client";

import { Building2, Pencil, Save } from "lucide-react";
import { useCallback, useState } from "react";
import Image from "next/image";

import { useAuth } from "@/components/guards/AuthProvider";
import ErrorState from "@/components/ui/ErrorState";
import { FileInput } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, imagesApi, institutionsApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { buttonClasses } from "@/components/ui/Button";

type FormValues = { name: string; email: string; phone: string; address: string; country_code: string; default_currency: string; timezone: string; institution_type: string; executive_title: string };
const institutionTypes = [
  { value: "PRIVATE", label: "Private / Commercial" },
  { value: "SME", label: "SME" },
  { value: "GOVERNMENT", label: "Government / Public Sector" },
  { value: "NGO", label: "NGO / Nonprofit" },
  { value: "EDUCATION", label: "Educational Institution" },
  { value: "HEALTHCARE", label: "Healthcare Institution" },
  { value: "OTHER", label: "Other" },
];

function formValues(context: Awaited<ReturnType<typeof institutionsApi.getCurrentInstitution>>): FormValues {
  const item = context.institution;
  return { name: item.name, email: item.email, phone: item.phone, address: item.address, country_code: item.country_code, default_currency: item.default_currency, timezone: item.timezone, institution_type: item.institution_type, executive_title: item.executive_title ?? "Executive" };
}

export default function InstitutionSettingsPage() {
  const { user, institution: sessionInstitution, refreshSession } = useAuth();
  const load = useCallback(async () => {
    const [context, catalogues] = await Promise.all([institutionsApi.getCurrentInstitution(), institutionsApi.getLocaleCatalogues()]);
    return { context, catalogues };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadedLogoId, setLogoId] = useState<string | null>(null);
  const logoId = uploadedLogoId ?? sessionInstitution?.logoImageId ?? null;
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const canManage = user?.permissions.includes("*") || user?.permissions.includes("settings.institution.manage");
  const values = draft ?? (data ? formValues(data.context) : null);

  const startEditing = () => { if (data) { setDraft(formValues(data.context)); setActionError(null); setEditing(true); } };
  const update = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setDraft((current) => ({ ...(current ?? formValues(data!.context)), [key]: value }));
  const save = async () => {
    if (!draft) return;
    setSaving(true); setActionError(null);
    try { await institutionsApi.updateCurrentInstitution(draft); await refreshSession(); setEditing(false); setDraft(null); await reload(); }
    catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const uploadLogo = async (file: File | undefined) => {
    if (!file || !canManage || !data) return;
    setActionError(null);
    if (!["image/jpeg", "image/png", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setActionError("Institution logos must be JPEG, PNG, or GIF files no larger than 5 MB.");
      return;
    }
    setLogoUploading(true); setLogoProgress(0);
    try {
      const image = await imagesApi.uploadImage(file, "INSTITUTION", data.context.institution.id, setLogoProgress);
      setLogoId(image.id);
      // The shell and documents read the logo from the session.
      await refreshSession();
    } catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setLogoUploading(false); }
  };

  if (loading) return <LoadingState />;
  if (error || !data || !values) return <ErrorState title="Unable to load institution settings" message={error ?? "Institution details are unavailable."} onRetry={reload} />;
  const { institution } = data.context;
  const suggestion = editing ? data.catalogues.countries.find((item) => item.code === values.country_code)?.default_currency : undefined;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Institution profile (Stitch S045): organization details, then contact details. */}
      <PageHeader title="Institution profile" description="Legal identity, locale and contact details for the active institution."
        meta={<span className="rounded-full bg-primary-soft px-3 py-1 text-caption font-semibold text-primary-ink">Code: {institution.code}</span>}
        actions={canManage && !editing ? <button type="button" onClick={startEditing} className={buttonClasses({ variant: "primary" })}><Pencil size={16} />Edit institution</button> : undefined} />
      {actionError && <ErrorState variant="inline" title="Unable to save institution settings" message={actionError} />}

      <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6" aria-labelledby="org-details">
        <div className="flex items-center justify-between gap-3"><h2 id="org-details" className="flex items-center gap-2 text-section-title font-semibold text-ink-strong"><Building2 size={20} className="text-primary" aria-hidden="true" />Organization details</h2>{editing && <span className="text-caption font-semibold uppercase tracking-[0.08em] text-ink-muted">Editing</span>}</div>
        <div className="mt-5 flex flex-wrap items-center gap-5 rounded-lg bg-surface-muted/70 p-4">
          <span className="flex h-24 w-24 items-center justify-center rounded-lg border border-line bg-surface">{logoId ? <Image src={imagesApi.imageContentUrl(logoId)} alt="Institution logo" width={80} height={80} unoptimized className="h-20 w-20 object-contain" /> : <Building2 className="h-8 w-8 text-ink-subtle" aria-hidden="true" />}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-strong">Institution logo</p>
            <p className="mt-1 text-caption text-ink-muted">PNG, JPG or GIF, up to 5 MB. Shown in the workspace shell and on printed documents.</p>
            {canManage && <FileInput className="mt-3" accept="image/jpeg,image/png,image/gif" disabled={logoUploading} hint="PNG, JPG or GIF" fileName={logoId ? "Change logo" : "Upload logo"} onChange={(event) => void uploadLogo(event.target.files?.[0])} />}
            {logoUploading && <p className="mt-2 text-xs text-ink-muted">Uploading… {logoProgress}%</p>}
          </div>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Institution name" editing={editing}><input disabled={!editing} value={values.name} onChange={(event) => update("name", event.target.value)} /></Field>
          <Field label="Institution type" editing={editing}><select disabled={!editing} value={values.institution_type} onChange={(event) => update("institution_type", event.target.value)}>{!institutionTypes.some((type) => type.value === values.institution_type) && <option value={values.institution_type}>{values.institution_type}</option>}{institutionTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></Field>
          <Field label="Country" editing={editing}><input disabled={!editing} list="countries" value={values.country_code} onChange={(event) => update("country_code", event.target.value.toUpperCase())} /><datalist id="countries">{data.catalogues.countries.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</datalist></Field>
          <Field label="Default currency" editing={editing}><input disabled={!editing} list="currencies" value={values.default_currency} onChange={(event) => update("default_currency", event.target.value.toUpperCase())} /><datalist id="currencies">{data.catalogues.currencies.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.symbol})</option>)}</datalist></Field>
          <Field label="Time zone" editing={editing} wide><input disabled={!editing} list="timezones" value={values.timezone} onChange={(event) => update("timezone", event.target.value)} /><datalist id="timezones">{data.catalogues.timezones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</datalist></Field>
          <Field label="Executive title" editing={editing}><input disabled={!editing} value={values.executive_title} onChange={(event) => update("executive_title", event.target.value)} placeholder="Executive" /></Field>
        </div>
        <p className="mt-3 text-caption text-ink-muted">The time zone is used for dates, times and reports across the institution. Country, currency and time zone are independent choices.</p>
        {suggestion && suggestion !== values.default_currency && <p className="mt-3 rounded-lg border border-primary/25 bg-primary-soft px-3 py-2 text-sm text-primary-ink">Suggested currency for {values.country_code}: <strong>{suggestion}</strong>. <button type="button" onClick={() => update("default_currency", suggestion)} className="font-semibold underline">Use suggestion</button></p>}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1 sm:p-6" aria-labelledby="contact-details">
        <h2 id="contact-details" className="text-section-title font-semibold text-ink-strong">Contact details</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Primary email" editing={editing}><input disabled={!editing} type="email" value={values.email} onChange={(event) => update("email", event.target.value)} /></Field>
          <Field label="Phone" editing={editing}><input disabled={!editing} value={values.phone} onChange={(event) => update("phone", event.target.value)} /></Field>
          <Field label="Address" editing={editing} wide><textarea disabled={!editing} rows={3} value={values.address} onChange={(event) => update("address", event.target.value)} /></Field>
        </div>
        {editing && (
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line-soft pt-5">
            <button type="button" onClick={() => { setEditing(false); setDraft(null); }} className={buttonClasses({ variant: "secondary" })}>Cancel</button>
            <button type="button" disabled={saving} onClick={() => void save()} className={buttonClasses({ variant: "primary" })}><Save size={16} />{saving ? "Saving…" : "Save changes"}</button>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, editing, wide = false, children }: { label: string; editing: boolean; wide?: boolean; children: React.ReactNode }) { return <label className={`block text-sm font-medium text-ink ${wide ? "sm:col-span-2" : ""}`}><span>{label}</span><span className="mt-1.5 block [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-line [&>input]:bg-surface-muted [&>input]:px-3 [&>input]:h-9 [&>input]:text-sm [&>input:disabled]:cursor-default [&>input:disabled]:border-transparent [&>input:disabled]:bg-surface-muted [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-line [&>select]:bg-surface-muted [&>select]:px-3 [&>select]:h-9 [&>select]:text-sm [&>select:disabled]:cursor-default [&>select:disabled]:border-transparent [&>textarea]:w-full [&>textarea]:rounded-lg [&>textarea]:border [&>textarea]:border-line [&>textarea]:bg-surface-muted [&>textarea]:px-3 [&>textarea]:py-2.5 [&>textarea]:text-sm [&>textarea:disabled]:cursor-default [&>textarea:disabled]:border-transparent">{children}</span>{!editing && <span className="sr-only">Read only</span>}</label>; }
