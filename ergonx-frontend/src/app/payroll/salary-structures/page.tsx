"use client";

import { useCallback, useMemo, useState } from "react";
import { Edit3, Link2, Plus, Trash2, WalletCards } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, payrollApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatNumber, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { SalaryStructure, SalaryStructureComponent } from "@/types/payroll";
import { useAccess } from "@/lib/access";

const ALL = "ALL";
type StructureForm = { code: string; name: string; description: string; is_active: boolean; components: string[] };
const emptyForm: StructureForm = { code: "", name: "", description: "", is_active: true, components: [] };

export default function SalaryStructuresPage() {
  const { can } = useAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryStructure | null>(null);
  const [deleting, setDeleting] = useState<SalaryStructure | null>(null);
  const [form, setForm] = useState<StructureForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => Promise.all([payrollApi.listSalaryStructures({ page_size: MAX_PAGE_SIZE, is_active: status === ALL ? undefined : status === "ACTIVE", ordering: "name" }), payrollApi.listPayComponents({ page_size: MAX_PAGE_SIZE, is_active: true, ordering: "name" }), payrollApi.listSalaryStructureComponents({ page_size: MAX_PAGE_SIZE, ordering: "sequence" })]), [status]);
  const { data, loading, error, reload } = useApiResource(load);
  const structures = useMemo(() => data?.[0].results ?? [], [data]);
  const payComponents = useMemo(() => data?.[1].results ?? [], [data]);
  const assignments = useMemo(() => data?.[2].results ?? [], [data]);
  const componentById = useMemo(() => new Map(payComponents.map((item) => [item.id, item])), [payComponents]);
  const assignmentsByStructure = useMemo(() => { const result = new Map<string, SalaryStructureComponent[]>(); assignments.forEach((item) => result.set(item.salary_structure, [...(result.get(item.salary_structure) ?? []), item])); return result; }, [assignments]);
  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); return structures.filter((item) => !query || item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query)); }, [structures, search]);
  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormError(""); setModalOpen(true); };
  const openEdit = (item: SalaryStructure) => { setEditing(item); setForm({ code: item.code, name: item.name, description: item.description, is_active: item.is_active, components: (assignmentsByStructure.get(item.id) ?? []).sort((a, b) => a.sequence - b.sequence).map((entry) => entry.pay_component) }); setFormError(""); setModalOpen(true); };
  const save = async () => { if (!form.name.trim() || !form.components.length) { setFormError("Name and at least one pay component are required."); return; } setSaving(true); setFormError(""); try { const payload = { code: form.code.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim(), is_active: form.is_active }; const structure = editing ? await payrollApi.updateSalaryStructure(editing.id, payload) : await payrollApi.createSalaryStructure(payload); const existing = assignmentsByStructure.get(structure.id) ?? []; const selected = new Set(form.components); await Promise.all(existing.filter((entry) => !selected.has(entry.pay_component)).map((entry) => payrollApi.deleteSalaryStructureComponent(entry.id))); let nextSequence = Math.max(0, ...existing.map((entry) => entry.sequence)) + 1; for (const componentId of form.components) { if (!existing.some((entry) => entry.pay_component === componentId)) { await payrollApi.createSalaryStructureComponent({ salary_structure: structure.id, pay_component: componentId, default_amount: null, default_percentage: null, percentage_base_component: null, sequence: nextSequence++, is_required: true }); } } setModalOpen(false); reload(); } catch (caught) { setFormError(getApiErrorMessage(caught)); } finally { setSaving(false); } };
  const remove = async () => { if (!deleting) return; setSaving(true); try { await payrollApi.deleteSalaryStructure(deleting.id); setDeleting(null); reload(); } catch (caught) { setFormError(getApiErrorMessage(caught)); setDeleting(null); } finally { setSaving(false); } };
  const toggle = (id: string) => setForm((current) => ({ ...current, components: current.components.includes(id) ? current.components.filter((item) => item !== id) : [...current.components, id] }));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payroll" title="Salary structures" description="Define reusable salary structures and associate approved pay components." icon={WalletCards} accent="payroll" actions={can("compensation.configure") ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add structure</Button> : null} />
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Structure summary">
        <MetricCard size="sm" label="Total structures" value={formatNumber(data?.[0].count ?? 0)} accent="payroll" loading={loading && !data} />
        <MetricCard size="sm" label="Active" value={formatNumber(structures.filter((item) => item.is_active).length)} accent="accounting" loading={loading && !data} />
        <MetricCard size="sm" label="Component assignments" value={formatNumber(assignments.length)} accent="hr" loading={loading && !data} />
      </section>
      {formError && !modalOpen && <Alert tone="danger" onDismiss={() => setFormError("")}>{formError}</Alert>}
      <DataTable<SalaryStructure>
        caption="Salary structures"
        rows={filtered}
        rowKey={(item) => item.id}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        minWidth={780}
        toolbar={
          <DataToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search salary structures…"
            filters={<Select size="sm" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value={ALL}>All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>}
            onClear={search || status !== ALL ? () => { setSearch(""); setStatus(ALL); } : undefined}
          />
        }
        empty={{ title: "No salary structures found", description: "Create a structure and attach the pay components it uses.", icon: WalletCards, action: can("compensation.configure") ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add structure</Button> : undefined }}
        columns={[
          { key: "code", header: "Code", sortValue: (item) => item.code, cell: (item) => <span className="font-mono font-semibold text-ink-strong">{item.code}</span> },
          { key: "name", header: "Structure", sortValue: (item) => item.name, cell: (item) => <span><span className="block font-semibold text-ink-strong">{item.name}</span>{item.description && <span className="block max-w-sm truncate text-caption text-ink-muted" title={item.description}>{item.description}</span>}</span> },
          { key: "components", header: "Components", cell: (item) => { const entries = assignmentsByStructure.get(item.id) ?? []; return <span className="flex flex-wrap gap-1">{entries.slice(0, 3).map((entry) => <Badge key={entry.id} size="sm" accent="payroll">{componentById.get(entry.pay_component)?.code ?? entry.pay_component}</Badge>)}{entries.length > 3 && <Badge size="sm">+{entries.length - 3}</Badge>}{!entries.length && <span className="text-caption text-ink-subtle">None</span>}</span>; } },
          { key: "status", header: "Status", cell: (item) => <StatusBadge status={item.is_active ? "ACTIVE" : "INACTIVE"} size="sm" /> },
          { key: "actions", header: <span className="sr-only">Actions</span>, cell: (item) => <div className="flex justify-end gap-1">{can("compensation.configure") && <IconButton size="sm" label={`Edit ${item.name}`} onClick={() => openEdit(item)}><Edit3 className="h-4 w-4" /></IconButton>}{can("compensation.configure") && <IconButton size="sm" label={`Delete ${item.name}`} className="text-danger-ink hover:bg-danger-soft" onClick={() => setDeleting(item)}><Trash2 className="h-4 w-4" /></IconButton>}</div> },
        ]}
      />

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        dismissible={!saving}
        size="lg"
        title={editing ? "Edit salary structure" : "Add salary structure"}
        description="Associate reusable pay components with this structure."
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} loading={saving} loadingLabel="Saving…">{editing ? "Save changes" : "Create structure"}</Button></>}
      >
        <div className="space-y-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Code" optional><Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="Auto-generated if left blank" className="font-mono" data-autofocus /></Field>
            <Field label="Name" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          </div>
          <Field label="Description" optional><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={3} /></Field>
          <Checkbox label="Active" description="Inactive structures cannot be assigned to new compensation records." checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
          <div>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-strong"><Link2 className="h-4 w-4 text-mod-payroll" aria-hidden="true" />Associated components <span className="font-normal text-ink-muted">({form.components.length} selected)</span></p>
            {!payComponents.length ? <p className="text-support text-ink-muted">No active pay components are available.</p> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {payComponents.map((component) => {
                  const selected = form.components.includes(component.id);
                  return (
                    <label key={component.id} className={cx("flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors", selected ? "border-mod-payroll bg-mod-payroll-soft" : "border-line hover:bg-surface-hover")}>
                      <input type="checkbox" checked={selected} onChange={() => toggle(component.id)} className="h-4 w-4" />
                      <span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink-strong">{component.name}</span><span className="block text-caption text-ink-muted">{component.code} · {humanizeEnum(component.component_type)}</span></span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      <ConfirmDialog open={deleting !== null} title="Delete salary structure" description={deleting ? `Delete ${deleting.name}? Structures used in employee compensation records cannot be deleted by the backend.` : ""} confirmLabel="Delete" destructive loading={saving} onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
    </div>
  );
}
