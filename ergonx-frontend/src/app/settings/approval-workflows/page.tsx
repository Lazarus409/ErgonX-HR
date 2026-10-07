"use client";

import { Clock3, GitPullRequest, Pencil, Plus, Search, ShieldCheck, Trash2, Zap } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, institutionsApi, organizationApi, workflowsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useApiResource } from "@/lib/useApiResource";
import type { Department } from "@/types/hr";
import type { InstitutionMembership, InstitutionRole } from "@/types/institutions";
import {
  APPROVAL_TRIGGER_LABELS,
  APPROVER_TYPE_LABELS,
  CONNECTED_TRIGGERS,
  type ApprovalTrigger,
  type ApprovalWorkflow,
  type ApprovalWorkflowStep,
  type ApproverType,
} from "@/types/workflows";
import { EXCLUDED_APPROVAL_TRIGGERS } from "@/lib/product";

const TRIGGERS = (Object.keys(APPROVAL_TRIGGER_LABELS) as ApprovalTrigger[]).filter((code) => !EXCLUDED_APPROVAL_TRIGGERS.has(code));
const APPROVER_TYPES = Object.keys(APPROVER_TYPE_LABELS) as ApproverType[];
const fieldClass = "mt-1.5 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm font-normal text-ink-strong";

interface Lookups {
  departments: Department[];
  roles: InstitutionRole[];
  members: InstitutionMembership[];
}

function triggerLabel(workflow: ApprovalWorkflow) {
  return workflow.trigger ? APPROVAL_TRIGGER_LABELS[workflow.trigger] : workflow.entity_type || workflow.workflow_type || "Unassigned";
}

function amountBand(workflow: ApprovalWorkflow) {
  if (workflow.min_amount && workflow.max_amount) return `${workflow.min_amount} – ${workflow.max_amount}`;
  if (workflow.min_amount) return `${workflow.min_amount} and above`;
  if (workflow.max_amount) return `Up to ${workflow.max_amount}`;
  return null;
}

