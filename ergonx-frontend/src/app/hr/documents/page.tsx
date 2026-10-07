"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Edit3, FileCheck2, Plus, ShieldCheck, Trash2, Users } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { documentChecklistApi, getApiErrorMessage } from "@/lib/api";
import type { DocumentRequirement, EmployeeCompliance, RequirementCompliance } from "@/lib/api/documentChecklist";
import { useAccess } from "@/lib/access";
import { cx } from "@/lib/cx";
import { formatNumber, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { EMPLOYMENT_TYPES } from "@/types/hr";

type View = "compliance" | "requirements";
type RequirementForm = { name: string; description: string; document_category: string; employment_types: string[]; validity_months: string; is_mandatory: boolean; sort_order: string };
const emptyForm: RequirementForm = { name: "", description: "", document_category: "", employment_types: [], validity_months: "", is_mandatory: true, sort_order: "0" };
// Matches the self-service upload categories, so employees can file these themselves.
const SUGGESTED_CATEGORIES = ["Identification", "Contract", "Qualification", "Certificate", "Medical", "Bank details"];

function rateTone(rate: number) {
  return rate >= 90 ? "bg-success" : rate >= 70 ? "bg-warning" : "bg-danger";
}

function ProgressBar({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-28 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><span className={cx("block h-full rounded-full", rateTone(value))} style={{ width: `${Math.min(100, value)}%` }} /></span>
      <span className="text-caption font-semibold tabular-nums text-ink-strong">{value.toFixed(0)}%</span>
    </span>
  );
}

/** Document checklist (ErgonX HR): what HR requires on file, and who is missing what. */
export default function DocumentChecklistPage() {
  const router = useRouter();
  const { can } = useAccess();
  const canManage = can("document_requirement.manage");
  const [view, setView] = useState<View>("compliance");
  const [search, setSearch] = useState("");
  const [onlyOutstanding, setOnlyOutstanding] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentRequirement | null>(null);
  const [deactivating, setDeactivating] = useState<DocumentRequirement | null>(null);
  const [form, setForm] = useState<RequirementForm>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => Promise.all([documentChecklistApi.getCompliance(), documentChecklistApi.listRequirements({ is_active: true, ordering: "sort_order" })]), []);
  const { data, loading, error, reload } = useApiResource(load);
  const overview = data?.[0];
  const requirements = useMemo(() => data?.[1].results ?? [], [data]);
  const initial = loading && !data;

  const employees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (overview?.employees_detail ?? []).filter((row) => (!onlyOutstanding || !row.complete) && (!query || row.employee.toLowerCase().includes(query) || row.employee_number.toLowerCase().includes(query)));
  }, [overview, search, onlyOutstanding]);
  const expiring = overview?.requirements.reduce((sum, row) => sum + row.EXPIRING, 0) ?? 0;

  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormError(""); setModalOpen(true); };
  const openEdit = (item: DocumentRequirement) => {
    setEditing(item);
    setForm({ name: item.name, description: item.description, document_category: item.document_category, employment_types: item.employment_types, validity_months: item.validity_months ? String(item.validity_months) : "", is_mandatory: item.is_mandatory, sort_order: String(item.sort_order) });
    setFormError("");
    setModalOpen(true);
  };
  const save = async () => {
    if (!form.name.trim() || !form.document_category.trim()) { setFormError("Enter a name and the document category that satisfies it."); return; }
    setSaving(true);
    setFormError("");
    const payload = { name: form.name.trim(), description: form.description.trim(), document_category: form.document_category.trim(), employment_types: form.employment_types, validity_months: form.validity_months ? Number(form.validity_months) : null, is_mandatory: form.is_mandatory, sort_order: Number(form.sort_order) || 0 };
    try {
      if (editing) await documentChecklistApi.updateRequirement(editing.id, payload);
      else await documentChecklistApi.createRequirement(payload);
      setModalOpen(false);
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  const deactivate = async () => {
    if (!deactivating) return;
    setSaving(true);
    try { await documentChecklistApi.deactivateRequirement(deactivating.id); setDeactivating(null); reload(); }
    catch (caught) { setFormError(getApiErrorMessage(caught)); setDeactivating(null); }
    finally { setSaving(false); }
  };
  const toggleType = (type: string) => setForm((current) => ({ ...current, employment_types: current.employment_types.includes(type) ? current.employment_types.filter((item) => item !== type) : [...current.employment_types, type] }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Human Resources"
        title="Document checklist"
        description="The documents every employee must have on file, and who is still missing them."
        icon={FileCheck2}
        accent="hr"
        actions={canManage ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add requirement</Button> : null}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Document compliance summary">
        <MetricCard label="Compliance rate" value={overview ? `${overview.compliance_rate.toFixed(1)}%` : "—"} description="Required documents on file or waived" icon={ShieldCheck} accent="hr" loading={initial} />
        <MetricCard label="Fully compliant" value={overview ? formatNumber(overview.complete_employees) : "—"} description={overview ? `of ${formatNumber(overview.employees)} employees` : undefined} icon={CheckCircle2} accent="attendance" loading={initial} />
        <MetricCard label="With documents outstanding" value={overview ? formatNumber(overview.employees - overview.complete_employees) : "—"} description="Missing or expired" icon={AlertTriangle} accent="audit" loading={initial} />
        <MetricCard label="Expiring within 30 days" value={formatNumber(expiring)} description="Renewable documents to follow up" icon={Users} accent="leave" loading={initial} />
      </section>

      {formError && !modalOpen && <Alert tone="danger" onDismiss={() => setFormError("")}>{formError}</Alert>}

      <Tabs label="Document checklist" value={view} onChange={(value) => setView(value as View)} items={[{ value: "compliance", label: "Compliance" }, { value: "requirements", label: `Requirements (${requirements.length})` }]} />

      {view === "compliance" ? (
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <DataTable<RequirementCompliance>
            caption="Compliance by requirement"
            rows={overview?.requirements}
            rowKey={(row) => row.requirement_id}
            loading={initial}
            error={error}
            onRetry={reload}
            minWidth={520}
            empty={{ title: "No requirements yet", description: "Add the documents HR needs from every employee, such as a Ghana Card or signed contract.", icon: FileCheck2, action: canManage ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add requirement</Button> : undefined }}
            columns={[
              { key: "requirement", header: "Requirement", cell: (row) => <span><span className="block font-semibold text-ink-strong">{row.requirement}</span><span className="text-caption text-ink-muted">{row.document_category}{row.validity_months ? ` · renew every ${row.validity_months} months` : ""}{row.is_mandatory ? "" : " · optional"}</span></span> },
              { key: "rate", header: "On file", cell: (row) => <ProgressBar value={row.applicable ? ((row.ON_FILE + row.EXPIRING + row.WAIVED) * 100) / row.applicable : 100} /> },
              { key: "missing", header: "Missing", numeric: true, cell: (row) => formatNumber(row.MISSING) },
              { key: "expired", header: "Expired", numeric: true, hideBelow: "md", cell: (row) => formatNumber(row.EXPIRED) },
            ]}
          />
          <DataTable<EmployeeCompliance>
            caption="Compliance by employee"
            rows={employees}
            rowKey={(row) => row.employee_id}
            loading={initial}
            minWidth={560}
            onRowClick={(row) => router.push(`/hr/employees/${row.employee_id}?tab=documents`)}
            toolbar={<DataToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search employees…" filters={<Checkbox label="Only outstanding" checked={onlyOutstanding} onChange={(event) => setOnlyOutstanding(event.target.checked)} />} />}
            empty={{ title: onlyOutstanding ? "Everyone is up to date" : "No employees found", description: onlyOutstanding ? "No employee is missing a required document." : undefined, icon: CheckCircle2 }}
            columns={[
              { key: "employee", header: "Employee", sortValue: (row) => row.employee, cell: (row) => <span><span className="block font-semibold text-ink-strong">{row.employee}</span><span className="text-caption text-ink-muted">{row.employee_number}</span></span> },
              { key: "rate", header: "Compliance", sortValue: (row) => row.compliance_rate, cell: (row) => <ProgressBar value={row.compliance_rate} /> },
              { key: "outstanding", header: "Outstanding", cell: (row) => row.outstanding.length ? <span className="flex flex-wrap gap-1">{row.outstanding.slice(0, 3).map((name) => <Badge key={name} size="sm" tone="danger">{name}</Badge>)}{row.outstanding.length > 3 && <Badge size="sm">+{row.outstanding.length - 3}</Badge>}</span> : <Badge size="sm" tone="success">Complete</Badge> },
            ]}
          />
        </div>
      ) : (
        <DataTable<DocumentRequirement>
          caption="Document requirements"
          rows={requirements}
          rowKey={(row) => row.id}
          loading={initial}
          error={error}
          onRetry={reload}
          minWidth={760}
          empty={{ title: "No requirements yet", description: "Add the documents HR needs from every employee.", icon: FileCheck2, action: canManage ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>Add requirement</Button> : undefined }}
          columns={[
            { key: "name", header: "Requirement", sortValue: (row) => row.name, cell: (row) => <span><span className="block font-semibold text-ink-strong">{row.name}</span>{row.description && <span className="block max-w-md truncate text-caption text-ink-muted" title={row.description}>{row.description}</span>}</span> },
            { key: "category", header: "Document category", cell: (row) => <Badge size="sm" accent="hr">{row.document_category}</Badge> },
            { key: "applies", header: "Applies to", cell: (row) => row.employment_types.length ? row.employment_types.map(humanizeEnum).join(", ") : "All employees" },
            { key: "validity", header: "Renewal", cell: (row) => row.validity_months ? `Every ${row.validity_months} months` : "Not renewable" },
            { key: "mandatory", header: "Type", cell: (row) => <Badge size="sm" tone={row.is_mandatory ? "brand" : "neutral"}>{row.is_mandatory ? "Required" : "Optional"}</Badge> },
            { key: "actions", header: <span className="sr-only">Actions</span>, cell: (row) => canManage ? <div className="flex justify-end gap-1"><IconButton size="sm" label={`Edit ${row.name}`} onClick={() => openEdit(row)}><Edit3 className="h-4 w-4" /></IconButton><IconButton size="sm" label={`Remove ${row.name}`} className="text-danger-ink hover:bg-danger-soft" onClick={() => setDeactivating(row)}><Trash2 className="h-4 w-4" /></IconButton></div> : null },
          ]}
        />
      )}

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        dismissible={!saving}
        size="lg"
        title={editing ? "Edit requirement" : "Add requirement"}
        description="An employee meets this requirement when a document with the matching category is on their record."
        footer={<><Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} loading={saving} loadingLabel="Saving…">{editing ? "Save changes" : "Add requirement"}</Button></>}
      >
        <div className="space-y-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <datalist id="document-category-suggestions">{SUGGESTED_CATEGORIES.map((item) => <option key={item} value={item} />)}</datalist>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Ghana Card" data-autofocus /></Field>
            <Field label="Document category" required helper="Documents filed under this category count. Employees can upload these themselves.">
              <Input value={form.document_category} onChange={(event) => setForm({ ...form, document_category: event.target.value })} list="document-category-suggestions" placeholder="e.g. Identification" />
            </Field>
          </div>
          <Field label="Description" optional><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Renew every (months)" optional helper="Leave blank for documents that never expire."><Input type="number" min={1} max={120} value={form.validity_months} onChange={(event) => setForm({ ...form, validity_months: event.target.value })} /></Field>
            <Field label="Display order" optional><Input type="number" min={0} value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} /></Field>
          </div>
          <Field label="Applies to" helper="Leave all unticked to require it from every employee.">
            <div className="flex flex-wrap gap-3">{EMPLOYMENT_TYPES.map((type) => <Checkbox key={type} label={humanizeEnum(type)} checked={form.employment_types.includes(type)} onChange={() => toggleType(type)} />)}</div>
          </Field>
          <Checkbox label="Required" description="Optional documents are tracked but don't count toward compliance." checked={form.is_mandatory} onChange={(event) => setForm({ ...form, is_mandatory: event.target.checked })} />
        </div>
      </Dialog>

      <ConfirmDialog open={deactivating !== null} title="Remove requirement" description={deactivating ? `Stop requiring ${deactivating.name}? Documents already on file are kept.` : ""} confirmLabel="Remove" destructive loading={saving} onCancel={() => setDeactivating(null)} onConfirm={() => void deactivate()} />
    </div>
  );
}
