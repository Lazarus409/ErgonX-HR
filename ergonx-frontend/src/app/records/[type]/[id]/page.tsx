"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Ban, BookOpen, Briefcase, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, ExternalLink, FileText, GitBranch, Lock, LogOut, Pencil, RefreshCw, Shield, UserCheck, UsersRound, Wallet } from "lucide-react";

import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import LifecycleStepper from "@/components/ui/LifecycleStepper";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { apiGet } from "@/lib/api/client";
import { cx } from "@/lib/cx";
import { formatDate, formatDateTime } from "@/lib/format";
import { lifecycles } from "@/lib/lifecycles";
import { useApiResource } from "@/lib/useApiResource";

type LinkRow = { reference: string; label: string; date: string | null; href: string | null };
type HistoryEvent = { id: string; action: string; label: string; actor: string; at: string; kind: string; entity: string; metadata: Record<string, unknown> };
interface RecordHistory {
  record: { type: string; id: string; reference: string; title: string; status: string; facts: Array<{ label: string; value: string | null }>; href: string; href_label: string };
  current_state: { label: string; at: string | null; link: LinkRow | null };
  stages: Array<{ label: string; icon: string; events: HistoryEvent[]; start: string; end: string }>;
  lineage: { predecessors: LinkRow[]; this: LinkRow; successors: LinkRow[] };
  people: Array<{ label: string; value: string; href: string | null }>;
  read_only: boolean;
  read_only_reason: string;
}

const ICONS: Record<string, typeof FileText> = { file: FileText, users: UsersRound, "file-text": FileText, "user-check": UserCheck, refresh: RefreshCw, shield: Shield, check: Check, book: BookOpen, wallet: Wallet, briefcase: Briefcase, "log-out": LogOut };
const KINDS: Record<string, { label: string; tone: string; icon: typeof FileText; text: string }> = {
  ORIGINAL: { label: "Original", tone: "border-success/40 bg-success-soft/40 text-success-ink", icon: FileText, text: "The initial creation of a record (e.g. application submitted)." },
  CORRECTION: { label: "Correction", tone: "border-warning/40 bg-warning-soft/40 text-warning-ink", icon: Pencil, text: "A change that corrects or returns data in a previous step." },
  REVERSAL: { label: "Reversal", tone: "border-mod-recruitment/40 bg-mod-recruitment-soft/40 text-mod-recruitment", icon: RefreshCw, text: "Reverses the effect of a previous action (e.g. withdraw a decision)." },
  VOID: { label: "Void", tone: "border-danger/40 bg-danger-soft/40 text-danger-ink", icon: Ban, text: "Voided, rejected or cancelled; retained for audit but no longer in effect." },
  AUDIT: { label: "Audit event", tone: "border-line-strong bg-surface-muted text-ink", icon: Shield, text: "Supporting or security events (documents, notes, exports)." },
};

