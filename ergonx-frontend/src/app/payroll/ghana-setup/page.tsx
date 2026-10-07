"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Info, ShieldCheck } from "lucide-react";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, payrollApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import { buttonClasses } from "@/components/ui/Button";
import { useAccess } from "@/lib/access";

type Contribution = { id: string; code: string; name: string; basis: string; employee_rate: string; employer_rate: string };
type Threshold = { id: string; code: string; name: string; amount: string; unit: string; effective_from: string };

export default function GhanaPayrollSetupPage() {
  const { can } = useAccess();
  const [selectedKey, setSelectedKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const load = useCallback(async () => {
    const [configurations, choices] = await Promise.all([payrollApi.listPayrollConfigurations(), payrollApi.getPayrollSetupChoices()]);
    const selectedVersion = configurations.results[0]?.selected_payroll_preset_version;
    const presetId = selectedVersion ?? choices.choices.find((choice) => choice.recommended)?.preset_version_id;
    const [contributions, thresholds] = presetId ? await Promise.all([payrollApi.listContributionRules({ preset_version: presetId, page_size: MAX_PAGE_SIZE }), payrollApi.listStatutoryThresholds({ preset_version: presetId, page_size: MAX_PAGE_SIZE })]) : [{ results: [] }, { results: [] }];
    return { configurations, choices, contributions: contributions.results as Contribution[], thresholds: thresholds.results as Threshold[] };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const configuration = data?.configurations.results[0] ?? null;
  const choices = data?.choices;
  const configuredChoice = useMemo(() => choices?.choices.find((choice) => choice.preset_version_id === configuration?.selected_payroll_preset_version) ?? choices?.choices.find((choice) => choice.recommended) ?? choices?.choices[0], [choices, configuration]);
  const selectedChoice = choices?.choices.find((choice) => (choice.preset_version_id ?? choice.mode) === selectedKey) ?? configuredChoice;
  const save = async () => {
    if (!choices || !selectedChoice) return;
    setSaving(true); setSaveError(""); setMessage("");
    try {
      const payload = { country_code: choices.country_code, currency: choices.currency, payroll_frequency: configuration?.payroll_frequency ?? "MONTHLY", payroll_setup_mode: selectedChoice.mode, selected_payroll_preset_version: selectedChoice.mode === "CUSTOM" ? null : selectedChoice.preset_version_id, pay_day_rule: configuration?.pay_day_rule ?? {}, rounding_rule: configuration?.rounding_rule ?? { method: "HALF_UP", decimal_places: 2 }, is_configured: true };
      if (configuration) await payrollApi.updatePayrollConfiguration(configuration.id, payload); else await payrollApi.createPayrollConfiguration(payload);
      setMessage("Payroll configuration saved.");
      reload();
    } catch (caught) { setSaveError(getApiErrorMessage(caught)); } finally { setSaving(false); }
  };
  if (loading) return <div className="text-sm text-ink-muted">Loading Ghana payroll setup...</div>;
  if (error || !data || !choices) return <div><ErrorState title="Unable to load Ghana payroll setup" message={error ?? "Payroll setup choices are unavailable."} onRetry={reload} /></div>;
  return <div className="space-y-6"><PageHeader title="Ghana Payroll Setup" description="Choose and review the institution's Ghana payroll configuration." />{choices.country_code !== "GH" ? <ErrorState title="Ghana setup unavailable" message={`This institution is configured for ${choices.country_code}, not Ghana.`} /> : <><section className="rounded-xl border bg-surface p-5"><div className="flex gap-3"><Info size={20} className="shrink-0" /><div><h2 className="font-semibold">Configuration choice</h2><p className="mt-1 text-sm text-ink-muted">Available options are supplied by the backend for this institution.</p></div></div><div className="mt-5 grid gap-4 md:grid-cols-2">{choices.choices.map((choice) => { const key = choice.preset_version_id ?? choice.mode; const selected = (selectedChoice?.preset_version_id ?? selectedChoice?.mode) === key; return <button type="button" key={key} onClick={() => setSelectedKey(key)} className={`rounded-xl border p-5 text-left ${selected ? "border-primary bg-surface-muted" : ""}`}>{choice.mode === "PRESET" && <ShieldCheck size={22} />}<h3 className="mt-3 font-semibold">{choice.mode === "PRESET" ? `${choice.preset_code} ${choice.version_code ?? ""}` : choice.name}</h3><p className="mt-1 text-sm text-ink-muted">{choice.name}{choice.recommended && " · Recommended"}</p>{choice.compliance_warning && <p className="mt-2 text-xs text-warning-ink">{choice.compliance_warning}</p>}</button>; })}</div></section><section className="rounded-xl border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Backend configuration summary</h2><p className="text-sm text-ink-muted">Read-only statutory records effective for the saved or recommended preset.</p></div><div className="divide-y"><Row label="Country / currency" value={`${choices.country_code} / ${choices.currency}`} /><Row label="Selected setup" value={selectedChoice?.mode ?? "Not selected"} /><Row label="Preset version" value={selectedChoice?.version_code ?? "Custom configuration"} /><Row label="Contribution rules" value={String(data.contributions.length)} /><Row label="Statutory thresholds" value={String(data.thresholds.length)} /></div></section><Catalogues contributions={data.contributions} thresholds={data.thresholds} />{saveError && <p className="rounded border border-danger/25 bg-danger-soft p-3 text-sm text-danger-ink">{saveError}</p>}{message && <p className="flex items-center gap-2 rounded border bg-surface p-3 text-sm"><CheckCircle2 size={17} />{message}</p>}<div className="flex justify-end">{can("payroll.configure") && <button type="button" onClick={() => void save()} disabled={saving || !selectedChoice} className={buttonClasses({ variant: "primary" })}>{saving ? "Saving..." : "Save Ghana Setup"}</button>}</div></>}</div>;
}

function Row({ label, value }: { label: string; value: string }) { return <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm font-medium">{label}</span><span className="text-sm text-ink-muted">{value}</span></div>; }
function Catalogues({ contributions, thresholds }: { contributions: Contribution[]; thresholds: Threshold[] }) { return <section className="grid gap-6 xl:grid-cols-2"><div className="overflow-hidden rounded-xl border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Contribution rules</h2><p className="mt-1 text-sm text-ink-muted">Read-only rates and bases from the backend preset.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead className="bg-surface-muted text-left text-xs uppercase text-ink-muted"><tr><th className="px-4 py-3">Rule</th><th className="px-4 py-3">Basis</th><th className="px-4 py-3">Employee</th><th className="px-4 py-3">Employer</th></tr></thead><tbody className="divide-y">{contributions.map((rule) => <tr key={rule.id}><td className="px-4 py-3"><p className="font-medium">{rule.name}</p><p className="text-xs text-ink-muted">{rule.code}</p></td><td className="px-4 py-3">{rule.basis}</td><td className="px-4 py-3">{rule.employee_rate}</td><td className="px-4 py-3">{rule.employer_rate}</td></tr>)}</tbody></table>{!contributions.length && <p className="p-5 text-sm text-ink-muted">No effective contribution rules were returned.</p>}</div></div><div className="overflow-hidden rounded-xl border bg-surface"><div className="border-b p-5"><h2 className="font-semibold">Statutory thresholds</h2><p className="mt-1 text-sm text-ink-muted">Read-only threshold values from the backend preset.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[500px] text-sm"><thead className="bg-surface-muted text-left text-xs uppercase text-ink-muted"><tr><th className="px-4 py-3">Threshold</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Effective from</th></tr></thead><tbody className="divide-y">{thresholds.map((threshold) => <tr key={threshold.id}><td className="px-4 py-3"><p className="font-medium">{threshold.name}</p><p className="text-xs text-ink-muted">{threshold.code}</p></td><td className="px-4 py-3">{threshold.amount} {threshold.unit}</td><td className="px-4 py-3">{threshold.effective_from}</td></tr>)}</tbody></table>{!thresholds.length && <p className="p-5 text-sm text-ink-muted">No effective statutory thresholds were returned.</p>}</div></div></section>; }
