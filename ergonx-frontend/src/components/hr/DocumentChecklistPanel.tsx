"use client";

import { useCallback, useRef, useState } from "react";
import { BadgeCheck, FileCheck2, Upload } from "lucide-react";

import Alert from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { documentChecklistApi, employeesApi, getApiErrorMessage, operationsApi } from "@/lib/api";
import { useAccess } from "@/lib/access";
import { CHECKLIST_STATUS_LABELS, CHECKLIST_STATUS_TONES, type ChecklistItem } from "@/lib/api/documentChecklist";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

/**
 * Required documents for one employee (ErgonX HR document checklist).
 *
 * ``mode="hr"`` is the employee record: HR uploads against a requirement and
 * may waive it. ``mode="self"`` is the employee's own Documents page.
 */
export default function DocumentChecklistPanel({ mode, employeeId, onChanged }: { mode: "hr" | "self"; employeeId?: string; onChanged?: () => void }) {
  const canManage = useAccess().can("document_requirement.manage");
  const load = useCallback(() => (mode === "self" ? documentChecklistApi.getMyChecklist() : documentChecklistApi.getEmployeeChecklist(employeeId ?? "")), [mode, employeeId]);
  const { data, loading, error, reload } = useApiResource(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [waiving, setWaiving] = useState<ChecklistItem | null>(null);
  const [reason, setReason] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const changed = () => { reload(); onChanged?.(); };

  const upload = async (item: ChecklistItem, file: File | undefined) => {
    if (!file) return;
    if (file.size > operationsApi.MAX_DOCUMENT_BYTES) { setActionError("Documents must be 25 MB or smaller."); return; }
    setBusy(item.requirement_id);
    setActionError("");
    try {
      if (mode === "self") await employeesApi.uploadMyDocument(file, item.document_category);
      else await operationsApi.uploadDocument(file, { category: item.document_category, classification: "CONFIDENTIAL", entity_type: "EMPLOYEE", entity_id: employeeId });
      changed();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const waive = async () => {
    if (!waiving || !employeeId) return;
    if (!reason.trim()) { setActionError("Give a reason for the waiver."); return; }
    setBusy(waiving.requirement_id);
    setActionError("");
    try {
      await documentChecklistApi.waiveRequirement({ requirement: waiving.requirement_id, employee: employeeId, reason: reason.trim() });
      setWaiving(null);
      setReason("");
      changed();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const unwaive = async (item: ChecklistItem) => {
    if (!item.waiver) return;
    setBusy(item.requirement_id);
    setActionError("");
    try { await documentChecklistApi.removeWaiver(item.waiver.id); changed(); }
    catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setBusy(null); }
  };

  const items = data?.items ?? [];
  if (!loading && !error && items.length === 0) return null; // No requirements apply: nothing to show.
  const summary = data?.summary;
  const canUpload = mode === "self" || canManage;

  return (
    <Card
      title="Required documents"
      description={mode === "self" ? "Documents HR needs from you. Upload any that are missing or expired." : "Documents HR requires for this employee."}
      icon={FileCheck2}
      accent="hr"
      actions={summary ? <Badge tone={summary.complete ? "success" : "warning"} icon={summary.complete ? BadgeCheck : undefined}>{summary.complete ? "Complete" : `${summary.satisfied} of ${summary.required} on file`}</Badge> : null}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {actionError && <Alert tone="danger" onDismiss={() => setActionError("")}>{actionError}</Alert>}
      {loading && !data ? <p className="text-support text-ink-muted">Loading checklist…</p> : (
        <ul className="divide-y divide-line-soft">
          {items.map((item) => {
            const needsUpload = item.status === "MISSING" || item.status === "EXPIRED" || item.status === "EXPIRING";
            return (
              <li key={item.requirement_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-strong">
                    {item.requirement}
                    <Badge size="sm" tone={CHECKLIST_STATUS_TONES[item.status]}>{CHECKLIST_STATUS_LABELS[item.status]}</Badge>
                    {!item.is_mandatory && <Badge size="sm">Optional</Badge>}
                  </p>
                  <p className="mt-0.5 text-caption text-ink-muted">
                    {item.waiver
                      ? `Waived by ${item.waiver.waived_by || "HR"}: ${item.waiver.reason}`
                      : item.document
                        ? `${item.document.original_filename} · uploaded ${formatDate(item.document.uploaded_at)}${item.expires_on ? ` · ${item.status === "EXPIRED" ? "expired" : "expires"} ${formatDate(item.expires_on)}` : ""}`
                        : `File under "${item.document_category}"${item.validity_months ? ` · renew every ${item.validity_months} months` : ""}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {canUpload && needsUpload && (
                    <>
                      <input ref={(node) => { fileInputs.current[item.requirement_id] = node; }} type="file" className="sr-only" onChange={(event) => { void upload(item, event.target.files?.[0]); event.currentTarget.value = ""; }} />
                      <Button size="sm" variant={item.status === "EXPIRING" ? "secondary" : "primary"} leadingIcon={<Upload className="h-4 w-4" />} loading={busy === item.requirement_id} onClick={() => fileInputs.current[item.requirement_id]?.click()}>{item.status === "MISSING" ? "Upload" : "Upload renewal"}</Button>
                    </>
                  )}
                  {mode === "hr" && canManage && item.status !== "WAIVED" && item.status !== "ON_FILE" && <Button size="sm" variant="ghost" onClick={() => { setWaiving(item); setReason(""); }}>Waive</Button>}
                  {mode === "hr" && canManage && item.waiver && <Button size="sm" variant="ghost" loading={busy === item.requirement_id} onClick={() => void unwaive(item)}>Remove waiver</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={waiving !== null}
        onClose={() => setWaiving(null)}
        title={waiving ? `Waive ${waiving.requirement}` : "Waive requirement"}
        description="The employee will count as compliant for this document. The reason is kept in the audit trail."
        footer={<><Button variant="secondary" onClick={() => setWaiving(null)}>Cancel</Button><Button onClick={() => void waive()} loading={busy !== null}>Waive requirement</Button></>}
      >
        <Field label="Reason" required><Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="e.g. Foreign national: passport on file instead of a Ghana Card." data-autofocus /></Field>
      </Dialog>
    </Card>
  );
}
