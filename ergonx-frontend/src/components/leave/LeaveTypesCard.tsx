"use client";

import { useState } from "react";
import { CalendarRange, Pencil, Plus } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { getApiErrorMessage, leaveApi } from "@/lib/api";
import type { LeaveType } from "@/types/leave";

interface Form { name: string; code: string; description: string; is_paid: boolean; requires_attachment: boolean; is_active: boolean }

const emptyForm: Form = { name: "", code: "", description: "", is_paid: true, requires_attachment: false, is_active: true };

/**
 * Every leave type employees can request. ErgonX starts each institution with
 * the standard set (annual, sick, maternity, paternity, compassionate, study,
 * casual, unpaid); HR can add its own. A type needs an active policy before it
 * can be requested, so types without one are flagged.
 */
export default function LeaveTypesCard({ types, policyTypeIds, canConfigure, onChanged, onAddPolicy }: { types: LeaveType[]; policyTypeIds: Set<string>; canConfigure: boolean; onChanged: () => void; onAddPolicy: (leaveTypeId: string) => void }) {
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openForm = (type: LeaveType | null) => {
    setEditing(type);
    setForm(type ? { name: type.name, code: type.code, description: type.description, is_paid: type.is_paid, requires_attachment: type.requires_attachment, is_active: type.is_active } : emptyForm);
    setError("");
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setError("Give the leave type a name."); return; }
    setSaving(true); setError("");
    try {
      const payload = { ...form, name: form.name.trim(), code: form.code.trim().toUpperCase(), description: form.description.trim() };
      if (editing) await leaveApi.updateLeaveType(editing.id, payload);
      else await leaveApi.createLeaveType(payload);
      setOpen(false);
      onChanged();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Leave types"
      description="The kinds of leave employees can request. Each needs an active policy to be requestable."
      icon={CalendarRange}
      accent="leave"
      actions={canConfigure ? <Button size="sm" variant="secondary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => openForm(null)}>Add leave type</Button> : undefined}
    >
      {types.length === 0 ? (
        <p className="text-support text-ink-muted">No leave types yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {types.map((type) => {
            const hasPolicy = policyTypeIds.has(type.id);
            return (
              <li key={type.id} className="flex items-start justify-between gap-3 rounded-2xl border border-line p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-strong">{type.name}</p>
                  <p className="font-mono text-caption text-ink-muted">{type.code}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge size="sm" tone={type.is_paid ? "success" : "neutral"}>{type.is_paid ? "Paid" : "Unpaid"}</Badge>
                    {type.requires_attachment && <Badge size="sm" tone="info">Document required</Badge>}
                    {!type.is_active && <Badge size="sm" tone="neutral">Inactive</Badge>}
                    {type.is_active && !hasPolicy && <Badge size="sm" tone="warning">No policy</Badge>}
                  </div>
                  {type.is_active && !hasPolicy && canConfigure && (
                    <button type="button" onClick={() => onAddPolicy(type.id)} className="mt-2 text-caption font-semibold text-primary-ink hover:underline">Add a policy</button>
                  )}
                </div>
                {canConfigure && <Button variant="ghost" size="sm" aria-label={`Edit ${type.name}`} onClick={() => openForm(type)} leadingIcon={<Pencil className="h-4 w-4" />} />}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!saving}
        title={editing ? `Edit ${editing.name}` : "New leave type"}
        description={editing ? undefined : "After saving, add a policy to set the entitlement and who is eligible."}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} loading={saving} loadingLabel="Saving…">{editing ? "Save changes" : "Add leave type"}</Button></>}
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Name" required><Input value={form.name} maxLength={150} placeholder="e.g. Marriage Leave" onChange={(event) => setForm({ ...form, name: event.target.value })} data-autofocus /></Field>
          <Field label="Code" optional helper={editing ? undefined : "Generated automatically when left blank."}><Input value={form.code} maxLength={50} className="font-mono" onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} /></Field>
          <Field label="Description" optional><Textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
          <Checkbox checked={form.is_paid} onChange={(event) => setForm({ ...form, is_paid: event.target.checked })} label="Paid leave" description="Days taken are recorded as unpaid leave." />
          <Checkbox checked={form.requires_attachment} onChange={(event) => setForm({ ...form, requires_attachment: event.target.checked })} label="Supporting document required" description="For example a medical certificate." />
          {editing && <Checkbox checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} label="Active" description="Inactive types can no longer be requested." />}
        </div>
      </Dialog>
    </Card>
  );
}
