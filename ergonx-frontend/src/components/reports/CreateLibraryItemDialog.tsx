"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Overlay";
import { getApiErrorMessage, reportLibraryApi } from "@/lib/api";
import type { LibraryEntry, LibraryItemInput, LibraryKind, LibraryOptions } from "@/types/reportLibrary";

const STATUS_FILTER_REPORTS = new Set(["workforce-cost", "recruitment", "leave", "attendance", "payroll", "accounting", "expenses"]);

/** "Create report": save a dashboard or report with a name, filters, schedule and audience. Mount it fresh for each use. */
export default function CreateLibraryItemDialog({ open, onClose, options, onCreated, initialKind = "REPORT" }: { open: boolean; onClose: () => void; options: LibraryOptions | null; onCreated: (entry: LibraryEntry) => void; initialKind?: LibraryKind }) {
  const [kind, setKind] = useState<LibraryKind>(initialKind);
  const [form, setForm] = useState<LibraryItemInput & { status_filter?: string; date_from?: string; date_to?: string }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sources = useMemo(() => (options?.sources ?? []).filter((source) => source.kind === kind), [options, kind]);
  const source = sources.find((item) => item.source === form.source) ?? sources[0];

  const save = async () => {
    if (!source) return;
    setSaving(true); setError(null);
    try {
      const filters = kind === "REPORT" ? Object.fromEntries(Object.entries({ status: form.status_filter, date_from: form.date_from, date_to: form.date_to }).filter(([, value]) => value)) as Record<string, string> : {};
      const created = await reportLibraryApi.createLibraryItem({
        name: form.name?.trim() || source.label, description: form.description ?? "", kind, source: source.source, category: form.category ?? source.category,
        filters, schedule: kind === "REPORT" ? form.schedule ?? "NONE" : "NONE", status: form.status ?? "DRAFT",
        visibility: form.status === "PUBLISHED" ? form.visibility ?? "PRIVATE" : "PRIVATE",
      });
      onCreated(created);
      onClose();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      icon={<Plus className="h-5 w-5" />}
      title="Create report"
      description="Save a dashboard or report with your own name, filters and schedule. Only data your role can open is available."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} loading={saving} disabled={!source}>Save {kind === "DASHBOARD" ? "dashboard" : "report"}</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select value={kind} onChange={(event) => { setKind(event.target.value as LibraryKind); set({ source: undefined }); }}>
            <option value="REPORT">Report</option>
            <option value="DASHBOARD">Dashboard</option>
          </Select>
        </Field>
        <Field label={kind === "DASHBOARD" ? "Dashboard" : "Report data"} helper={source?.description}>
          <Select value={source?.source ?? ""} onChange={(event) => set({ source: event.target.value })} disabled={!sources.length}>
            {sources.length ? sources.map((item) => <option key={item.source} value={item.source}>{item.label} · {item.module_label}</option>) : <option value="">Nothing available for your role</option>}
          </Select>
        </Field>
        <Field label="Name" className="sm:col-span-2">
          <Input value={form.name ?? ""} placeholder={source?.label ?? "Report name"} onChange={(event) => set({ name: event.target.value })} maxLength={150} />
        </Field>
        <Field label="Description" optional className="sm:col-span-2">
          <Textarea rows={2} value={form.description ?? ""} onChange={(event) => set({ description: event.target.value })} maxLength={2000} />
        </Field>
        {kind === "REPORT" && (
          <>
            {source && STATUS_FILTER_REPORTS.has(source.source) && (
              <Field label="Status filter" optional helper="A record status such as APPROVED or ACTIVE.">
                <Input value={form.status_filter ?? ""} onChange={(event) => set({ status_filter: event.target.value.toUpperCase() })} />
              </Field>
            )}
            <Field label="Schedule" helper="Scheduled reports refresh automatically and notify you and the people you share with.">
              <Select value={form.schedule ?? "NONE"} onChange={(event) => set({ schedule: event.target.value as LibraryItemInput["schedule"] })}>
                <option value="NONE">Not scheduled</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
              </Select>
            </Field>
            <Field label="From" optional><Input type="date" value={form.date_from ?? ""} onChange={(event) => set({ date_from: event.target.value })} /></Field>
            <Field label="To" optional><Input type="date" value={form.date_to ?? ""} onChange={(event) => set({ date_to: event.target.value })} /></Field>
          </>
        )}
        <Field label="Category">
          <Select value={form.category ?? source?.category ?? "CUSTOM"} onChange={(event) => set({ category: event.target.value as LibraryItemInput["category"] })}>
            <option value="FINANCE">Finance</option><option value="HR">HR</option><option value="RECRUITMENT">Recruitment</option><option value="OPERATIONS">Operations</option><option value="CUSTOM">Custom</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={form.status ?? "DRAFT"} onChange={(event) => set({ status: event.target.value as LibraryItemInput["status"] })}>
            <option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option>
          </Select>
        </Field>
        {form.status === "PUBLISHED" && (
          <Field label="Who can see it" className="sm:col-span-2" helper={options?.can_publish ? undefined : "Publishing to everyone needs the report.publish permission; you can share with specific people after saving."}>
            <Select value={form.visibility ?? "PRIVATE"} onChange={(event) => set({ visibility: event.target.value as LibraryItemInput["visibility"] })}>
              <option value="PRIVATE">Only me (share with people later)</option>
              {options?.can_publish && <option value="INSTITUTION">Everyone with access to this data</option>}
            </Select>
          </Field>
        )}
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-danger-ink">{error}</p>}
    </Dialog>
  );
}