/** Concept "Record history and lineage". */
export default function RecordHistoryPage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const load = useCallback(() => apiGet<RecordHistory>(`/record-history/${type}/${id}/`), [type, id]);
  const { data, loading, error, reload } = useApiResource(load);
  const [tab, setTab] = useState<"history" | "details" | "related">("history");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState(false);

  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "History not available."} onRetry={reload} />;
  const allOpen = data.stages.every((stage) => open[stage.label]);
  const related = [...data.lineage.predecessors, ...data.lineage.successors];

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-5">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-headline text-[1.75rem] font-bold text-white">{data.record.title.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
          <div>
            <div className="flex flex-wrap items-center gap-3"><h1 className="text-[1.625rem] font-bold text-headline">{data.record.title}</h1><StatusBadge status={data.record.status} /></div>
            <dl className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-y-1 text-sm">
              {data.record.facts.map((fact, index) => [<dt key={`${fact.label}-t`} className="text-ink-muted">{fact.label}</dt>, <dd key={`${fact.label}-d`} className="flex items-center gap-2 font-medium text-ink-strong">{fact.value && /^\d{4}-\d{2}-\d{2}/.test(fact.value) ? formatDate(fact.value) : fact.value ?? "—"}{index === 0 && <button type="button" aria-label="Copy reference" onClick={() => { void navigator.clipboard?.writeText(data.record.reference); setCopied(true); }} className="text-ink-muted hover:text-ink-strong">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button>}</dd>])}
            </dl>
          </div>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="lg:border-l lg:border-line-soft lg:pl-6">
            <p className="text-sm text-ink-muted">Current state</p>
            <p className="mt-1 flex items-center gap-2 font-bold text-ink-strong"><CheckCircle2 className="h-7 w-7 text-success" aria-hidden="true" />{data.current_state.label}</p>
            {data.current_state.at && <p className="ml-9 text-sm text-ink-muted">on {formatDate(data.current_state.at)}</p>}
            {data.current_state.link?.href && <p className="ml-9 mt-1 text-sm"><span className="text-ink-muted">{data.current_state.link.label} </span><Link href={data.current_state.link.href} className="inline-flex items-center gap-1 font-semibold text-primary-ink underline">{data.current_state.link.reference}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link></p>}
          </div>
          <Link href={data.record.href} className="inline-flex h-11 items-center rounded-lg border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-hover">{data.record.href_label}</Link>
        </div>
      </section>

      {lifecycles[data.record.type] && <LifecycleStepper lifecycle={lifecycles[data.record.type]} status={data.record.status} />}

      <Tabs label="Record sections" value={tab} onChange={(value) => setTab(value as typeof tab)} items={[{ value: "history", label: "History & Lineage" }, { value: "details", label: "Record Details" }, { value: "related", label: "Related Records", count: related.length }]} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {tab === "history" && (
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-heading font-bold text-headline">Record History</h2><p className="text-support text-heading-support">Events are grouped by stage in the record&apos;s lifecycle. Expand a section to see all events and details.</p></div><button type="button" onClick={() => setOpen(Object.fromEntries(data.stages.map((stage) => [stage.label, !allOpen])))} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary-ink"><ChevronDown className={cx("h-4 w-4 transition", allOpen && "rotate-180")} aria-hidden="true" />{allOpen ? "Collapse all" : "Expand all"}</button></div>
              <ul className="mt-4 space-y-3">
                {data.stages.map((stage) => {
                  const Icon = ICONS[stage.icon] ?? FileText;
                  const expanded = open[stage.label];
                  return (
                    <li key={stage.label} className="rounded-xl border border-line">
                      <button type="button" aria-expanded={expanded} onClick={() => setOpen((current) => ({ ...current, [stage.label]: !current[stage.label] }))} className="flex w-full items-center gap-4 p-4 text-left hover:bg-surface-hover">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-section-icon"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                        <span className="flex-1"><span className="block font-bold text-ink-strong">{stage.label}</span><span className="text-caption text-ink-muted">{stage.events.length} event{stage.events.length === 1 ? "" : "s"} | {formatDate(stage.start)} – {formatDate(stage.end)}</span></span>
                        <ChevronRight className={cx("h-5 w-5 text-ink-muted transition", expanded && "rotate-90")} aria-hidden="true" />
                      </button>
                      {expanded && (
                        <ol className="space-y-3 border-t border-line-soft px-5 py-4">
                          {stage.events.map((event) => {
                            const kind = KINDS[event.kind];
                            return (
                              <li key={event.id} className="flex gap-3 text-sm">
                                <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                                <span className="flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold text-ink-strong">{event.label}{kind && <span className={cx("rounded-full border px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide", kind.tone)}>{kind.label}</span>}</span><span className="text-caption text-ink-muted">{event.actor} · {formatDateTime(event.at)}{event.entity ? ` · ${event.entity.split(".").pop()}` : ""}</span>{typeof event.metadata?.comment === "string" && event.metadata.comment && <span className="block text-caption text-ink">“{event.metadata.comment}”</span>}</span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </li>
                  );
                })}
                {!data.stages.length && <li className="py-8 text-center text-sm text-ink-muted">No recorded events for this record yet.</li>}
              </ul>
            </section>
          )}
          {tab === "details" && (
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <h2 className="text-heading font-bold text-headline">Record details</h2>
              <dl className="mt-3 grid grid-cols-[10rem_minmax(0,1fr)] gap-y-2 text-sm">{data.record.facts.map((fact) => [<dt key={`${fact.label}-t`} className="text-ink-muted">{fact.label}</dt>, <dd key={`${fact.label}-d`} className="font-medium">{fact.value && /^\d{4}-\d{2}-\d{2}/.test(fact.value) ? formatDate(fact.value) : fact.value ?? "—"}</dd>])}<dt className="text-ink-muted">Status</dt><dd><StatusBadge status={data.record.status} size="sm" /></dd></dl>
              <Link href={data.record.href} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">{data.record.href_label}<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link>
            </section>
          )}
          {tab === "related" && (
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
              <h2 className="text-heading font-bold text-headline">Related records</h2>
              {related.length ? <ul className="mt-3 divide-y divide-line-soft text-sm">{related.map((row, index) => <li key={`${row.reference}-${index}`} className="flex items-center justify-between py-2.5"><span><span className="block font-semibold">{row.href ? <Link href={row.href} className="text-primary-ink hover:underline">{row.reference}</Link> : row.reference}</span><span className="text-caption text-ink-muted">{row.label}</span></span><span className="text-caption text-ink-muted">{formatDate(row.date)}</span></li>)}</ul> : <p className="mt-3 text-sm text-ink-muted">No linked records.</p>}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {data.read_only && (
            <section className="flex gap-3 rounded-2xl border border-primary/25 bg-primary-soft/50 p-4 text-sm">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface text-primary"><Lock className="h-5 w-5" aria-hidden="true" /></span>
              <div><p className="font-bold text-primary-ink">This record is read-only</p><p className="mt-1 text-ink">{data.read_only_reason}</p></div>
            </section>
          )}
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
            <h2 className="flex items-center gap-2 font-bold text-ink-strong"><GitBranch className="h-5 w-5" aria-hidden="true" />Record lineage</h2>
            <ol className="relative mt-3 space-y-4 border-l-2 border-line-soft pl-5 text-sm">
              <LineageGroup title="Predecessor records" rows={data.lineage.predecessors} dot="border-line-strong bg-surface" />
              <li className="relative"><span aria-hidden="true" className="absolute -left-[1.625rem] top-1 h-3.5 w-3.5 rounded-full bg-primary" /><span className="font-semibold text-primary-ink">{data.lineage.this.reference}</span> <span className="text-ink-muted">(this record)</span><span className="block text-ink">{data.lineage.this.label}</span><span className="text-caption text-ink-muted">{formatDate(data.lineage.this.date)}</span></li>
              <LineageGroup title="Successor records" rows={data.lineage.successors} dot="bg-success" />
            </ol>
          </section>
          {data.people.length > 0 && (
            <section className="rounded-2xl border border-line bg-surface p-4 shadow-elevation-1">
              <h2 className="flex items-center gap-2 font-bold text-ink-strong"><UsersRound className="h-5 w-5" aria-hidden="true" />People</h2>
              <dl className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1.5 text-sm">{data.people.map((person) => [<dt key={`${person.label}-t`} className="text-ink-muted">{person.label}</dt>, <dd key={`${person.label}-d`}>{person.href ? <Link href={person.href} className="text-primary-ink underline">{person.value}</Link> : person.value}</dd>])}</dl>
            </section>
          )}
        </aside>
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
        <h2 className="font-bold text-ink-strong">Event type patterns</h2>
        <p className="text-support text-ink-muted">How record events are tagged in history across ErgonX.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(KINDS).map(([key, kind]) => { const Icon = kind.icon; return <div key={key} className={cx("rounded-xl border p-3", kind.tone)}><p className="flex items-center gap-2 font-semibold"><Icon className="h-5 w-5" aria-hidden="true" />{kind.label}</p><p className="mt-1 text-caption text-ink">{kind.text}</p></div>; })}
        </div>
      </section>
    </div>
  );
}

function LineageGroup({ title, rows, dot }: { title: string; rows: LinkRow[]; dot: string }) {
  return (
    <li className="relative">
      <span aria-hidden="true" className={cx("absolute -left-[1.625rem] top-1 h-3.5 w-3.5 rounded-full border-2", dot)} />
      <span className="font-semibold text-ink-strong">{title}</span>
      {rows.length ? rows.map((row, index) => <span key={`${row.reference}-${index}`} className="mt-1 flex items-start justify-between gap-2"><span>{row.href ? <Link href={row.href} className="font-semibold text-primary-ink hover:underline">{row.reference}</Link> : <span className="font-semibold">{row.reference}</span>}<span className="block text-caption text-ink-muted">{row.label}</span></span><span className="text-caption text-ink-muted">{formatDate(row.date)}</span></span>) : <span className="block text-ink-muted">None</span>}
    </li>
  );
}
