"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileCog, Plus, XCircle } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Button, IconButton } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { employeesApi, getApiErrorMessage, payrollApi } from "@/lib/api";
import { EM_DASH, formatAmount, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { PayComponent, PayrollAdjustment, PayrollPeriod } from "@/types/payroll";
import { useAccess } from "@/lib/access";

const ALL = "ALL";
const emptyForm = { employee: "", payroll_period: "", pay_component: "", amount: "", reason: "" };

export default function PayrollAdjustmentsPage() {
  const { can } = useAccess();
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [components, setComponents] = useState<PayComponent[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const load = useCallback(() => payrollApi.listPayrollAdjustments({ page_size: MAX_PAGE_SIZE, status: status === ALL ? undefined : status, ordering: "-created_at" }), [status]);
  const { data, loading, error, reload } = useApiResource(load);
  useEffect(() => { let active = true; Promise.all([payrollApi.listPayrollPeriods({ page_size: MAX_PAGE_SIZE }), payrollApi.listPayComponents({ page_size: MAX_PAGE_SIZE }), employeesApi.loadEmployeeIndex()]).then(([p, c, e]) => { if (active) { setPeriods(p.results); setComponents(c.results.filter((item) => item.is_active)); setNames(new Map([...e.byId].map(([id, employee]) => [id, employeesApi.employeeDisplayName(employee)]))); } }).catch(() => {}); return () => { active = false; }; }, []);
  const items = useMemo(() => { const q = search.toLowerCase().trim(); return (data?.results ?? []).filter((item) => !q || (names.get(item.employee) ?? item.employee).toLowerCase().includes(q) || item.reason.toLowerCase().includes(q)); }, [data, names, search]);
  const periodNames = useMemo(() => new Map(periods.map((item) => [item.id, item.name])), [periods]);
  const componentNames = useMemo(() => new Map(components.map((item) => [item.id, item.name])), [components]);
  const create = async () => { setFormError(""); if (!form.employee || !form.payroll_period || !form.pay_component || !form.amount || !form.reason.trim()) { setFormError("Complete every adjustment field."); return; } setSaving(true); try { const created = await payrollApi.createPayrollAdjustment({ ...form, amount: form.amount, reason: form.reason.trim() }); await payrollApi.submitPayrollAdjustment(created.id); setModal(false); setForm(emptyForm); reload(); } catch (caught) { setFormError(getApiErrorMessage(caught)); } finally { setSaving(false); } };
  const review = async () => { if (!pending) return; setSaving(true); try { await (pending.action === "approve" ? payrollApi.approvePayrollAdjustment(pending.id) : payrollApi.rejectPayrollAdjustment(pending.id)); setPending(null); reload(); } catch (caught) { setFormError(getApiErrorMessage(caught)); setPending(null); } finally { setSaving(false); } };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payroll" title="Payroll adjustments" description="Create and approve adjustments before payroll calculation." icon={FileCog} accent="payroll" actions={can("payroll.prepare") ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => { setFormError(""); setModal(true); }}>New adjustment</Button> : null} />
      {formError && !modal && <Alert tone="danger" onDismiss={() => setFormError("")}>{formError}</Alert>}
      <DataTable<PayrollAdjustment>
        caption="Payroll adjustments"
        rows={items}
        rowKey={(item) => item.id}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        minWidth={880}
        toolbar={
          <DataToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search employee or reason…"
            filters={<Select size="sm" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value={ALL}>All statuses</option><option value="DRAFT">Draft</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></Select>}
            onClear={search || status !== ALL ? () => { setSearch(""); setStatus(ALL); } : undefined}
          />
        }
        empty={{ title: "No payroll adjustments found", description: "Adjustments submitted for review will appear here.", icon: FileCog, action: can("payroll.prepare") ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => { setFormError(""); setModal(true); }}>New adjustment</Button> : undefined }}
        columns={[
          { key: "employee", header: "Employee", sortValue: (item) => names.get(item.employee) ?? item.employee, cell: (item) => { const name = names.get(item.employee) ?? item.employee; return <span className="flex items-center gap-3"><Avatar name={name} size="sm" /><span className="font-semibold text-ink-strong">{name}</span></span>; } },
          { key: "component", header: "Component", cell: (item) => componentNames.get(item.pay_component) ?? item.pay_component },
          { key: "amount", header: "Amount", numeric: true, sortValue: (item) => Number(item.amount), cell: (item) => <span className="font-semibold">{formatAmount(item.amount)}</span> },
          { key: "period", header: "Period", hideBelow: "lg", cell: (item) => periodNames.get(item.payroll_period) ?? EM_DASH },
          { key: "created", header: "Created", hideBelow: "xl", sortValue: (item) => item.created_at, cell: (item) => formatDateTime(item.created_at) },
          { key: "status", header: "Status", cell: (item) => <StatusBadge status={item.status} size="sm" /> },
          {
            key: "review",
            header: <span className="sr-only">Review</span>,
            cell: (item) => item.status === "PENDING" ? (
              <div className="flex justify-end gap-1">
                {can("payroll.approve") && <IconButton size="sm" label="Reject adjustment" className="text-danger-ink hover:bg-danger-soft" onClick={() => setPending({ id: item.id, action: "reject" })}><XCircle className="h-4 w-4" /></IconButton>}
                {can("payroll.approve") && <IconButton size="sm" label="Approve adjustment" className="text-success-ink hover:bg-success-soft" onClick={() => setPending({ id: item.id, action: "approve" })}><Check className="h-4 w-4" /></IconButton>}
              </div>
            ) : null,
          },
        ]}
      />

      <Dialog
        open={modal}
        onClose={() => setModal(false)}
        dismissible={!saving}
        size="lg"
        title="New payroll adjustment"
        description="The new draft is submitted to the backend approval workflow."
        footer={<><Button variant="secondary" onClick={() => setModal(false)} disabled={saving}>Cancel</Button><Button onClick={() => void create()} loading={saving} loadingLabel="Submitting…">Submit adjustment</Button></>}
      >
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee" required><Select value={form.employee} onChange={(event) => setForm({ ...form, employee: event.target.value })}><option value="">Select employee</option>{[...names].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
            <Field label="Payroll period" required><Select value={form.payroll_period} onChange={(event) => setForm({ ...form, payroll_period: event.target.value })}><option value="">Select payroll period</option>{periods.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Pay component" required><Select value={form.pay_component} onChange={(event) => setForm({ ...form, pay_component: event.target.value })}><option value="">Select pay component</option>{components.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
            <Field label="Amount" required><Input type="number" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="tabular-nums" /></Field>
          </div>
          <Field label="Reason" required><Textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} rows={3} /></Field>
        </div>
      </Dialog>

      <ConfirmDialog open={pending !== null} title={`${pending?.action === "approve" ? "Approve" : "Reject"} adjustment`} description="This workflow action is recorded by the backend." confirmLabel={pending?.action === "approve" ? "Approve" : "Reject"} destructive={pending?.action === "reject"} loading={saving} onCancel={() => setPending(null)} onConfirm={() => void review()} />
    </div>
  );
}
