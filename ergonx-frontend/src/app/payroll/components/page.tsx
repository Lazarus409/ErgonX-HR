"use client";

import { useCallback, useMemo, useState } from "react";
import { Banknote, Edit3, Plus, Trash2 } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Checkbox, Field, Input, Select } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, payrollApi } from "@/lib/api";
import { formatNumber, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { PayComponent, PayComponentCalculationType, PayComponentCashOrKind, PayComponentType } from "@/types/payroll";
import { useAccess } from "@/lib/access";

const ALL = "ALL";
type ComponentForm = { code: string; name: string; component_type: PayComponentType; calculation_type: PayComponentCalculationType; taxable: boolean; pensionable: boolean; cash_or_kind: PayComponentCashOrKind; recurring: boolean; is_active: boolean };
const emptyForm: ComponentForm = { code: "", name: "", component_type: "EARNING", calculation_type: "FIXED", taxable: true, pensionable: false, cash_or_kind: "CASH", recurring: true, is_active: true };
const typeTone = { EARNING: "success", DEDUCTION: "danger", EMPLOYER_CONTRIBUTION: "brand" } as const;

export default function PayComponentsPage() {
  const { can } = useAccess();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PayComponent | null>(null);
  const [deleting, setDeleting] = useState<PayComponent | null>(null);
  const [form, setForm] = useState<ComponentForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => payrollApi.listPayComponents({ page_size: MAX_PAGE_SIZE, component_type: typeFilter === ALL ? undefined : typeFilter, is_active: statusFilter === ALL ? undefined : statusFilter === "ACTIVE", ordering: "name" }), [typeFilter, statusFilter]);
  const { data, loading, error, reload } = useApiResource(load);
  const components = useMemo(() => data?.results ?? [], [data]);
  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); return components.filter((item) => !query || item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query)); }, [components, search]);
  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormError(""); setModalOpen(true); };
  const openEdit = (item: PayComponent) => { setEditing(item); setForm({ code: item.code, name: item.name, component_type: item.component_type, calculation_type: item.calculation_type, taxable: item.taxable, pensionable: item.pensionable, cash_or_kind: item.cash_or_kind, recurring: item.recurring, is_active: item.is_active }); setFormError(""); setModalOpen(true); };
  const save = async () => { if (!form.name.trim()) { setFormError("Component name is required."); return; } setSaving(true); setFormError(""); try { const payload = { ...form, code: form.code.trim().toUpperCase(), name: form.name.trim() }; if (editing) await payrollApi.updatePayComponent(editing.id, payload); else await payrollApi.createPayComponent(payload); setModalOpen(false); reload(); } catch (caught) { setFormError(getApiErrorMessage(caught)); } finally { setSaving(false); } };
  const remove = async () => { if (!deleting) return; setSaving(true); try { await payrollApi.deletePayComponent(deleting.id); setDeleting(null); reload(); } catch (caught) { setFormError(getApiErrorMessage(caught)); setDeleting(null); } finally { setSaving(false); } };
  const set = <K extends keyof ComponentForm>(key: K, value: ComponentForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payroll" title="Pay components" description="Configure earnings, deductions and employer contributions used by payroll." icon={Banknote} accent="payroll" actions={can("compensation.configure") ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add component</Button> : null} />
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Component summary">
        <MetricCard size="sm" label="Total components" value={formatNumber(data?.count ?? 0)} accent="payroll" loading={loading && !data} />
        <MetricCard size="sm" label="Active" value={formatNumber(components.filter((item) => item.is_active).length)} accent="accounting" loading={loading && !data} />
        <MetricCard size="sm" label="Earnings" value={formatNumber(components.filter((item) => item.component_type === "EARNING").length)} accent="hr" loading={loading && !data} />
      </section>
      {formError && !modalOpen && <Alert tone="danger" onDismiss={() => setFormError("")}>{formError}</Alert>}
      <DataTable<PayComponent>
        caption="Pay components"
        rows={filtered}
        rowKey={(item) => item.id}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        minWidth={860}
        toolbar={
          <DataToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by code or component name…"
            filters={
              <>
                <Select size="sm" aria-label="Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value={ALL}>All types</option><option value="EARNING">Earnings</option><option value="DEDUCTION">Deductions</option><option value="EMPLOYER_CONTRIBUTION">Employer contributions</option></Select>
                <Select size="sm" aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value={ALL}>All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>
              </>
            }
            onClear={search || typeFilter !== ALL || statusFilter !== ALL ? () => { setSearch(""); setTypeFilter(ALL); setStatusFilter(ALL); } : undefined}
          />
        }
        empty={{ title: "No pay components found", description: "Add earnings, deductions and employer contributions to build salary structures.", icon: Banknote, action: can("compensation.configure") ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add component</Button> : undefined }}
        columns={[
          { key: "code", header: "Code", sortValue: (item) => item.code, cell: (item) => <span className="font-mono font-semibold text-ink-strong">{item.code}</span> },
          { key: "name", header: "Component", sortValue: (item) => item.name, cell: (item) => <span>{item.name}{!item.recurring && <Badge size="sm" className="ml-2">One-off</Badge>}</span> },
          { key: "type", header: "Type", cell: (item) => <Badge size="sm" tone={typeTone[item.component_type] ?? "neutral"}>{humanizeEnum(item.component_type)}</Badge> },
          { key: "calc", header: "Calculation", cell: (item) => humanizeEnum(item.calculation_type) },
          { key: "taxable", header: "Taxable", hideBelow: "lg", cell: (item) => (item.taxable ? "Yes" : "No") },
          { key: "pensionable", header: "Pensionable", hideBelow: "lg", cell: (item) => (item.pensionable ? "Yes" : "No") },
          { key: "status", header: "Status", cell: (item) => <StatusBadge status={item.is_active ? "ACTIVE" : "INACTIVE"} size="sm" /> },
          { key: "actions", header: <span className="sr-only">Actions</span>, cell: (item) => <div className="flex justify-end gap-1">{can("compensation.configure") && <IconButton size="sm" label={`Edit ${item.name}`} onClick={() => openEdit(item)}><Edit3 className="h-4 w-4" /></IconButton>}{can("compensation.configure") && <IconButton size="sm" label={`Delete ${item.name}`} className="text-danger-ink hover:bg-danger-soft" onClick={() => setDeleting(item)}><Trash2 className="h-4 w-4" /></IconButton>}</div> },
        ]}
      />

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        dismissible={!saving}
        size="lg"
        title={editing ? "Edit pay component" : "Add pay component"}
        description="Define the component metadata used by payroll."
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} loading={saving} loadingLabel="Saving…">{editing ? "Save changes" : "Create component"}</Button></>}
      >
        <div className="space-y-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" optional helper="Leave blank to generate one, or use a meaningful code such as BASIC."><Input value={form.code} onChange={(event) => set("code", event.target.value.toUpperCase())} placeholder="Auto-generated" className="font-mono" data-autofocus /></Field>
            <Field label="Name" required><Input value={form.name} onChange={(event) => set("name", event.target.value)} /></Field>
            <Field label="Type"><Select value={form.component_type} onChange={(event) => set("component_type", event.target.value as PayComponentType)}><option value="EARNING">Earning</option><option value="DEDUCTION">Deduction</option><option value="EMPLOYER_CONTRIBUTION">Employer contribution</option></Select></Field>
            <Field label="Calculation"><Select value={form.calculation_type} onChange={(event) => set("calculation_type", event.target.value as PayComponentCalculationType)}><option value="FIXED">Fixed</option><option value="PERCENTAGE">Percentage</option></Select></Field>
            <Field label="Payment kind"><Select value={form.cash_or_kind} onChange={(event) => set("cash_or_kind", event.target.value as PayComponentCashOrKind)}><option value="CASH">Cash</option><option value="KIND">Benefit in kind</option></Select></Field>
          </div>
          <div className="grid gap-3 rounded-xl bg-surface-muted/60 p-4 sm:grid-cols-2">
            <Checkbox label="Taxable" checked={form.taxable} onChange={(event) => set("taxable", event.target.checked)} />
            <Checkbox label="Pensionable" checked={form.pensionable} onChange={(event) => set("pensionable", event.target.checked)} />
            <Checkbox label="Recurring" checked={form.recurring} onChange={(event) => set("recurring", event.target.checked)} />
            <Checkbox label="Active" checked={form.is_active} onChange={(event) => set("is_active", event.target.checked)} />
          </div>
        </div>
      </Dialog>

      <ConfirmDialog open={deleting !== null} title="Delete pay component" description={deleting ? `Delete ${deleting.name}? Components in use by a salary structure cannot be deleted by the backend.` : ""} confirmLabel="Delete" destructive loading={saving} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
    </div>
  );
}
