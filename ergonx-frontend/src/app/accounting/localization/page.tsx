"use client";

import Link from "next/link";
import { BookOpenCheck, Landmark, ShieldCheck, type LucideIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { useAuth } from "@/components/guards/AuthProvider";
import { accountingApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";

export default function AccountingLocalizationPage() {
  const { user } = useAuth();
  const canViewCompliance = Boolean(user?.permissions.includes("*") || user?.permissions.includes("financial_report.view"));
  const load = useCallback(async () => {
    const configurations = await accountingApi.listAccountingConfigurations();
    const configuration = configurations.results[0];
    const preset = configuration?.selected_accounting_preset_version;
    if (!preset) return { configuration, taxCodes: [], components: [], withholdingRules: [], complianceReminders: [] };
    const [taxCodes, withholdingRules, complianceReminders] = await Promise.all([
      accountingApi.listTaxCodes({ page_size: MAX_PAGE_SIZE, preset_version: preset, ordering: "code" }),
      accountingApi.listWithholdingRules({ page_size: MAX_PAGE_SIZE, preset_version: preset, ordering: "code" }),
      canViewCompliance ? accountingApi.listGhanaComplianceReminders({ page_size: MAX_PAGE_SIZE, ordering: "due_date" }) : Promise.resolve(null),
    ]);
    const permittedTaxCodes = taxCodes.results;
    const componentPages = await Promise.all(permittedTaxCodes.map((item) => accountingApi.listTaxComponents({ page_size: MAX_PAGE_SIZE, tax_code: item.id, ordering: "sequence" })));
    return { configuration, taxCodes: permittedTaxCodes, components: componentPages.flatMap((page) => page.results), withholdingRules: withholdingRules.results, complianceReminders: complianceReminders?.results ?? [] };
  }, [canViewCompliance]);
  const { data, loading, error, reload } = useApiResource(load);
  const componentsByTaxCode = useMemo(() => {
    const values = new Map<string, string[]>();
    for (const item of data?.components ?? []) values.set(item.tax_code, [...(values.get(item.tax_code) ?? []), `${item.name} (${item.rate}%)`]);
    return values;
  }, [data?.components]);

  if (loading && !data) return <LoadingState />;
  if (error && !data) return <div><ErrorState title="Unable to load localisation" message={error} onRetry={reload} /></div>;
  const configured = Boolean(data?.configuration?.selected_accounting_preset_version);

  return <div className="mx-auto max-w-7xl space-y-6 pb-12">
    <PageHeader title="Tax & Ghana Localisation" description="Read the server-controlled tax and withholding rules attached to the active accounting preset." />
    {error && <ErrorState message={error} onRetry={reload} />}
    {!configured ? <section className="rounded-2xl border border-warning/30 bg-warning-soft p-5 text-sm text-warning-ink"><div className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0" /><div><h2 className="font-semibold">No accounting preset is applied</h2><p className="mt-1">Tax and withholding catalogues are available only after an authorized preset is deliberately applied. This screen does not invent tax rates or localisation rules.</p><Link href="/accounting/ghana-setup" className="mt-3 inline-flex font-semibold underline">Open accounting setup</Link></div></div></section> : <>
      <section className="grid gap-4 sm:grid-cols-3"><Metric label="Active tax codes" value={String(data?.taxCodes.filter((item) => item.is_active).length ?? 0)} icon={BookOpenCheck} /><Metric label="Tax components" value={String(data?.components.length ?? 0)} icon={Landmark} /><Metric label="Withholding rules" value={String(data?.withholdingRules.length ?? 0)} icon={ShieldCheck} /></section>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm"><div><h2 className="text-card-title font-bold text-headline">Tax codes</h2><p className="mt-1 text-sm text-ink-muted">Effective dates and components are defined by the selected preset, not browser logic.</p></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-ink-muted"><th className="pb-3">Code</th><th className="pb-3">Treatment</th><th className="pb-3">Components</th><th className="pb-3">Effective from</th><th className="pb-3">Status</th></tr></thead><tbody>{data?.taxCodes.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-4"><p className="font-semibold">{item.code}</p><p className="text-ink-muted">{item.name}</p></td><td className="py-4">{item.tax_treatment}</td><td className="py-4 text-ink-muted">{componentsByTaxCode.get(item.id)?.join(", ") || "No component records"}</td><td className="py-4">{formatDate(item.effective_from)}{item.effective_to ? ` – ${formatDate(item.effective_to)}` : ""}</td><td className="py-4"><StatusBadge status={item.is_active ? "ACTIVE" : "INACTIVE"} /></td></tr>)}</tbody></table>{!data?.taxCodes.length && <p className="py-10 text-center text-sm text-ink-muted">No tax codes are available for the active preset.</p>}</div></section>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm"><div><h2 className="text-card-title font-bold text-headline">Withholding rules</h2><p className="mt-1 text-sm text-ink-muted">These rules remain read-only here; invoices and vendor bills apply applicable rules through the backend workflow.</p></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-ink-muted"><th className="pb-3">Rule</th><th className="pb-3">Category</th><th className="pb-3">Residency</th><th className="pb-3">Rate</th><th className="pb-3">Threshold</th><th className="pb-3">Effective from</th></tr></thead><tbody>{data?.withholdingRules.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-4"><p className="font-semibold">{item.code}</p><p className="text-ink-muted">{item.name}</p>{item.is_vat_withholding_rule && <p className="mt-1 text-xs font-medium text-success-ink">VAT withholding</p>}</td><td className="py-4">{item.transaction_category}</td><td className="py-4">{item.residency}</td><td className="py-4 font-semibold">{item.rate}%</td><td className="py-4">{item.threshold ?? "—"}</td><td className="py-4">{formatDate(item.effective_from)}{item.effective_to ? ` – ${formatDate(item.effective_to)}` : ""}</td></tr>)}</tbody></table>{!data?.withholdingRules.length && <p className="py-10 text-center text-sm text-ink-muted">No withholding rules are available for the active preset.</p>}</div></section>
      {canViewCompliance && <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm"><div><h2 className="text-card-title font-bold text-headline">Compliance reminders</h2><p className="mt-1 text-sm text-ink-muted">Institution-owned reminders tracked by the accounting backend. Completion remains governed by the authorized workflow.</p></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-ink-muted"><th className="pb-3">Reminder</th><th className="pb-3">Authority</th><th className="pb-3">Due date</th><th className="pb-3">Status</th></tr></thead><tbody>{data?.complianceReminders.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-4"><p className="font-semibold">{item.title}</p><p className="text-ink-muted">{item.code}</p>{item.statutory_reference && <a href={item.statutory_reference} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-primary-ink underline">Statutory reference</a>}</td><td className="py-4">{item.authority}</td><td className="py-4">{formatDate(item.due_date)}</td><td className="py-4"><StatusBadge status={item.status} /></td></tr>)}</tbody></table>{!data?.complianceReminders.length && <p className="py-10 text-center text-sm text-ink-muted">No compliance reminders are recorded for this institution.</p>}</div></section>}
    </>}
  </div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) { return <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm"><Icon className="h-5 w-5 text-ink-muted" /><p className="mt-4 text-2xl font-semibold text-ink-strong">{value}</p><p className="mt-1 text-sm text-ink-muted">{label}</p></section>; }
