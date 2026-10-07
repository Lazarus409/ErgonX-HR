"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, CheckCircle2, Landmark, Percent, Plus, Save, Settings2, Trash2 } from "lucide-react";

import Alert from "@/components/ui/Alert";
import BackNavigation from "@/components/ui/BackNavigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import { Field, Input, Select } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, payrollApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import type { CustomPayrollRules, PayDayRule, PayrollConfiguration, PayrollRuleBasis, PayrollSetupChoices } from "@/types/payroll";

type TaxMethod = "NONE" | "FLAT" | "PROGRESSIVE";
interface Band { upper_bound: string; rate: string }
interface Contribution { name: string; basis: PayrollRuleBasis; employee_rate: string; employer_rate: string; maximum_basis: string }

const BASES: Array<{ value: PayrollRuleBasis; label: string }> = [
  { value: "TAXABLE_INCOME", label: "Taxable income" },
  { value: "GROSS_PAY", label: "Gross pay" },
  { value: "BASE_SALARY", label: "Base salary" },
];
const DEFAULT_BANDS: Band[] = [{ upper_bound: "", rate: "0" }];

const choiceKey = (mode: string, preset: string | null | undefined) => `${mode}:${preset ?? ""}`;
const amount = (value: string) => { const number = Number(value); return Number.isFinite(number) && value.trim() !== "" ? number : 0; };
const money = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Mirrors apps/payroll/custom_rules.py so the preview matches what payroll will calculate. */
function preview(salary: number, method: TaxMethod, threshold: string, rate: string, bands: Band[], contributions: Contribution[]) {
  // With no allowances in the preview, every basis equals the salary.
  let tax = 0;
  const taxable = Math.max(0, salary - amount(threshold));
  if (method === "FLAT") tax = taxable * amount(rate) / 100;
  if (method === "PROGRESSIVE") {
    let lower = 0;
    for (const band of bands) {
      const upper = band.upper_bound.trim() === "" ? null : amount(band.upper_bound);
      const top = upper === null ? taxable : Math.min(taxable, upper);
      if (top > lower) tax += (top - lower) * amount(band.rate) / 100;
      if (upper === null || taxable <= upper) break;
      lower = upper;
    }
  }
  const lines = contributions.map((item) => {
    const base = item.maximum_basis.trim() ? Math.min(salary, amount(item.maximum_basis)) : salary;
    return { name: item.name || "Contribution", employee: base * amount(item.employee_rate) / 100, employer: base * amount(item.employer_rate) / 100 };
  });
  const employeeTotal = lines.reduce((sum, line) => sum + line.employee, 0);
  return { tax, lines, net: salary - tax - employeeTotal };
}

