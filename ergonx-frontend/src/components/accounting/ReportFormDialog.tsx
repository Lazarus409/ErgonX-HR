"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import { Dialog } from "@/components/ui/Overlay";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { humanizeEnum } from "@/lib/format";
import { REPORT_CATEGORIES, REPORT_FREQUENCIES, REPORT_TYPES, type SavedReport } from "@/types/accounting";

const ROLES = ["FINANCE_MANAGER", "ACCOUNTANT", "AUDITOR", "DIRECTOR", "INSTITUTION_ADMIN"];
const inputClass = "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm";

export type ReportDialogMode = "create" | "edit" | "schedule" | "access";

/** Create a report or edit its parameters, schedule or access. */
export default function ReportFormDialog({ mode, report, onClose, onSaved }: { mode: ReportDialogMode; report?: SavedReport | null; onClose: () => void; onSaved: (report: SavedReport) => void }) {
  const [form, setForm] = useState({
    name: report?.name ?? "", report_type: report?.report_type ?? "INCOME_STATEMENT", category: report?.category ?? "CUSTOM", description: report?.description ?? "",
    as_of: String(report?.parameters.as_of ?? ""), date_from: String(report?.parameters.date_from ?? ""), date_to: String(report?.parameters.date_to ?? ""),
    comparative: report?.parameters.comparative !== false, schedule_frequency: report?.schedule_frequency ?? "NONE", allowed_roles: report?.allowed_roles ?? [],
  });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pointInTime = ["BALANCE_SHEET", "AR_AGING", "AP_AGING"].includes(form.report_type);
  const ranged = ["INCOME_STATEMENT", "TRIAL_BALANCE"].includes(form.report_type);
  const lockedIdentity = Boolean(report?.is_standard);

  const save = async () => {
    if (mode === "create" && !form.name.trim()) { setProblem("Give the report a name."); return; }
    setSaving(true);
    setProblem(null);
    const parameters: Record<string, string | boolean> = {};
    if (pointInTime && form.as_of) parameters.as_of = form.as_of;
    if (ranged && form.date_from) parameters.date_from = form.date_from;
    if (ranged && form.date_to) parameters.date_to = form.date_to;
    if (form.report_type === "BALANCE_SHEET" || form.report_type === "INCOME_STATEMENT") parameters.comparative = form.comparative;
    const payload = mode === "schedule" ? { schedule_frequency: form.schedule_frequency }
      : mode === "access" ? { allowed_roles: form.allowed_roles }
      : { ...(lockedIdentity ? {} : { name: form.name.trim(), report_type: form.report_type, category: form.category, description: form.description.trim() }), parameters, ...(mode === "create" ? { schedule_frequency: form.schedule_frequency, allowed_roles: form.allowed_roles } : {}) };
    try {
      const saved = mode === "create" ? await accountingApi.createSavedReport(payload) : await accountingApi.updateSavedReport(report!.id, payload);
      onSaved(saved);
    } catch (caught) {
      setProblem(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  const title = mode === "create" ? "Create report" : mode === "schedule" ? "Schedule report" : mode === "access" ? "Access controls" : "Report parameters";

  return (
    <Dialog open onClose={onClose} title={title} description={mode === "schedule" ? "Scheduled reports run automatically on the first day of each period and keep every version." : mode === "access" ? "Leave all roles unticked to share with everyone who can view financial reports." : lockedIdentity ? "Standard reports keep their name and type; adjust the parameters." : "Define what the report shows."}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={() => void save()}>{mode === "create" ? "Create report" : "Save"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {problem && <div className="sm:col-span-2"><ErrorState variant="inline" title="Not saved" message={problem} /></div>}
        {(mode === "create" || mode === "edit") && (
          <>
            {!lockedIdentity && <>
              <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Report name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} /></label>
              <label><span className="mb-1.5 block text-sm font-semibold">Report type</span><select value={form.report_type} onChange={(event) => setForm({ ...form, report_type: event.target.value })} className={inputClass}>{REPORT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span className="mb-1.5 block text-sm font-semibold">Folder</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={inputClass}>{REPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Description</span><input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} /></label>
            </>}
            {pointInTime && <label><span className="mb-1.5 block text-sm font-semibold">As at date</span><input type="date" value={form.as_of} onChange={(event) => setForm({ ...form, as_of: event.target.value })} className={inputClass} /><span className="text-caption text-ink-muted">Blank means the run date.</span></label>}
            {ranged && <>
              <label><span className="mb-1.5 block text-sm font-semibold">From</span><input type="date" value={form.date_from} onChange={(event) => setForm({ ...form, date_from: event.target.value })} className={inputClass} /><span className="text-caption text-ink-muted">Blank means 1 January of the run year.</span></label>
              <label><span className="mb-1.5 block text-sm font-semibold">To</span><input type="date" value={form.date_to} onChange={(event) => setForm({ ...form, date_to: event.target.value })} className={inputClass} /><span className="text-caption text-ink-muted">Blank means the run date.</span></label>
            </>}
            {(form.report_type === "BALANCE_SHEET" || form.report_type === "INCOME_STATEMENT") && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.comparative} onChange={(event) => setForm({ ...form, comparative: event.target.checked })} className="h-4 w-4" />Include the comparative period</label>}
          </>
        )}
        {(mode === "schedule" || mode === "create") && <label><span className="mb-1.5 block text-sm font-semibold">Schedule</span><select value={form.schedule_frequency} onChange={(event) => setForm({ ...form, schedule_frequency: event.target.value })} className={inputClass}>{REPORT_FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        {(mode === "access" || mode === "create") && (
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-semibold">Restrict to roles</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">{ROLES.map((role) => <label key={role} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowed_roles.includes(role)} onChange={(event) => setForm({ ...form, allowed_roles: event.target.checked ? [...form.allowed_roles, role] : form.allowed_roles.filter((value) => value !== role) })} className="h-4 w-4" />{humanizeEnum(role)}</label>)}</div>
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
