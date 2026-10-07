"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, PlayCircle, Plus } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, payrollApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { PayDayRule, PayrollPeriod, PayrollRun } from "@/types/payroll";
import { useAccess } from "@/lib/access";

const ALL = "ALL";
const emptyForm = { name: "", start_date: "", end_date: "", pay_date: "" };

const iso = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

/** Pay date for a period ending on `endDate`, following the configured pay-day rule. */
function payDateFor(endDate: string, rule: PayDayRule | undefined): string {
  if (!endDate) return "";
  if (rule?.type !== "DAY_OF_MONTH") return endDate;
  const end = new Date(`${endDate}T00:00:00`);
  const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  return iso(new Date(end.getFullYear(), end.getMonth(), Math.min(rule.day, lastDay)));
}

/** The calendar month after the latest period (or the current month), ready to create. */
function nextMonthForm(periods: PayrollPeriod[], rule: PayDayRule | undefined) {
  const latest = periods.reduce<string | null>((max, period) => (!max || period.end_date > max ? period.end_date : max), null);
  const base = latest ? new Date(`${latest}T00:00:00`) : new Date();
  const start = latest ? new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1) : new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const endDate = iso(end);
  return { name: start.toLocaleDateString("en-GB", { month: "long", year: "numeric" }), start_date: iso(start), end_date: endDate, pay_date: payDateFor(endDate, rule) };
}

export default function PayrollPeriodsPage() {
  const { can } = useAccess();
  const router = useRouter();
  const canPrepare = can("payroll.prepare");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState("");

  const load = useCallback(async () => {
    const [periods, runs, configurations] = await Promise.all([
      payrollApi.listPayrollPeriods({ page_size: MAX_PAGE_SIZE, ordering: "-start_date" }),
      payrollApi.listPayrollRuns({ page_size: MAX_PAGE_SIZE, ordering: "-started_at" }),
      payrollApi.listPayrollConfigurations().catch(() => null),
    ]);
    return { periods: periods.results, runs: runs.results, configuration: configurations?.results[0] ?? null };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);

  // The run a period is processed by: its active run, else its latest cancelled one.
  const runByPeriod = useMemo(() => {
    const map = new Map<string, PayrollRun>();
    for (const run of data?.runs ?? []) {
      const current = map.get(run.payroll_period);
      if (!current || (current.status === "CANCELLED" && run.status !== "CANCELLED")) map.set(run.payroll_period, run);
    }
    return map;
  }, [data]);

  const periods = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.periods ?? []).filter((period) => (status === ALL || period.status === status) && (!query || period.name.toLowerCase().includes(query)));
  }, [data, search, status]);
  const configured = Boolean(data?.configuration?.is_configured);
  const hasOpenPeriod = (data?.periods ?? []).some((period) => period.status === "OPEN");

  const openForm = () => {
    setFormError("");
    setForm(nextMonthForm(data?.periods ?? [], data?.configuration?.pay_day_rule));
    setFormOpen(true);
  };

  const createPeriod = async () => {
    setFormError("");
    if (!form.name.trim() || !form.start_date || !form.end_date || !form.pay_date) {
      setFormError("Complete the name, period dates, and pay date.");
      return;
    }
    if (form.end_date < form.start_date) {
      setFormError("The end date must not be before the start date.");
      return;
    }
    setSaving(true);
    try {
      await payrollApi.createPayrollPeriod({ ...form, name: form.name.trim() });
      setFormOpen(false);
      setForm(emptyForm);
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const startRun = async (period: PayrollPeriod) => {
    setStarting(period.id);
    setStartError("");
    try {
      const run = await payrollApi.createPayrollRun(period.id, `period-${period.id}-${Date.now()}`);
      router.push(`/payroll/runs/${run.id}`);
    } catch (caught) {
      setStartError(`${period.name}: ${getApiErrorMessage(caught)}`);
      setStarting(null);
    }
  };

  const action = (period: PayrollPeriod) => {
    const run = runByPeriod.get(period.id);
    if (run && run.status !== "CANCELLED") {
      return <Link href={`/payroll/runs/${run.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">Open run #{run.run_number}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>;
    }
    if (period.status === "OPEN" && canPrepare) {
      return <Button size="sm" leadingIcon={<PlayCircle className="h-4 w-4" />} loading={starting === period.id} loadingLabel="Starting…" disabled={!configured || (starting !== null && starting !== period.id)} onClick={() => void startRun(period)}>Start payroll run</Button>;
    }
    return <span className="text-caption text-ink-muted">{period.status === "CLOSED" ? "Closed" : "—"}</span>;
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payroll" title="Payroll periods" description="Create a period for each pay cycle, then start its payroll run." icon={CalendarDays} accent="payroll" actions={canPrepare ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={openForm} disabled={!data}>New period</Button> : null} />
      {data && !configured && canPrepare && (
        <Alert tone="warning" title="Payroll is not configured yet">
          Save the payroll configuration before starting a run. <Link href="/payroll/configuration" className="font-semibold underline">Open payroll configuration</Link>
        </Alert>
      )}
      {data && configured && canPrepare && !hasOpenPeriod && (
        <Alert tone="info" title="No open period">
          Every period is closed. Create a new period to start the next payroll run.
          <span className="mt-3 block"><Button size="sm" leadingIcon={<Plus className="h-4 w-4" />} onClick={openForm}>New period</Button></span>
        </Alert>
      )}
      {startError && <Alert tone="danger" title="The payroll run could not start">{startError}</Alert>}
      <DataTable
        caption="Payroll periods"
        rows={periods}
        rowKey={(period) => period.id}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        minWidth={760}
        toolbar={
          <DataToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search payroll periods…"
            filters={<Select size="sm" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value={ALL}>All statuses</option><option value="OPEN">Open</option><option value="PROCESSING">Processing</option><option value="CLOSED">Closed</option></Select>}
            onClear={search || status !== ALL ? () => { setSearch(""); setStatus(ALL); } : undefined}
          />
        }
        empty={{ title: "No payroll periods found", description: "Create a period to begin processing payroll.", icon: CalendarDays, action: canPrepare ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={openForm}>New period</Button> : undefined }}
        footer={<p className="flex items-center gap-2 text-caption text-ink-muted"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />A period is closed when its payroll run is finalized; closed periods cannot be changed.</p>}
        columns={[
          { key: "name", header: "Period", sortValue: (period) => period.name, cell: (period) => <span className="font-semibold text-ink-strong">{period.name}</span> },
          { key: "start", header: "Start", sortValue: (period) => period.start_date, cell: (period) => formatDate(period.start_date) },
          { key: "end", header: "End", sortValue: (period) => period.end_date, cell: (period) => formatDate(period.end_date) },
          { key: "pay", header: "Pay date", sortValue: (period) => period.pay_date, cell: (period) => formatDate(period.pay_date) },
          { key: "status", header: "Status", cell: (period) => <StatusBadge status={period.status} size="sm" /> },
          { key: "run", header: "Payroll run", cell: action },
        ]}
      />

      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        dismissible={!saving}
        title="New payroll period"
        description="Pre-filled with the month after your latest period; adjust as needed."
        footer={<><Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void createPeriod()} loading={saving} loadingLabel="Creating…">Create period</Button></>}
      >
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Period name" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. September 2026" data-autofocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" required><Input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} /></Field>
            <Field label="End date" required><Input type="date" value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value, pay_date: payDateFor(event.target.value, data?.configuration?.pay_day_rule) })} /></Field>
          </div>
          <Field label="Pay date" required><Input type="date" value={form.pay_date} onChange={(event) => setForm({ ...form, pay_date: event.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  );
}