/** Settings › Approval workflows (Stitch S027), backed by the bounded approval engine. */
export default function ApprovalWorkflowSettingsPage() {
  const { user } = useAuth();
  const can = (code: string) => Boolean(user?.permissions.includes("*") || user?.permissions.includes(code));
  const canCreate = can("approval_workflow.create");
  const canEdit = can("approval_workflow.update");

  const load = useCallback(async () => {
    const [workflows, departments, roles, members] = await Promise.all([
      workflowsApi.listApprovalWorkflows(),
      organizationApi.listDepartments({ page_size: 200 }).catch(() => ({ results: [] as Department[] })),
      institutionsApi.listInstitutionRoles().catch(() => ({ results: [] as InstitutionRole[] })),
      institutionsApi.listInstitutionMemberships().catch(() => ({ results: [] as InstitutionMembership[] })),
    ]);
    return { workflows: workflows.results, lookups: { departments: departments.results, roles: roles.results.filter((role) => role.is_active && !role.is_read_only), members: members.results.filter((member) => member.status === "ACTIVE") } };
  }, []);
  const { data, loading, error, reload } = useApiResource(load);
  const [query, setQuery] = useState("");
  const [trigger, setTrigger] = useState<ApprovalTrigger | "">("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApprovalWorkflow | "new" | null>(null);

  const workflows = useMemo(() => data?.workflows ?? [], [data]);
  const filtered = workflows.filter((workflow) =>
    (!query || `${workflow.name} ${workflow.code}`.toLowerCase().includes(query.toLowerCase()))
    && (!trigger || workflow.trigger === trigger)
    && (!status || (status === "active") === workflow.is_active),
  );
  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? filtered[0] ?? null;

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "You may not have permission to view approval workflows."} onRetry={reload} />;
  const lookups = data.lookups;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval workflows"
        description="Who approves each kind of request, in what order, and who hears about overdue steps."
        icon={GitPullRequest}
        accent="settings"
        actions={canCreate ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>Create workflow</Button> : undefined}
      />
      <p className="rounded-xl border border-line bg-surface-muted/50 p-4 text-support text-ink-muted">
        Today the <span className="font-semibold text-ink-strong">leave request</span> trigger is connected: their approvals follow these definitions. Other triggers can be prepared now; until their module is connected it keeps its own approval rules. In every workflow the requester is never their own approver, view-only roles never approve, and a step with nobody eligible stops the submission.
      </p>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-elevation-1" aria-label="Workflow definitions">
          <div className="flex flex-wrap gap-2 border-b border-line-soft p-4">
            <label className="relative min-w-48 flex-1"><span className="sr-only">Search workflows</span><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows…" className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" /></label>
            <select aria-label="Trigger" value={trigger} onChange={(event) => setTrigger(event.target.value as ApprovalTrigger | "")} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm"><option value="">All triggers</option>{TRIGGERS.map((code) => <option key={code} value={code}>{APPROVAL_TRIGGER_LABELS[code]}</option>)}</select>
            <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value as "" | "active" | "inactive")} className="h-9 rounded-lg border border-line-strong bg-surface px-2 text-sm"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
          </div>
          {filtered.length === 0 ? (
            <div className="p-6"><EmptyState icon={GitPullRequest} title={workflows.length ? "No workflows match" : "No approval workflows yet"} description={workflows.length ? "Change the search or filters." : "Without a workflow, leave requests go to the requester's department head or manager, then HR."} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="bg-surface-muted/60 text-caption uppercase tracking-[0.06em] text-ink-muted"><tr><th className="px-4 py-2.5 font-semibold">Workflow</th><th className="px-4 py-2.5 font-semibold">Trigger</th><th className="px-4 py-2.5 font-semibold">Applies to</th><th className="px-4 py-2.5 text-right font-semibold">Stages</th><th className="px-4 py-2.5 font-semibold">Status</th></tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {filtered.map((workflow) => {
                    const department = lookups.departments.find((item) => item.id === workflow.department);
                    const band = amountBand(workflow);
                    return (
                      <tr key={workflow.id} className={cx("cursor-pointer hover:bg-surface-hover", selected?.id === workflow.id && "bg-primary-soft/40")} onClick={() => setSelectedId(workflow.id)}>
                        <td className="px-4 py-3"><button type="button" className="text-left font-semibold text-ink-strong hover:text-primary" onClick={() => setSelectedId(workflow.id)}>{workflow.name}</button><span className="block text-caption text-ink-muted">{workflow.code}</span></td>
                        <td className="px-4 py-3">{triggerLabel(workflow)}{workflow.trigger && !CONNECTED_TRIGGERS.has(workflow.trigger) && <Badge size="sm" tone="neutral" className="ml-2">Not connected yet</Badge>}</td>
                        <td className="px-4 py-3 text-ink-muted">{[department?.name ?? (workflow.department ? "A department" : "Whole institution"), band].filter(Boolean).join(" · ")}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{workflow.steps.length}</td>
                        <td className="px-4 py-3"><Badge size="sm" dot tone={workflow.is_active ? "success" : "neutral"}>{workflow.is_active ? "Active" : "Inactive"}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line-soft px-4 py-2.5 text-caption text-ink-muted">Showing {filtered.length} of {workflows.length} workflows</p>
        </section>

        {selected && <WorkflowDetail key={selected.id} workflow={selected} lookups={lookups} canEdit={canEdit} onEdit={() => setEditing(selected)} onChanged={reload} />}
      </div>

      {editing && <WorkflowDialog workflow={editing === "new" ? null : editing} lookups={lookups} onClose={() => setEditing(null)} onSaved={(saved) => { setEditing(null); setSelectedId(saved.id); void reload(); }} />}
    </div>
  );
}

function approverDescription(step: ApprovalWorkflowStep, lookups: Lookups) {
  if (step.approver_type === "ROLE") return `Any ${lookups.roles.find((role) => role.id === step.approver_role)?.name ?? "role holder"}`;
  if (step.approver_type === "USER") {
    const member = lookups.members.find((item) => item.user?.id === step.approver_user);
    return member?.user ? `${member.user.first_name} ${member.user.last_name}`.trim() || member.user.email : "A named person";
  }
  return APPROVER_TYPE_LABELS[step.approver_type];
}

function WorkflowDetail({ workflow, lookups, canEdit, onEdit, onChanged }: { workflow: ApprovalWorkflow; lookups: Lookups; canEdit: boolean; onEdit: () => void; onChanged: () => void }) {
  const [addingStep, setAddingStep] = useState(false);
  const [removing, setRemoving] = useState<ApprovalWorkflowStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const escalation = lookups.roles.find((role) => role.id === workflow.escalation_role);
  const dueSteps = workflow.steps.filter((step) => step.due_after_hours);

  const remove = async () => {
    if (!removing) return;
    setBusy(true); setError(null);
    try { await workflowsApi.deleteApprovalWorkflowStep(removing.id); setRemoving(null); onChanged(); }
    catch (caught) { setError(getApiErrorMessage(caught)); setRemoving(null); }
    finally { setBusy(false); }
  };

  return (
    <aside className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-elevation-1" aria-label={`${workflow.name} detail`}>
      <div className="flex items-center justify-between gap-2">
        <Badge dot tone={workflow.is_active ? "success" : "neutral"}>{workflow.is_active ? "Active" : "Inactive"}</Badge>
        {canEdit && <Button size="sm" variant="secondary" leadingIcon={<Pencil className="h-4 w-4" />} onClick={onEdit}>Edit workflow</Button>}
      </div>
      <div>
        <h2 className="text-section-title font-semibold text-ink-strong">{workflow.name}</h2>
        <p className="mt-1 flex items-center gap-2 text-support text-ink-muted"><Zap className="h-4 w-4 text-primary" aria-hidden="true" />Trigger: {triggerLabel(workflow)}</p>
        {workflow.trigger && !CONNECTED_TRIGGERS.has(workflow.trigger) && <p className="mt-2 rounded-lg bg-warning-soft p-2.5 text-caption text-warning-ink">This module does not use workflow definitions yet. The definition is kept and takes effect when the module is connected.</p>}
      </div>

      <div>
        <h3 className="flex items-center justify-between text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Approval stages <span className="normal-case tracking-normal text-primary">{workflow.steps.length} configured</span></h3>
        {workflow.steps.length === 0 ? <p className="mt-2 text-support text-ink-muted">No stages yet. A workflow without stages is ignored.</p> : (
          <ol className="mt-3 space-y-3">
            {[...workflow.steps].sort((a, b) => a.order - b.order).map((step) => (
              <li key={step.id} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-strong text-caption font-bold text-surface">{step.order}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-strong">{step.name}</p>
                  <p className="text-support text-ink-muted">{approverDescription(step, lookups)}{step.due_after_hours ? ` · due in ${step.due_after_hours} h` : ""}</p>
                </div>
                {canEdit && <button type="button" onClick={() => setRemoving(step)} className="rounded-lg p-1.5 text-ink-muted hover:bg-danger-soft hover:text-danger" aria-label={`Remove stage ${step.order}`}><Trash2 className="h-4 w-4" /></button>}
              </li>
            ))}
          </ol>
        )}
        {canEdit && <Button className="mt-3" size="sm" variant="ghost" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setAddingStep(true)}>Add stage</Button>}
      </div>

      <div>
        <h3 className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Escalation rule</h3>
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-surface-muted/60 p-3 text-support text-ink">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {dueSteps.length ? `When a stage passes its due time, its approvers${escalation ? ` and every ${escalation.name}` : ""} are reminded. Escalation only notifies; it never approves or reassigns.` : "No stage has a due time, so nothing is escalated."}
        </p>
      </div>
      <p className="flex items-center gap-2 text-caption text-ink-muted"><ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />Every change to this workflow is recorded in the audit trail.</p>
      {error && <ErrorState variant="inline" title="Stage could not be removed" message={error} />}

      {addingStep && <StepDialog workflow={workflow} lookups={lookups} onClose={() => setAddingStep(false)} onSaved={() => { setAddingStep(false); onChanged(); }} />}
      <ConfirmDialog open={removing !== null} title={`Remove stage ${removing?.order ?? ""}?`} description="Requests already in progress keep the approvers they were given. New requests skip this stage." confirmLabel="Remove stage" tone="destructive" loading={busy} onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </aside>
  );
}

function WorkflowDialog({ workflow, lookups, onClose, onSaved }: { workflow: ApprovalWorkflow | null; lookups: Lookups; onClose: () => void; onSaved: (saved: ApprovalWorkflow) => void }) {
  const [name, setName] = useState(workflow?.name ?? "");
  const [code, setCode] = useState(workflow?.code ?? "");
  const [trigger, setTrigger] = useState<ApprovalTrigger>(workflow?.trigger ?? "LEAVE_REQUEST");
  const [department, setDepartment] = useState(workflow?.department ?? "");
  const [minAmount, setMinAmount] = useState(workflow?.min_amount ?? "");
  const [maxAmount, setMaxAmount] = useState(workflow?.max_amount ?? "");
  const [escalationRole, setEscalationRole] = useState(workflow?.escalation_role ?? "");
  const [active, setActive] = useState(workflow?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountTriggers: ApprovalTrigger[] = ["EXPENSE_CLAIM", "BUDGET", "VENDOR_BILL", "OFFER", "JOB_REQUISITION"];
  const usesAmount = amountTriggers.includes(trigger);

  const save = async () => {
    setSaving(true); setError(null);
    const payload = {
      code: code.trim().toUpperCase(), name: name.trim(), trigger,
      department: department || null,
      min_amount: usesAmount && minAmount ? minAmount : null,
      max_amount: usesAmount && maxAmount ? maxAmount : null,
      escalation_role: escalationRole || null, is_active: active,
    };
    try { onSaved(workflow ? await workflowsApi.updateApprovalWorkflow(workflow.id, payload) : await workflowsApi.createApprovalWorkflow(payload)); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onClose={onClose} size="lg" title={workflow ? "Edit workflow" : "Create workflow"} description="A workflow applies to one trigger. A department-specific workflow wins over a general one; an amount band narrows it further."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} loadingLabel="Saving…" disabled={!name.trim() || !code.trim()} onClick={() => void save()}>{workflow ? "Save changes" : "Create workflow"}</Button></div>}>
      {error && <ErrorState variant="inline" title="Workflow could not be saved" message={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-ink-strong">Name<input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} /></label>
        <label className="text-sm font-semibold text-ink-strong">Code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} disabled={Boolean(workflow)} placeholder="LEAVE_FIELD" className={cx(fieldClass, "disabled:bg-surface-muted")} /></label>
        <label className="text-sm font-semibold text-ink-strong">Trigger<select value={trigger} onChange={(event) => setTrigger(event.target.value as ApprovalTrigger)} className={fieldClass}>{TRIGGERS.map((item) => <option key={item} value={item}>{APPROVAL_TRIGGER_LABELS[item]}{CONNECTED_TRIGGERS.has(item) ? "" : " (not connected yet)"}</option>)}</select></label>
        <label className="text-sm font-semibold text-ink-strong">Requester&apos;s department<select value={department} onChange={(event) => setDepartment(event.target.value)} className={fieldClass}><option value="">Whole institution</option>{lookups.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {usesAmount && <>
          <label className="text-sm font-semibold text-ink-strong">Minimum amount<input inputMode="decimal" value={minAmount} onChange={(event) => setMinAmount(event.target.value)} placeholder="No minimum" className={fieldClass} /></label>
          <label className="text-sm font-semibold text-ink-strong">Maximum amount<input inputMode="decimal" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} placeholder="No maximum" className={fieldClass} /></label>
        </>}
        <label className="text-sm font-semibold text-ink-strong">Escalation role<select value={escalationRole} onChange={(event) => setEscalationRole(event.target.value)} className={fieldClass}><option value="">Approvers only</option>{lookups.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><span className="mt-1 block text-caption font-normal text-ink-muted">Also reminded when a stage is overdue.</span></label>
        <label className="flex items-center gap-2 self-center text-sm text-ink"><input type="checkbox" className="h-4 w-4" checked={active} onChange={(event) => setActive(event.target.checked)} />Active</label>
      </div>
    </Dialog>
  );
}

function StepDialog({ workflow, lookups, onClose, onSaved }: { workflow: ApprovalWorkflow; lookups: Lookups; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [approverType, setApproverType] = useState<ApproverType>("REQUESTER_DEPARTMENT_HEAD");
  const [role, setRole] = useState("");
  const [person, setPerson] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextOrder = workflow.steps.reduce((max, step) => Math.max(max, step.order), 0) + 1;
  const ready = name.trim() && (approverType !== "ROLE" || role) && (approverType !== "USER" || person);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await workflowsApi.createApprovalWorkflowStep({
        workflow: workflow.id, order: nextOrder, name: name.trim(), approver_type: approverType,
        approver_role: approverType === "ROLE" ? role : null,
        approver_user: approverType === "USER" ? person : null,
        due_after_hours: due ? Number(due) : null,
      });
      onSaved();
    } catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onClose={onClose} title={`Add stage ${nextOrder}`} description="Stages run in order. Each resolves to one approver when the request is submitted."
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} loadingLabel="Saving…" disabled={!ready} onClick={() => void save()}>Add stage</Button></div>}>
      {error && <ErrorState variant="inline" title="Stage could not be added" message={error} />}
      <div className="grid gap-4">
        <label className="text-sm font-semibold text-ink-strong">Stage name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Department head review" className={fieldClass} /></label>
        <label className="text-sm font-semibold text-ink-strong">Who approves<select value={approverType} onChange={(event) => setApproverType(event.target.value as ApproverType)} className={fieldClass}>{APPROVER_TYPES.map((item) => <option key={item} value={item}>{APPROVER_TYPE_LABELS[item]}</option>)}</select></label>
        {approverType === "ROLE" && <label className="text-sm font-semibold text-ink-strong">Role<select value={role} onChange={(event) => setRole(event.target.value)} className={fieldClass}><option value="">Choose a role</option>{lookups.roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {approverType === "USER" && <label className="text-sm font-semibold text-ink-strong">Person<select value={person} onChange={(event) => setPerson(event.target.value)} className={fieldClass}><option value="">Choose a member</option>{lookups.members.filter((member) => member.user).map((member) => <option key={member.id} value={member.user!.id}>{`${member.user!.first_name} ${member.user!.last_name}`.trim() || member.user!.email}</option>)}</select></label>}
        <label className="text-sm font-semibold text-ink-strong">Due after (hours)<input inputMode="numeric" value={due} onChange={(event) => setDue(event.target.value.replace(/\D/g, ""))} placeholder="No due time" className={fieldClass} /></label>
      </div>
    </Dialog>
  );
}