export default function PayrollConfigurationPage() {
  const { can } = useAccess();
  const canConfigure = can("payroll.configure");
  const [configuration, setConfiguration] = useState<PayrollConfiguration | null>(null);
  const [choices, setChoices] = useState<PayrollSetupChoices | null>(null);
  const [choice, setChoice] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [payDay, setPayDay] = useState("LAST_DAY");
  const [payDayOfMonth, setPayDayOfMonth] = useState("25");
  const [taxMethod, setTaxMethod] = useState<TaxMethod>("NONE");
  const [taxName, setTaxName] = useState("Income tax");
  const [taxBasis, setTaxBasis] = useState<PayrollRuleBasis>("TAXABLE_INCOME");
  const [taxThreshold, setTaxThreshold] = useState("0");
  const [taxRate, setTaxRate] = useState("");
  const [bands, setBands] = useState<Band[]>(DEFAULT_BANDS);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [sampleSalary, setSampleSalary] = useState("5000");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const apply = useCallback((current: PayrollConfiguration | null, setup: PayrollSetupChoices) => {
    setConfiguration(current);
    setChoices(setup);
    const first = setup.choices.find((item) => item.recommended) ?? setup.choices[0];
    setChoice(current ? choiceKey(current.payroll_setup_mode, current.selected_payroll_preset_version) : first ? choiceKey(first.mode, first.preset_version_id) : "");
    setFrequency(current?.payroll_frequency ?? "MONTHLY");
    const rule: PayDayRule = current?.pay_day_rule ?? {};
    setPayDay(rule.type === "DAY_OF_MONTH" ? "DAY_OF_MONTH" : "LAST_DAY");
    if (rule.type === "DAY_OF_MONTH") setPayDayOfMonth(String(rule.day));
    const rules: CustomPayrollRules = current?.custom_rules ?? {};
    const tax = rules.income_tax;
    setTaxMethod(tax?.method ?? "NONE");
    setTaxName(tax?.name ?? "Income tax");
    setTaxBasis(tax?.basis ?? "TAXABLE_INCOME");
    setTaxThreshold(tax?.threshold ?? "0");
    setTaxRate(tax?.rate ?? "");
    setBands(tax?.bands?.length ? tax.bands.map((band) => ({ upper_bound: band.upper_bound ?? "", rate: band.rate })) : DEFAULT_BANDS);
    setContributions((rules.contributions ?? []).map((item) => ({ name: item.name, basis: item.basis, employee_rate: item.employee_rate, employer_rate: item.employer_rate, maximum_basis: item.maximum_basis ?? "" })));
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [configs, setup] = await Promise.all([payrollApi.listPayrollConfigurations(), payrollApi.getPayrollSetupChoices()]);
      apply(configs.results[0] ?? null, setup);
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setLoading(false); }
  }, [apply]);
  useEffect(() => { // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(); }, [load]);

  const available = useMemo(() => choices?.choices ?? [], [choices]);
  const selected = available.find((item) => choiceKey(item.mode, item.preset_version_id) === choice);
  const isCustom = selected?.mode === "CUSTOM";
  const result = useMemo(() => preview(amount(sampleSalary), taxMethod, taxThreshold, taxRate, bands, contributions), [sampleSalary, taxMethod, taxThreshold, taxRate, bands, contributions]);
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setSaved(false); };

  const customRules = (): CustomPayrollRules => ({
    income_tax: taxMethod === "NONE"
      ? { method: "NONE" }
      : { method: taxMethod, name: taxName, basis: taxBasis, threshold: taxThreshold || "0", ...(taxMethod === "FLAT" ? { rate: taxRate } : { bands: bands.map((band) => ({ upper_bound: band.upper_bound.trim() || null, rate: band.rate })) }) },
    contributions: contributions.map((item) => ({ name: item.name, basis: item.basis, employee_rate: item.employee_rate || "0", employer_rate: item.employer_rate || "0", maximum_basis: item.maximum_basis.trim() || null })),
  });

  const save = async () => {
    if (!choices || !selected) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      const payload = {
        country_code: choices.country_code,
        currency: choices.currency,
        payroll_frequency: frequency,
        payroll_setup_mode: selected.mode,
        selected_payroll_preset_version: selected.mode === "CUSTOM" ? null : selected.preset_version_id,
        pay_day_rule: (payDay === "DAY_OF_MONTH" ? { type: "DAY_OF_MONTH", day: Number(payDayOfMonth) } : { type: "LAST_DAY" }) as PayDayRule,
        rounding_rule: configuration?.rounding_rule ?? { method: "HALF_UP", decimal_places: 2 },
        custom_rules: selected.mode === "CUSTOM" ? customRules() : {},
        is_configured: true,
      };
      const next = configuration ? await payrollApi.updatePayrollConfiguration(configuration.id, payload) : await payrollApi.createPayrollConfiguration(payload);
      apply(next, choices);
      setSaved(true);
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingState />;
  if (error && !choices) return <ErrorState title="Unable to load payroll configuration" message={error} onRetry={() => void load()} />;

  const disabled = !canConfigure;
  const updateBand = (index: number, patch: Partial<Band>) => { setBands((current) => current.map((band, position) => (position === index ? { ...band, ...patch } : band))); setSaved(false); };
  const updateContribution = (index: number, patch: Partial<Contribution>) => { setContributions((current) => current.map((item, position) => (position === index ? { ...item, ...patch } : item))); setSaved(false); };

  return (
    <div className="space-y-6">
      <BackNavigation fallback="/payroll" label="Back to Payroll" />
      <PageHeader title="Payroll configuration" description="Choose a country preset, or run a custom payroll with your own tax and contribution rules." icon={Settings2} accent="payroll" />
      {error && <Alert tone="danger" title="The configuration was not saved">{error}</Alert>}
      {saved && <Alert tone="success" title="Payroll configuration saved"><span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />New payroll runs use these settings. Runs already started keep the settings they began with.</span></Alert>}

      <Card title="General settings" description="Available presets depend on the institution's country." icon={Settings2} accent="payroll">
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Payroll setup">
            <Select value={choice} disabled={disabled} onChange={(event) => { setChoice(event.target.value); setSaved(false); }}>
              {available.map((item) => <option key={choiceKey(item.mode, item.preset_version_id)} value={choiceKey(item.mode, item.preset_version_id)}>{item.name}{item.version_code ? ` (${item.version_code})` : ""}{item.recommended ? " · recommended" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Payroll frequency">
            <Select value={frequency} disabled={disabled} onChange={(event) => touch(setFrequency)(event.target.value)}>
              <option value="MONTHLY">Monthly</option>
              <option value="SEMIMONTHLY">Twice a month</option>
              <option value="BIWEEKLY">Every two weeks</option>
              <option value="WEEKLY">Weekly</option>
            </Select>
          </Field>
          <Field label="Pay day" helper="Used to suggest the pay date when you create a period.">
            <Select value={payDay} disabled={disabled} onChange={(event) => touch(setPayDay)(event.target.value)}>
              <option value="LAST_DAY">Last day of the period</option>
              <option value="DAY_OF_MONTH">A set day of the month</option>
            </Select>
          </Field>
          {payDay === "DAY_OF_MONTH" ? (
            <Field label="Day of the month" helper="Shorter months use their last day.">
              <Input type="number" min={1} max={31} value={payDayOfMonth} disabled={disabled} onChange={(event) => touch(setPayDayOfMonth)(event.target.value)} />
            </Field>
          ) : <div className="hidden md:block" />}
          <Field label="Country"><Input value={choices?.country_code ?? ""} readOnly disabled /></Field>
          <Field label="Currency"><Input value={choices?.currency ?? ""} readOnly disabled /></Field>
        </div>
        {selected?.compliance_warning && <Alert tone="warning" className="mt-5">{selected.compliance_warning} Define the rules below; they apply to every employee in each new run.</Alert>}
      </Card>

      {isCustom && (
        <>
          <Card title="Income tax" description="How tax is worked out for each employee every pay period." icon={Landmark} accent="payroll">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Tax method">
                <Select value={taxMethod} disabled={disabled} onChange={(event) => touch(setTaxMethod)(event.target.value as TaxMethod)}>
                  <option value="NONE">No income tax</option>
                  <option value="FLAT">Flat rate</option>
                  <option value="PROGRESSIVE">Progressive bands</option>
                </Select>
              </Field>
              {taxMethod !== "NONE" && (
                <>
                  <Field label="Name on payslips"><Input value={taxName} maxLength={100} disabled={disabled} onChange={(event) => touch(setTaxName)(event.target.value)} /></Field>
                  <Field label="Taxed on">
                    <Select value={taxBasis} disabled={disabled} onChange={(event) => touch(setTaxBasis)(event.target.value as PayrollRuleBasis)}>
                      {BASES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Tax-free amount per period" helper="Taken off before tax is calculated.">
                    <Input type="number" min={0} step="0.01" value={taxThreshold} disabled={disabled} onChange={(event) => touch(setTaxThreshold)(event.target.value)} />
                  </Field>
                </>
              )}
              {taxMethod === "FLAT" && (
                <Field label="Tax rate (%)"><Input type="number" min={0} max={100} step="0.01" value={taxRate} disabled={disabled} onChange={(event) => touch(setTaxRate)(event.target.value)} /></Field>
              )}
            </div>
            {taxMethod === "PROGRESSIVE" && (
              <div className="mt-6">
                <p className="text-sm font-semibold text-ink-strong">Tax bands</p>
                <p className="text-support text-ink-muted">Each band taxes the income between the previous band&apos;s limit and its own. Leave the last limit blank for &quot;and above&quot;.</p>
                <div className="mt-3 space-y-2">
                  {bands.map((band, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                      <Field label={index === 0 ? "Up to (amount)" : "Up to"} hideLabel={index > 0}>
                        <Input type="number" min={0} step="0.01" placeholder={index === bands.length - 1 ? "and above" : "Upper limit"} value={band.upper_bound} disabled={disabled} onChange={(event) => updateBand(index, { upper_bound: event.target.value })} />
                      </Field>
                      <Field label={index === 0 ? "Rate (%)" : "Rate"} hideLabel={index > 0}>
                        <Input type="number" min={0} max={100} step="0.01" value={band.rate} disabled={disabled} onChange={(event) => updateBand(index, { rate: event.target.value })} />
                      </Field>
                      <Button variant="ghost" size="sm" aria-label={`Remove band ${index + 1}`} disabled={disabled || bands.length === 1} onClick={() => { setBands((current) => current.filter((_, position) => position !== index)); setSaved(false); }} leadingIcon={<Trash2 className="h-4 w-4" />} />
                    </div>
                  ))}
                </div>
                <Button variant="secondary" size="sm" className="mt-3" disabled={disabled || bands.length >= 20} leadingIcon={<Plus className="h-4 w-4" />} onClick={() => { setBands((current) => [...current, { upper_bound: "", rate: "" }]); setSaved(false); }}>Add band</Button>
              </div>
            )}
          </Card>

          <Card title="Contributions" description="Pension, social security, health insurance or similar, as a percentage of pay." icon={Percent} accent="payroll">
            {contributions.length === 0 && <p className="text-support text-ink-muted">No contributions. Add one for each scheme you pay into.</p>}
            <div className="space-y-4">
              {contributions.map((item, index) => (
                <div key={index} className="grid gap-3 rounded-2xl border border-line p-4 md:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_1fr_auto] md:items-end">
                  <Field label="Name"><Input value={item.name} maxLength={100} placeholder="e.g. Pension" disabled={disabled} onChange={(event) => updateContribution(index, { name: event.target.value })} /></Field>
                  <Field label="Calculated on">
                    <Select value={item.basis} disabled={disabled} onChange={(event) => updateContribution(index, { basis: event.target.value as PayrollRuleBasis })}>
                      {BASES.map((basis) => <option key={basis.value} value={basis.value}>{basis.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Employee %"><Input type="number" min={0} max={100} step="0.01" value={item.employee_rate} disabled={disabled} onChange={(event) => updateContribution(index, { employee_rate: event.target.value })} /></Field>
                  <Field label="Employer %"><Input type="number" min={0} max={100} step="0.01" value={item.employer_rate} disabled={disabled} onChange={(event) => updateContribution(index, { employer_rate: event.target.value })} /></Field>
                  <Field label="Earnings cap" optional><Input type="number" min={0} step="0.01" placeholder="No cap" value={item.maximum_basis} disabled={disabled} onChange={(event) => updateContribution(index, { maximum_basis: event.target.value })} /></Field>
                  <Button variant="ghost" size="sm" aria-label={`Remove ${item.name || "contribution"}`} disabled={disabled} onClick={() => { setContributions((current) => current.filter((_, position) => position !== index)); setSaved(false); }} leadingIcon={<Trash2 className="h-4 w-4" />} />
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" className="mt-4" disabled={disabled || contributions.length >= 10} leadingIcon={<Plus className="h-4 w-4" />} onClick={() => { setContributions((current) => [...current, { name: "", basis: "BASE_SALARY", employee_rate: "", employer_rate: "", maximum_basis: "" }]); setSaved(false); }}>Add contribution</Button>
          </Card>

          <Card title="Preview" description="What one employee on a basic salary alone would receive under these rules." icon={Calculator} accent="payroll">
            <div className="grid gap-5 md:grid-cols-[minmax(0,16rem)_1fr]">
              <Field label={`Salary per period (${choices?.currency ?? ""})`}><Input type="number" min={0} step="0.01" value={sampleSalary} onChange={(event) => setSampleSalary(event.target.value)} /></Field>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-ink-muted">{taxMethod === "NONE" ? "Income tax" : taxName || "Income tax"}</dt><dd className="tabular-nums text-ink-strong">{money(result.tax)}</dd></div>
                {result.lines.map((line, index) => (
                  <div key={index} className="flex justify-between gap-4"><dt className="text-ink-muted">{line.name} (employee · employer)</dt><dd className="tabular-nums text-ink-strong">{money(line.employee)} · {money(line.employer)}</dd></div>
                ))}
                <div className="flex justify-between gap-4 border-t border-line pt-2 font-semibold"><dt className="text-ink-strong">Net pay</dt><dd className="tabular-nums text-ink-strong">{money(result.net)}</dd></div>
              </dl>
            </div>
          </Card>
        </>
      )}

      {canConfigure && (
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} loadingLabel="Saving…" disabled={!selected} leadingIcon={<Save className="h-4 w-4" />}>Save configuration</Button>
        </div>
      )}
    </div>
  );
}
