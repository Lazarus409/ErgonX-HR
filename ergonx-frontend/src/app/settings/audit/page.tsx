"use client";

import { CheckCircle2, Download, FileText, Lock, Search, ShieldAlert, ShieldCheck, X, XCircle } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar, MetricCard } from "@/components/ui/Card";
import { DataTable, Pagination } from "@/components/ui/DataTable";
import ErrorState from "@/components/ui/ErrorState";
import { Field, Input } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
import { auditApi, getApiErrorMessage } from "@/lib/api";
import { isFailedAuditAction, type AuditLogEntry, type AuditLogFilters } from "@/lib/api/audit";
import { cx } from "@/lib/cx";
import { formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

const PAGE_SIZE = 25;
const pretty = (value: string) => value.replaceAll(".", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const dateTime = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
const startOfDay = (value: string) => value ? `${value}T00:00:00Z` : undefined;
const endOfDay = (value: string) => value ? `${value}T23:59:59Z` : undefined;

/** Areas an event's record type belongs to; filtering matches the record type. */
const MODULES: Array<{ value: string; label: string }> = [
  { value: "employees", label: "Employees" },
  { value: "leave", label: "Leave" },
  { value: "attendance", label: "Attendance" },
  { value: "payroll", label: "Payroll" },
  { value: "recruitment", label: "Recruitment" },
  { value: "accounting", label: "Accounting" },
  { value: "workflows", label: "Approvals" },
  { value: "institutions", label: "Users & access" },
  { value: "accounts", label: "Accounts & security" },
];

function moduleOf(entry: AuditLogEntry): string {
  const app = entry.entity_type.split(".")[0];
  return MODULES.find((item) => item.value === app)?.label ?? (app ? pretty(app) : "System");
}

function fieldChanges(entry: AuditLogEntry): Array<[string, unknown, unknown]> {
  const changes = entry.metadata.changes;
  if (!changes || typeof changes !== "object") return [];
  return Object.entries(changes as Record<string, unknown>)
    .filter(([, pair]) => Array.isArray(pair) && pair.length === 2)
    .map(([field, pair]) => [field, (pair as unknown[])[0], (pair as unknown[])[1]]);
}

const display = (value: unknown) => value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Audit trail (Stitch S011; S007 merged): read-only, tenant-scoped, sensitive values redacted by the API. */
export default function AuditSettingsPage() {
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [module, setModule] = useState("");
  const [result, setResult] = useState<"" | "success" | "failed">("");
  const [entityId, setEntityId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const criteria = useMemo<AuditLogFilters>(() => ({ q: query || undefined, actor: actor || undefined, action: action || undefined, entity_type: module || undefined, entity_id: entityId || undefined, result: result || undefined, from: startOfDay(from), to: endOfDay(to) }), [query, actor, action, module, entityId, result, from, to]);
  const load = useCallback(() => Promise.all([auditApi.listAuditLogs({ ...criteria, page, page_size: PAGE_SIZE }), auditApi.getAuditSummary(criteria).catch(() => null)]), [criteria, page]);
  const { data, loading, error, reload } = useApiResource(load);
  const [list, summary] = data ?? [null, null];
  const logs = list?.results ?? [];
  const selected = logs.find((entry) => entry.id === selectedId) ?? null;
  const pageCount = Math.max(1, Math.ceil((list?.count ?? 0) / PAGE_SIZE));
  const update = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setter(event.target.value); setPage(1); };

  const exportCsv = async () => {
    setExporting(true); setExportError(null);
    try {
      const rows: AuditLogEntry[] = [];
      for (let next = 1; next <= 20; next += 1) {
        const batch = await auditApi.listAuditLogs({ ...criteria, page: next, page_size: 100 });
        rows.push(...batch.results);
        if (rows.length >= batch.count || !batch.results.length) break;
      }
      const header = ["time", "actor", "action", "module", "record_type", "record_id", "result", "ip_address"];
      const lines = rows.map((entry) => [entry.created_at, entry.actor_email ?? "system", entry.action, moduleOf(entry), entry.entity_type, entry.entity_id ?? "", isFailedAuditAction(entry.action) ? "failed" : "success", entry.ip_address ?? ""].map(csvCell).join(","));
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (caught) { setExportError(getApiErrorMessage(caught)); }
    finally { setExporting(false); }
  };

  if (loading && !data) return <LoadingState variant="table" label="Loading audit history" />;
  if (error && !data) return <ErrorState title="Unable to load audit history" message={error} onRetry={reload} />;
  const hasFilters = Boolean(query || actor || action || module || entityId || result || from || to);
  const clearFilters = () => { setQuery(""); setActor(""); setAction(""); setModule(""); setEntityId(""); setResult(""); setFrom(""); setTo(""); setPage(1); };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Audit trail"
        description="Immutable record of sign-ins, access changes and record changes in this institution. Sensitive values are redacted."
        icon={ShieldCheck}
        accent="audit"
        meta={<Badge tone="neutral" icon={Lock}>Read-only</Badge>}
        actions={<Button variant="secondary" loading={exporting} loadingLabel="Exporting…" leadingIcon={<Download className="h-4 w-4" />} onClick={() => void exportCsv()}>Export CSV</Button>}
      />
      {exportError && <ErrorState variant="inline" title="Export failed" message={exportError} />}

      <section className="rounded-xl border border-line bg-surface p-4 shadow-elevation-1" aria-label="Filters">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Search" hideLabel><Input size="sm" value={query} onChange={update(setQuery)} placeholder="Search by actor, action or record" leadingIcon={<Search />} /></Field>
          <Field label="Actor email" hideLabel><Input size="sm" value={actor} onChange={update(setActor)} placeholder="Actor email" /></Field>
          <Field label="Module" hideLabel><select value={module} onChange={update(setModule)} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm"><option value="">All modules</option>{MODULES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
          <Field label="Result" hideLabel><select value={result} onChange={(event) => { setResult(event.target.value as "" | "success" | "failed"); setPage(1); }} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-2 text-sm"><option value="">Success and failed</option><option value="success">Success</option><option value="failed">Failed attempts</option></select></Field>
          <Field label="Action" hideLabel><Input size="sm" value={action} onChange={update(setAction)} placeholder="Action, e.g. payroll" /></Field>
          <Field label="Record UUID" hideLabel><Input size="sm" value={entityId} onChange={update(setEntityId)} placeholder="Record UUID" className="font-mono" /></Field>
          <Field label="From"><Input size="sm" type="date" value={from} onChange={update(setFrom)} /></Field>
          <div className="flex items-end gap-2"><Field label="To" className="flex-1"><Input size="sm" type="date" value={to} onChange={update(setTo)} /></Field>{hasFilters && <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>}</div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Summary for these filters">
        <MetricCard label="Total events" value={summary ? formatNumber(summary.total) : "—"} icon={FileText} accent="brand" description="Matching the filters" />
        <MetricCard label="Successful" value={summary ? formatNumber(summary.successful) : "—"} icon={CheckCircle2} accent="leave" description={summary?.total ? `${Math.round((summary.successful / summary.total) * 1000) / 10}% of events` : "No events"} />
        <MetricCard label="Failed attempts" value={summary ? formatNumber(summary.failed) : "—"} icon={XCircle} accent="payroll" description="Refused sign-ins, codes and step-ups" />
        <MetricCard label="Security events" value={summary ? formatNumber(summary.security) : "—"} icon={ShieldAlert} accent="audit" description="Sign-in, access and configuration" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <DataTable<AuditLogEntry>
          caption="Audit events"
          rows={logs}
          rowKey={(entry) => entry.id}
          loading={loading}
          error={error && data ? error : null}
          onRetry={reload}
          minWidth={760}
          onRowClick={(entry) => setSelectedId(entry.id)}
          empty={{ title: "No matching activity", description: "Try broader filters, or activity will appear as records change.", icon: ShieldCheck }}
          footer={<Pagination page={page} pageSize={PAGE_SIZE} total={list?.count ?? 0} onPageChange={(next) => setPage(Math.min(Math.max(1, next), pageCount))} />}
          columns={[
            { key: "when", header: "Time", cell: (entry) => <span className={cx("whitespace-nowrap", entry.id === selectedId ? "font-semibold text-ink-strong" : "text-ink-muted")}>{dateTime(entry.created_at)}</span> },
            { key: "actor", header: "Actor", cell: (entry) => entry.actor_email ? <span className="flex items-center gap-2"><Avatar name={entry.actor_email} size="sm" /><span className="max-w-[12rem] truncate" title={entry.actor_email}>{entry.actor_email}</span></span> : <Badge size="sm">System</Badge> },
            { key: "module", header: "Module", cell: (entry) => <Badge size="sm" tone="neutral">{moduleOf(entry)}</Badge> },
            { key: "action", header: "Action", cell: (entry) => <span className={cx("font-semibold", isFailedAuditAction(entry.action) ? "text-danger-ink" : "text-ink-strong")}>{pretty(entry.action.split(".").slice(1).join(".") || entry.action)}</span> },
            { key: "record", header: "Record", hideBelow: "lg", cell: (entry) => <span><span className="block">{entry.entity_type ? pretty(entry.entity_type.split(".").pop() ?? entry.entity_type) : "—"}</span>{entry.entity_id && <span className="block font-mono text-caption text-ink-subtle">{entry.entity_id.slice(0, 8)}</span>}</span> },
          ]}
        />
        <aside aria-label="Event detail" className="xl:sticky xl:top-20 xl:self-start">
          {selected ? <EventDetail entry={selected} onClose={() => setSelectedId(null)} /> : <div className="rounded-xl border border-dashed border-line-strong p-6 text-center text-support text-ink-muted">Select an event to see its details and field changes.</div>}
        </aside>
      </div>
    </div>
  );
}

function EventDetail({ entry, onClose }: { entry: AuditLogEntry; onClose: () => void }) {
  const [tab, setTab] = useState("overview");
  const changes = fieldChanges(entry);
  const failed = isFailedAuditAction(entry.action);
  return (
    <section className="rounded-xl border border-line bg-surface shadow-elevation-1">
      <div className="flex items-start gap-3 border-b border-line-soft p-5">
        {entry.actor_email ? <Avatar name={entry.actor_email} /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-caption font-bold text-ink-muted">SYS</span>}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-ink-strong">{pretty(entry.action)}<Badge size="sm" tone={failed ? "danger" : "success"}>{failed ? "Failed" : "Success"}</Badge></p>
          <p className="truncate text-support text-ink-muted">{entry.actor_email ?? "System process"}</p>
          <p className="font-mono text-caption text-ink-subtle">{dateTime(entry.created_at)}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted" aria-label="Close detail"><X className="h-4 w-4" /></button>
      </div>
      <div className="px-5 pt-2"><Tabs label="Event detail views" value={tab} onChange={setTab} items={[{ value: "overview", label: "Overview" }, { value: "changes", label: "Field changes", count: changes.length || undefined }, { value: "raw", label: "Raw event" }]} /></div>
      <div className="p-5">
        {tab === "overview" && (
          <dl className="space-y-2.5 text-support">
            {[
              ["Actor", entry.actor_email ?? "System"],
              ["Module", moduleOf(entry)],
              ["Action", pretty(entry.action)],
              ["Record", entry.entity_type ? `${pretty(entry.entity_type.split(".").pop() ?? "")}${entry.entity_id ? ` · ${entry.entity_id.slice(0, 8)}` : ""}` : "—"],
              ["Result", failed ? "Failed" : "Success"],
              ["Source IP", entry.ip_address ?? "—"],
              ["Device", entry.user_agent || "—"],
            ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="max-w-[60%] break-words text-right text-ink-strong">{value}</dd></div>)}
          </dl>
        )}
        {tab === "changes" && (changes.length ? (
          <table className="w-full text-left text-caption">
            <thead className="bg-surface-muted/70 uppercase tracking-[0.06em] text-ink-muted"><tr><th className="px-2 py-2 font-semibold">Field</th><th className="px-2 py-2 font-semibold">Before</th><th className="px-2 py-2 font-semibold">After</th></tr></thead>
            <tbody className="divide-y divide-line-soft font-mono">
              {changes.map(([field, before, after]) => <tr key={field}><td className="px-2 py-2 font-sans font-semibold text-ink-strong">{pretty(field)}</td><td className="px-2 py-2 text-ink-muted line-through decoration-ink-subtle/60">{display(before)}</td><td className="px-2 py-2 text-ink-strong">{display(after)}</td></tr>)}
            </tbody>
          </table>
        ) : <p className="text-support text-ink-muted">This event records no field-level changes.</p>)}
        {tab === "raw" && <pre className="max-h-96 overflow-auto rounded-lg bg-surface-muted p-3 font-mono text-caption text-ink">{JSON.stringify({ action: entry.action, entity_type: entry.entity_type, entity_id: entry.entity_id, created_at: entry.created_at, metadata: entry.metadata }, null, 2)}</pre>}
      </div>
    </section>
  );
}
