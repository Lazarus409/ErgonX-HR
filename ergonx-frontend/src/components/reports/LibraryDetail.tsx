"use client";

import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Clock3, Copy, Eye, FileText, Info, Layers, MoreVertical, RefreshCw, Share2, Trash2, User, X, ExternalLink, ChevronDown, Archive } from "lucide-react";

import { Button, ButtonLink, IconButton } from "@/components/ui/Button";
import { Field, Select, Checkbox } from "@/components/ui/Field";
import { Menu, MenuItem, Popover } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { getApiErrorMessage, reportLibraryApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { EM_DASH, formatCount, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { LibraryEntry, LibraryItemInput, LibraryOptions, LibraryPerson } from "@/types/reportLibrary";
import { isModuleOffered } from "@/lib/product";

export function PersonChip({ person, size = "sm" }: { person: LibraryPerson | null; size?: "sm" | "md" }) {
  if (!person) return <span className="text-ink-muted">ErgonX</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary-ink", size === "sm" ? "h-7 w-7 text-[0.6875rem]" : "h-8 w-8 text-caption")}>{person.initials}</span>
      <span className="min-w-0 truncate">{person.name}</span>
    </span>
  );
}

export function FreshnessDot({ entry }: { entry: LibraryEntry }) {
  const tone = entry.freshness.state === "UP_TO_DATE" ? "bg-success" : entry.freshness.state === "STALE" ? "bg-warning" : "bg-ink-subtle";
  return <span className="inline-flex items-center gap-2 whitespace-nowrap"><span aria-hidden="true" className={cx("h-2.5 w-2.5 rounded-full", tone)} />{entry.freshness.label}</span>;
}

export function KindIcon({ entry, className }: { entry: LibraryEntry; className?: string }) {
  const Icon = entry.kind === "DASHBOARD" ? BarChart3 : FileText;
  return <span aria-hidden="true" className={cx("inline-flex shrink-0 items-center justify-center rounded-xl", entry.kind === "DASHBOARD" ? "bg-primary-soft text-primary" : "bg-mod-recruitment-soft text-mod-recruitment", className ?? "h-10 w-10")}><Icon className="h-5 w-5" /></span>;
}

const ACTIVITY_LABELS: Record<string, string> = {
  "reports.analytics_item.created": "Created",
  "reports.analytics_item.updated": "Updated",
  "reports.analytics_item.refreshed": "Refreshed",
  "reports.analytics_item.shared": "Shared",
  "reports.analytics_item.unshared": "Stopped sharing",
  "accounting.financial_report.created": "Created",
  "accounting.financial_report.updated": "Updated",
  "accounting.financial_report.run": "Run",
};

function Row({ icon: Icon, label, children }: { icon: typeof Info; label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[1.25rem_7.5rem_1fr] items-start gap-2 py-1.5 text-support">
      <Icon className="mt-0.5 h-4 w-4 text-ink-muted" aria-hidden="true" />
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink-strong">{children}</dd>
    </div>
  );
}

function ActivityList({ entry }: { entry: LibraryEntry }) {
  const load = useCallback(() => entry.origin === "library" ? reportLibraryApi.getLibraryActivity(entry.id) : Promise.resolve([]), [entry.id, entry.origin, entry.updated_at, entry.last_refreshed_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, loading, error } = useApiResource(load);
  if (entry.origin === "financial_report") return <p className="text-support text-ink-muted">Run history for this report is on its <Link className="font-semibold text-primary-ink hover:underline" href={entry.href}>financial report page</Link>.</p>;
  if (loading && !data) return <div className="space-y-2">{[0, 1, 2].map((index) => <div key={index} className="skeleton h-10 rounded-lg" />)}</div>;
  if (error) return <p className="text-support text-danger-ink">{error}</p>;
  if (!data?.length) return <p className="text-support text-ink-muted">{entry.is_system ? "Built-in items keep no personal history; refreshes of your saved copies are recorded." : "No activity recorded yet."}</p>;
  return (
    <ol className="space-y-3">
      {data.map((item) => (
        <li key={item.id} className="flex gap-3 text-support">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0">
            <p className="font-semibold text-ink-strong">{ACTIVITY_LABELS[item.action] ?? humanizeEnum(item.action.split(".").at(-1))}{typeof item.metadata.rows === "number" ? ` · ${formatCount(item.metadata.rows, "row")}` : ""}</p>
            <p className="text-caption text-ink-muted">{item.actor?.name ?? "System"} · {formatDateTime(item.created_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function AccessList({ entry }: { entry: LibraryEntry }) {
  return (
    <div className="space-y-3 text-support">
      <p className="text-ink">
        {entry.visibility === "INSTITUTION" ? <>Everyone whose role can open <strong>{entry.module_label}</strong> data sees this {entry.kind.toLowerCase()}.</> : entry.visibility === "SHARED" ? <>Shared with specific people. Each still needs a role that can open {entry.module_label} data.</> : <>Only the owner can see this {entry.kind.toLowerCase()}.</>}
      </p>
      <ul className="divide-y divide-line-soft rounded-xl border border-line">
        <li className="flex items-center justify-between gap-3 px-3 py-2.5"><PersonChip person={entry.owner} /><span className="text-caption font-semibold text-ink-muted">{entry.owner ? "Owner" : "Built-in"}</span></li>
        {entry.shared_with.map((person) => <li key={person.id} className="flex items-center justify-between gap-3 px-3 py-2.5"><PersonChip person={person} /><span className="text-caption font-semibold text-ink-muted">{person.can_edit ? "Can edit" : "Can view"}</span></li>)}
      </ul>
      {entry.shared_with_me && <p className="text-caption text-ink-muted">Shared with you by {entry.owner?.name ?? "the owner"}.</p>}
    </div>
  );
}

function SettingsForm({ entry, options, onSaved }: { entry: LibraryEntry; options: LibraryOptions | null; onSaved: (entry: LibraryEntry) => void }) {
  const [draft, setDraft] = useState<LibraryItemInput>({ status: entry.status, visibility: entry.visibility, schedule: entry.schedule, category: entry.category });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!entry.can_edit) {
    return <p className="text-support text-ink-muted">{entry.is_system ? "Built-in items can't be changed. Duplicate one to save your own version." : entry.origin === "financial_report" ? "Manage this report in Accounting › Financial Reports." : "Only the owner or an editor can change these settings."}</p>;
  }
  const save = async () => {
    setSaving(true); setError(null);
    try { onSaved(await reportLibraryApi.updateLibraryItem(entry.id, draft)); } catch (caught) { setError(getApiErrorMessage(caught)); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      <Field label="Status">
        <Select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as LibraryItemInput["status"], ...(event.target.value === "DRAFT" && current.visibility === "INSTITUTION" ? { visibility: "PRIVATE" } : {}) }))}>
          <option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option>
        </Select>
      </Field>
      <Field label="Who can see it">
        <Select value={draft.visibility} onChange={(event) => setDraft((current) => ({ ...current, visibility: event.target.value as LibraryItemInput["visibility"] }))}>
          <option value="PRIVATE">Only me</option>
          <option value="SHARED">Specific people</option>
          {(entry.can_publish || entry.visibility === "INSTITUTION") && draft.status === "PUBLISHED" && <option value="INSTITUTION">Everyone with access to this data</option>}
        </Select>
      </Field>
      {entry.kind === "REPORT" && (
        <Field label="Schedule" helper={entry.next_run_on ? `Next refresh ${entry.next_run_on}` : undefined}>
          <Select value={draft.schedule} onChange={(event) => setDraft((current) => ({ ...current, schedule: event.target.value as LibraryItemInput["schedule"] }))}>
            <option value="NONE">Not scheduled</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
          </Select>
        </Field>
      )}
      <Field label="Category">
        <Select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as LibraryItemInput["category"] }))}>
          {isModuleOffered("ACCOUNTING") && <option value="FINANCE">Finance</option>}<option value="HR">HR</option><option value="RECRUITMENT">Recruitment</option><option value="OPERATIONS">Operations</option><option value="CUSTOM">Custom</option>
        </Select>
      </Field>
      {!options?.can_publish && <p className="text-caption text-ink-muted">Publishing to everyone needs the report.publish permission.</p>}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      <Button onClick={() => void save()} loading={saving}>Save settings</Button>
    </div>
  );
}

function SharePanel({ entry, options, onSaved, close }: { entry: LibraryEntry; options: LibraryOptions | null; onSaved: (entry: LibraryEntry) => void; close: () => void }) {
  const candidates = (options?.members ?? []).filter((member) => !entry.shared_with.some((person) => person.id === member.id));
  const [userId, setUserId] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (payload: { user_id: string; can_edit?: boolean; remove?: boolean }) => {
    setBusy(true); setError(null);
    try { onSaved(await reportLibraryApi.shareLibraryItem(entry.id, payload)); setUserId(""); } catch (caught) { setError(getApiErrorMessage(caught)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between"><p className="font-bold text-headline">Share {entry.name}</p><IconButton label="Close" variant="ghost" size="sm" onClick={close}><X className="h-4 w-4" /></IconButton></div>
      <Field label="Person" helper="Only members whose role can open Reports & Analytics are listed.">
        <Select value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">Choose a member</option>
          {candidates.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.role}</option>)}
        </Select>
      </Field>
      <Checkbox label="Can edit" description="Editors can change settings but not share." checked={canEdit} onChange={(event) => setCanEdit(event.target.checked)} />
      <Button block disabled={!userId} loading={busy} onClick={() => void run({ user_id: userId, can_edit: canEdit })}>Share</Button>
      {entry.shared_with.length > 0 && (
        <ul className="divide-y divide-line-soft border-t border-line-soft pt-1">
          {entry.shared_with.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-2 py-2 text-support">
              <PersonChip person={person} /><span className="text-caption text-ink-muted">{person.can_edit ? "Edit" : "View"}</span>
              <IconButton label={`Stop sharing with ${person.name}`} variant="ghost" size="sm" onClick={() => void run({ user_id: person.id, remove: true })}><Trash2 className="h-4 w-4" /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    </div>
  );
}

/** Right-hand detail panel of the library (concept "Reports and analytics"). */
export default function LibraryDetail({ entry, options, onClose, onChanged, onDuplicated, embedded = false }: { entry: LibraryEntry; options: LibraryOptions | null; onClose: () => void; onChanged: (entry: LibraryEntry) => void; onDuplicated: (entry: LibraryEntry) => void; /** Inside a drawer: no card frame or close button of its own. */ embedded?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isLibrary = entry.origin === "library";
  const act = async (name: string, run: () => Promise<LibraryEntry>, after?: (result: LibraryEntry) => void) => {
    setBusy(name); setError(null);
    try { const result = await run(); (after ?? onChanged)(result); } catch (caught) { setError(getApiErrorMessage(caught)); } finally { setBusy(null); }
  };
  const open = () => { if (isLibrary) void reportLibraryApi.refreshLibraryItem(entry.id).then(onChanged).catch(() => undefined); };
  const kindLabel = entry.kind === "DASHBOARD" ? "Dashboard" : "Report";

  return (
    <aside className={cx("flex h-fit flex-col", !embedded && "rounded-2xl border border-line bg-surface p-5 shadow-elevation-1")} aria-label={`${entry.name} details`}>
      <div className="flex items-start gap-3">
        <KindIcon entry={entry} className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <h2 className="text-heading font-bold leading-tight text-headline">{entry.name}</h2>
          <p className="mt-0.5 text-support text-ink-muted">{kindLabel}{entry.code ? ` · ${entry.code}` : ""}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {!embedded && <IconButton label="Close details" variant="ghost" size="sm" onClick={onClose}><X className="h-4 w-4" /></IconButton>}
          <StatusBadge status={entry.status} size="sm" />
        </div>
      </div>
      {entry.description && <p className="mt-3 text-support text-ink">{entry.description}</p>}

      <Tabs className="mt-4" label="Item details" value={tab} onChange={setTab} items={[{ value: "overview", label: "Overview" }, { value: "access", label: "Access" }, { value: "activity", label: "Activity" }, { value: "settings", label: "Settings" }]} />
      <div className="mt-4 min-h-[12rem]">
        {tab === "overview" && (
          <dl>
            <Row icon={Layers} label="Module">{entry.module_label}</Row>
            <Row icon={User} label="Owner"><PersonChip person={entry.owner} /></Row>
            <Row icon={CalendarDays} label="Created">{formatDateTime(entry.created_at)}</Row>
            <Row icon={Clock3} label="Last refreshed">{entry.last_refreshed_at ? formatDateTime(entry.last_refreshed_at) : EM_DASH}{entry.last_refreshed_by ? <span className="block text-caption text-ink-muted">by {entry.last_refreshed_by.name}</span> : null}</Row>
            <Row icon={RefreshCw} label="Data freshness"><FreshnessDot entry={entry} /></Row>
            {entry.kind === "REPORT" && entry.schedule !== "NONE" && <Row icon={CalendarDays} label="Schedule">{humanizeEnum(entry.schedule)}{entry.next_run_on ? ` · next ${entry.next_run_on}` : ""}</Row>}
            {entry.last_row_count !== null && <Row icon={FileText} label="Rows">{formatCount(entry.last_row_count, "row")} at last refresh</Row>}
            <Row icon={Info} label="Source">{entry.source_label}{Object.keys(entry.filters).length ? <span className="block text-caption text-ink-muted">{Object.entries(entry.filters).map(([key, value]) => `${humanizeEnum(key)}: ${value}`).join(" · ")}</span> : null}</Row>
          </dl>
        )}
        {tab === "access" && <AccessList entry={entry} />}
        {tab === "activity" && <ActivityList entry={entry} />}
        {tab === "settings" && <SettingsForm key={entry.updated_at} entry={entry} options={options} onSaved={onChanged} />}
      </div>

      <section className="mt-5 border-t border-line-soft pt-4">
        <h3 className="text-card-title font-bold text-headline">Preview</h3>
        <div className="mt-3 rounded-2xl border border-primary/15 bg-primary-soft/40 p-4">
          <p className="flex items-start gap-3"><Eye className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span><span className="block font-bold text-headline">You have {entry.can_edit ? "edit" : "view"} access</span><span className="text-support text-ink-muted">Open the {kindLabel.toLowerCase()} to explore detailed insights.</span></span></p>
          <div className="mt-3 flex flex-col items-center rounded-xl border border-line bg-surface px-4 py-5 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-ink-subtle" aria-hidden="true"><BarChart3 className="h-5 w-5" /></span>
            <p className="mt-2 font-bold text-ink-strong">{kindLabel} preview</p>
            <p className="text-caption text-ink-muted">{entry.kind === "REPORT" && entry.last_row_count !== null ? `${formatCount(entry.last_row_count, "row")} at the last refresh, limited to your access.` : `${kindLabel} content appears based on your access permissions.`}</p>
            <ButtonLink href={entry.href} className="mt-3" leadingIcon={<ExternalLink className="h-4 w-4" />} onClick={open}>Open {kindLabel.toLowerCase()}</ButtonLink>
          </div>
        </div>
      </section>

      {error && <p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {entry.can_share ? (
          <Popover width="w-80" label="Share" trigger={(props) => <Button {...props} variant="secondary" block leadingIcon={<Share2 className="h-4 w-4" />} trailingIcon={<ChevronDown className="h-4 w-4" />}>Share</Button>}>
            {(close) => <SharePanel entry={entry} options={options} onSaved={onChanged} close={close} />}
          </Popover>
        ) : (
          <Button variant="secondary" block disabled leadingIcon={<Share2 className="h-4 w-4" />} title={entry.is_system ? "Built-in items are shared through roles" : "Only the owner can share"}>Share</Button>
        )}
        <Menu label="More actions" trigger={(props) => <Button {...props} variant="secondary" block leadingIcon={<MoreVertical className="h-4 w-4" />} trailingIcon={<ChevronDown className="h-4 w-4" />} loading={busy !== null}>More actions</Button>}>
          {isLibrary && <MenuItem icon={<RefreshCw className="h-4 w-4" />} onSelect={() => void act("refresh", () => reportLibraryApi.refreshLibraryItem(entry.id))} description={entry.kind === "REPORT" ? "Re-run with the saved filters" : "Mark as viewed now"}>Refresh</MenuItem>}
          {isLibrary && <MenuItem icon={<Copy className="h-4 w-4" />} onSelect={() => void act("duplicate", () => reportLibraryApi.duplicateLibraryItem(entry.id), onDuplicated)} description="Save a private copy you own">Duplicate</MenuItem>}
          {entry.can_edit && entry.status !== "ARCHIVED" && <MenuItem icon={<Archive className="h-4 w-4" />} tone="danger" onSelect={() => void act("archive", () => reportLibraryApi.updateLibraryItem(entry.id, { status: "ARCHIVED", visibility: entry.visibility === "INSTITUTION" ? "PRIVATE" : entry.visibility }))} description="Hide it from everyone else; you can restore it in Settings">Archive</MenuItem>}
          {!isLibrary && <MenuItem icon={<ExternalLink className="h-4 w-4" />} onSelect={() => router.push(entry.href)}>Open in Accounting</MenuItem>}
        </Menu>
      </div>
    </aside>
  );
}
