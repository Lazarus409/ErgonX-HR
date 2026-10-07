"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3, ListChecks, Plus, Target, Trash2 } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable } from "@/components/ui/DataTable";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { getApiErrorMessage, performanceApi } from "@/lib/api";
import { CYCLE_STATUS_LABELS, CYCLE_STATUS_TONES, type Competency, type ReviewCycle } from "@/lib/api/performance";
import { useAccess } from "@/lib/access";
import { formatDate, formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

type View = "cycles" | "competencies";
type CycleForm = { name: string; description: string; period_start: string; period_end: string; self_assessment_due: string; manager_review_due: string; competencies: string[] };
const emptyCycle: CycleForm = { name: "", description: "", period_start: "", period_end: "", self_assessment_due: "", manager_review_due: "", competencies: [] };

function Progress({ done, total }: { done: number; total: number }) {
  const percent = total ? (done * 100) / total : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-28 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true"><span className="block h-full rounded-full bg-success" style={{ width: `${percent}%` }} /></span>
      <span className="text-caption tabular-nums text-ink-muted">{formatNumber(done)} / {formatNumber(total)}</span>
    </span>
  );
}

/** Performance (ErgonX HR): review cycles and the competencies people are rated on. */
export default function PerformancePage() {
  const router = useRouter();
  const { can } = useAccess();
  const canManage = can("performance.manage");
  const [view, setView] = useState<View>("cycles");
  const [pageError, setPageError] = useState("");

  const load = useCallback(() => Promise.all([performanceApi.listCycles(), performanceApi.listCompetencies({ is_active: true, ordering: "sort_order" })]), []);
  const { data, loading, error, reload } = useApiResource(load);
  const cycles = useMemo(() => data?.[0].results ?? [], [data]);
  const competencies = useMemo(() => data?.[1].results ?? [], [data]);
  const initial = loading && !data;

  const [cycleOpen, setCycleOpen] = useState(false);
  const [editingCycle, setEditingCycle] = useState<ReviewCycle | null>(null);
  const [cycleForm, setCycleForm] = useState<CycleForm>(emptyCycle);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const openCycle = (cycle: ReviewCycle | null) => {
    setEditingCycle(cycle);
    setCycleForm(cycle ? { name: cycle.name, description: cycle.description, period_start: cycle.period_start, period_end: cycle.period_end, self_assessment_due: cycle.self_assessment_due ?? "", manager_review_due: cycle.manager_review_due ?? "", competencies: cycle.competencies } : { ...emptyCycle, competencies: competencies.map((item) => item.id) });
    setFormError("");
    setCycleOpen(true);
  };
  const saveCycle = async () => {
    if (!cycleForm.name.trim() || !cycleForm.period_start || !cycleForm.period_end) { setFormError("Give the cycle a name and its review period."); return; }
    if (!cycleForm.competencies.length) { setFormError("Choose at least one competency."); return; }
    setSaving(true);
    setFormError("");
    const payload = { ...cycleForm, name: cycleForm.name.trim(), self_assessment_due: cycleForm.self_assessment_due || null, manager_review_due: cycleForm.manager_review_due || null };
    try {
      const saved = editingCycle ? await performanceApi.updateCycle(editingCycle.id, payload) : await performanceApi.createCycle(payload);
      setCycleOpen(false);
      if (editingCycle) reload();
      else router.push(`/performance/cycles/${saved.id}`);
    } catch (caught) { setFormError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };

  const [competencyOpen, setCompetencyOpen] = useState(false);
  const [editingCompetency, setEditingCompetency] = useState<Competency | null>(null);
  const [competencyForm, setCompetencyForm] = useState({ name: "", description: "", sort_order: "0" });
  const [removing, setRemoving] = useState<Competency | null>(null);
  const openCompetency = (item: Competency | null) => {
    setEditingCompetency(item);
    setCompetencyForm(item ? { name: item.name, description: item.description, sort_order: String(item.sort_order) } : { name: "", description: "", sort_order: String(competencies.length + 1) });
    setFormError("");
    setCompetencyOpen(true);
  };
  const saveCompetency = async () => {
    if (!competencyForm.name.trim()) { setFormError("Name the competency."); return; }
    setSaving(true);
    setFormError("");
    const payload = { name: competencyForm.name.trim(), description: competencyForm.description.trim(), sort_order: Number(competencyForm.sort_order) || 0 };
    try {
      if (editingCompetency) await performanceApi.updateCompetency(editingCompetency.id, payload);
      else await performanceApi.createCompetency(payload);
      setCompetencyOpen(false);
      reload();
    } catch (caught) { setFormError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const removeCompetency = async () => {
    if (!removing) return;
    setSaving(true);
    try { await performanceApi.deactivateCompetency(removing.id); setRemoving(null); reload(); }
    catch (caught) { setPageError(getApiErrorMessage(caught)); setRemoving(null); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Human Resources"
        title="Performance"
        description="Run review cycles: self-assessment, manager review and HR sign-off."
        icon={Target}
        accent="hr"
        actions={canManage ? <div className="flex flex-wrap gap-2"><Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openCompetency(null)}>Add competency</Button><Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openCycle(null)}>New review cycle</Button></div> : null}
      />
      {pageError && <Alert tone="danger" onDismiss={() => setPageError("")}>{pageError}</Alert>}

      <Tabs label="Performance" value={view} onChange={(value) => setView(value as View)} items={[{ value: "cycles", label: `Review cycles (${cycles.length})` }, { value: "competencies", label: `Competencies (${competencies.length})` }]} />

      {view === "cycles" ? (
        <DataTable<ReviewCycle>
          caption="Review cycles"
          rows={cycles}
          rowKey={(row) => row.id}
          loading={initial}
          error={error}
          onRetry={reload}
          minWidth={820}
          onRowClick={(row) => router.push(`/performance/cycles/${row.id}`)}
          empty={{ title: "No review cycles yet", description: "Create a cycle, choose the competencies, then launch it for your people.", icon: Target, action: canManage ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openCycle(null)}>New review cycle</Button> : undefined }}
          columns={[
            { key: "name", header: "Cycle", cell: (row) => <span><span className="block font-semibold text-ink-strong">{row.name}</span><span className="text-caption text-ink-muted">{formatDate(row.period_start)} – {formatDate(row.period_end)}</span></span> },
            { key: "status", header: "Status", cell: (row) => <Badge size="sm" tone={CYCLE_STATUS_TONES[row.status]}>{CYCLE_STATUS_LABELS[row.status]}</Badge> },
            { key: "progress", header: "Completed", cell: (row) => row.status === "DRAFT" ? <span className="text-caption text-ink-subtle">Not launched</span> : <Progress done={row.completed_count ?? 0} total={row.review_count ?? 0} /> },
            { key: "due", header: "Deadlines", hideBelow: "lg", cell: (row) => <span className="text-caption text-ink-muted">{row.self_assessment_due ? `Self ${formatDate(row.self_assessment_due)}` : "—"}{row.manager_review_due ? ` · Manager ${formatDate(row.manager_review_due)}` : ""}</span> },
            { key: "actions", header: <span className="sr-only">Actions</span>, cell: (row) => canManage && row.status === "DRAFT" ? <IconButton size="sm" label={`Edit ${row.name}`} onClick={(event) => { event.stopPropagation(); openCycle(row); }}><Edit3 className="h-4 w-4" /></IconButton> : null },
          ]}
        />
      ) : (
        <DataTable<Competency>
          caption="Competencies"
          rows={competencies}
          rowKey={(row) => row.id}
          loading={initial}
          error={error}
          onRetry={reload}
          minWidth={600}
          empty={{ title: "No competencies yet", description: "Competencies are what employees and managers rate, from 1 to 5.", icon: ListChecks, action: canManage ? <Button variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openCompetency(null)}>Add competency</Button> : undefined }}
          columns={[
            { key: "name", header: "Competency", cell: (row) => <span><span className="block font-semibold text-ink-strong">{row.name}</span>{row.description && <span className="text-caption text-ink-muted">{row.description}</span>}</span> },
            { key: "actions", header: <span className="sr-only">Actions</span>, cell: (row) => canManage ? <div className="flex justify-end gap-1"><IconButton size="sm" label={`Edit ${row.name}`} onClick={() => openCompetency(row)}><Edit3 className="h-4 w-4" /></IconButton><IconButton size="sm" label={`Remove ${row.name}`} className="text-danger-ink hover:bg-danger-soft" onClick={() => setRemoving(row)}><Trash2 className="h-4 w-4" /></IconButton></div> : null },
          ]}
        />
      )}

      <Dialog open={cycleOpen} onClose={() => setCycleOpen(false)} dismissible={!saving} size="lg" title={editingCycle ? "Edit review cycle" : "New review cycle"} description="You can launch the cycle for your people once it is set up." footer={<><Button variant="secondary" onClick={() => setCycleOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void saveCycle()} loading={saving}>{editingCycle ? "Save changes" : "Create cycle"}</Button></>}>
        <div className="space-y-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Name" required><Input value={cycleForm.name} onChange={(event) => setCycleForm({ ...cycleForm, name: event.target.value })} placeholder="e.g. 2026 Mid-Year Review" data-autofocus /></Field>
          <Field label="Description" optional><Textarea value={cycleForm.description} onChange={(event) => setCycleForm({ ...cycleForm, description: event.target.value })} rows={2} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Period starts" required><Input type="date" value={cycleForm.period_start} onChange={(event) => setCycleForm({ ...cycleForm, period_start: event.target.value })} /></Field>
            <Field label="Period ends" required><Input type="date" value={cycleForm.period_end} onChange={(event) => setCycleForm({ ...cycleForm, period_end: event.target.value })} /></Field>
            <Field label="Self-assessments due" optional><Input type="date" value={cycleForm.self_assessment_due} onChange={(event) => setCycleForm({ ...cycleForm, self_assessment_due: event.target.value })} /></Field>
            <Field label="Manager reviews due" optional><Input type="date" value={cycleForm.manager_review_due} onChange={(event) => setCycleForm({ ...cycleForm, manager_review_due: event.target.value })} /></Field>
          </div>
          <Field label="Competencies rated in this cycle" required>
            <div className="grid gap-2 sm:grid-cols-2">{competencies.map((item) => <Checkbox key={item.id} label={item.name} checked={cycleForm.competencies.includes(item.id)} onChange={() => setCycleForm((current) => ({ ...current, competencies: current.competencies.includes(item.id) ? current.competencies.filter((id) => id !== item.id) : [...current.competencies, item.id] }))} />)}</div>
          </Field>
        </div>
      </Dialog>

      <Dialog open={competencyOpen} onClose={() => setCompetencyOpen(false)} dismissible={!saving} title={editingCompetency ? "Edit competency" : "Add competency"} footer={<><Button variant="secondary" onClick={() => setCompetencyOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void saveCompetency()} loading={saving}>Save</Button></>}>
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Field label="Name" required><Input value={competencyForm.name} onChange={(event) => setCompetencyForm({ ...competencyForm, name: event.target.value })} placeholder="e.g. Safety compliance" data-autofocus /></Field>
          <Field label="What good looks like" optional><Textarea value={competencyForm.description} onChange={(event) => setCompetencyForm({ ...competencyForm, description: event.target.value })} rows={3} /></Field>
          <Field label="Display order" optional><Input type="number" min={0} value={competencyForm.sort_order} onChange={(event) => setCompetencyForm({ ...competencyForm, sort_order: event.target.value })} /></Field>
        </div>
      </Dialog>

      <ConfirmDialog open={removing !== null} title="Remove competency" description={removing ? `Stop using ${removing.name} in new cycles? Existing reviews keep their ratings.` : ""} confirmLabel="Remove" destructive loading={saving} onCancel={() => setRemoving(null)} onConfirm={() => void removeCompetency()} />
    </div>
  );
}
