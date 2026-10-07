"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Filter, Flag, Link2, Search, Unlink } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import Tabs from "@/components/ui/Tabs";
import { accountingApi, getApiErrorMessage } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatAmount, formatDate } from "@/lib/format";
import type { ReconciliationDetail, ReconciliationLine, ReconciliationSuggestion } from "@/types/accounting";

type Tab = "unmatched" | "matched" | "all";

export function lineState(line: ReconciliationLine) {
  if (line.status === "MATCHED") return "MATCHED";
  if (line.status === "EXCEPTION") return "EXCEPTION";
  return line.suggestion_count ? "NEEDS_REVIEW" : "UNMATCHED";
}

/** Statement lines with match / review / flag actions for one reconciliation session. */
export default function ReconciliationTable({ detail, canManage, onChanged, onError, initialTab = "unmatched" }: { detail: ReconciliationDetail; canManage: boolean; onChanged: (next: ReconciliationDetail) => void; onError: (message: string | null) => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"" | "Credit" | "Debit">("");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [reviewing, setReviewing] = useState<ReconciliationLine | null>(null);
  const [suggestions, setSuggestions] = useState<ReconciliationSuggestion[] | null>(null);
  const [flagging, setFlagging] = useState<ReconciliationLine | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = detail.session.status === "COMPLETED";
  const sessionId = detail.session.id;

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return detail.lines.filter((line) => (tab === "all" || (tab === "matched" ? line.status === "MATCHED" : line.status !== "MATCHED"))
      && (!direction || line.type === direction)
      && (!term || `${line.description} ${line.reference} ${line.journal_number ?? ""}`.toLowerCase().includes(term)));
  }, [detail.lines, tab, search, direction]);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages);
  const visible = rows.slice((current - 1) * perPage, current * perPage);

  const act = async (work: () => Promise<ReconciliationDetail>) => {
    setBusy(true);
    onError(null);
    try { onChanged(await work()); setReviewing(null); setFlagging(null); setNote(""); } catch (caught) { onError(getApiErrorMessage(caught)); } finally { setBusy(false); }
  };
  const openReview = async (line: ReconciliationLine) => {
    setReviewing(line);
    setSuggestions(null);
    try { setSuggestions(await accountingApi.getReconciliationSuggestions(sessionId, line.id)); } catch (caught) { onError(getApiErrorMessage(caught)); setSuggestions([]); }
  };
  const exportCsv = () => {
    const header = ["Date", "Description", "Reference", "Amount", "Type", "Matching book entry", "Status"];
    const body = rows.map((line) => [line.statement_date, line.description, line.reference, line.amount, line.type, line.journal_number ?? "", lineState(line)]);
    const csv = [header, ...body].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a"); link.href = url; link.download = `statement-lines-${tab}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-2xl border border-line bg-surface shadow-elevation-1">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-2">
        <Tabs label="Statement lines" value={tab} onChange={(value) => { setTab(value as Tab); setPage(1); }} items={[{ value: "unmatched", label: "Unmatched", count: detail.counts.unmatched + detail.counts.exceptions }, { value: "matched", label: "Matched", count: detail.counts.matched }, { value: "all", label: "All transactions", count: detail.counts.all }]} />
        <div className="flex flex-wrap gap-2 pb-2">
          <label className="relative"><span className="sr-only">Search transactions</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search transactions" className="h-10 w-56 rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm" /></label>
          <Button variant="secondary" leadingIcon={<Filter className="h-4 w-4" />} aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)}>Filters</Button>
          <Button variant="secondary" leadingIcon={<Download className="h-4 w-4" />} disabled={!rows.length} onClick={exportCsv}>Export</Button>
        </div>
      </div>
      {showFilters && <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl bg-surface-muted p-3 text-sm"><label className="flex items-center gap-2">Direction<select value={direction} onChange={(event) => { setDirection(event.target.value as "" | "Credit" | "Debit"); setPage(1); }} className="h-9 rounded-lg border border-line bg-surface px-2"><option value="">Money in and out</option><option value="Credit">Money in (credits)</option><option value="Debit">Money out (debits)</option></select></label></div>}
      <div className="overflow-x-auto px-4">
        <table className="w-full min-w-[50rem] text-sm">
          <thead className="bg-surface-muted text-left text-caption font-semibold text-ink-strong"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Bank transaction</th><th className="px-3 py-2">Matching book entry</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Actions</th></tr></thead>
          <tbody className="divide-y divide-line-soft">
            {visible.map((line) => {
              const state = lineState(line);
              return (
                <tr key={line.id} className="hover:bg-surface-hover">
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{formatDate(line.statement_date)}</td>
                  <td className="max-w-64 px-3 py-2.5"><span className="block truncate font-medium text-ink-strong" title={line.description}>{line.description || line.reference || "—"}</span>{line.exception_note && <span className="block truncate text-caption text-warning-ink" title={line.exception_note}>{line.exception_note}</span>}</td>
                  <td className={cx("whitespace-nowrap px-3 py-2.5 text-right tabular-nums", Number(line.amount) < 0 ? "text-ink-strong" : "text-success-ink")}>{formatAmount(line.amount, line.currency)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{line.type}{line.reference ? ` · ${line.reference}` : ""}</td>
                  <td className="px-3 py-2.5">{line.journal_number ? <a href={`/accounting/journals/${line.journal_entry}`} className="font-semibold text-primary-ink hover:underline">{line.journal_number}</a> : line.suggestion_count ? <span className="text-warning-ink">{line.suggestion_count} possible match{line.suggestion_count === 1 ? "" : "es"}</span> : <span className="text-ink-muted">No match</span>}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={state} size="sm" /></td>
                  <td className="whitespace-nowrap px-3 py-2.5"><div className="flex items-center gap-1">
                    {canManage && !locked && line.status !== "MATCHED" && <button type="button" onClick={() => void openReview(line)} className="mr-2 font-semibold text-primary-ink hover:underline">{state === "NEEDS_REVIEW" ? "Review" : "Match"}</button>}
                    {canManage && !locked && (
                      <Menu label={`More for ${line.reference || line.description}`} trigger={(props) => <button {...props} type="button" className="rounded p-1 text-ink-muted hover:bg-surface-hover" aria-label="More actions">•••</button>}>
                        {(close) => (
                          <div className="p-1.5">
                            {line.status === "MATCHED" && <MenuItem icon={<Unlink className="h-4 w-4" />} onSelect={() => { close(); void act(() => accountingApi.reconciliationLineAction(sessionId, line.id, "unmatch")); }}>Unmatch</MenuItem>}
                            {line.status === "UNMATCHED" && <MenuItem icon={<Flag className="h-4 w-4" />} onSelect={() => { close(); setFlagging(line); }}>Flag as exception</MenuItem>}
                            {line.status === "EXCEPTION" && <MenuItem icon={<Flag className="h-4 w-4" />} onSelect={() => { close(); void act(() => accountingApi.reconciliationLineAction(sessionId, line.id, "unflag")); }}>Clear exception</MenuItem>}
                          </div>
                        )}
                      </Menu>
                    )}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!visible.length && <p className="py-10 text-center text-sm text-ink-muted">{detail.counts.all ? "No transactions match this view." : "Import the bank statement to start matching transactions."}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-ink-muted">
        <span>Showing {visible.length} of {rows.length} {tab === "all" ? "" : tab} transactions</span>
        <span className="flex items-center gap-2">Rows per page<select value={perPage} onChange={(event) => { setPerPage(Number(event.target.value)); setPage(1); }} className="h-9 rounded-lg border border-line bg-surface px-2">{[10, 25, 50].map((value) => <option key={value}>{value}</option>)}</select>
          <button type="button" aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)} className="rounded p-1 hover:bg-surface-hover disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          <span className="rounded-lg bg-primary px-2.5 py-1 font-semibold text-white">{current}</span><span>/ {pages}</span>
          <button type="button" aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)} className="rounded p-1 hover:bg-surface-hover disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </span>
      </div>

      <Dialog open={reviewing !== null} onClose={() => setReviewing(null)} size="lg" title="Match statement line" description={reviewing ? `${formatDate(reviewing.statement_date)} · ${reviewing.description || reviewing.reference} · ${formatAmount(reviewing.amount, reviewing.currency)}` : ""} footer={<Button variant="secondary" onClick={() => setReviewing(null)}>Close</Button>}>
        {suggestions === null ? <p className="text-sm text-ink-muted">Finding posted journals with the same bank movement…</p> : suggestions.length ? (
          <ul className="divide-y divide-line-soft rounded-xl border border-line-soft">
            {suggestions.map((journal) => (
              <li key={journal.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="flex-1"><span className="block font-semibold text-ink-strong">{journal.journal_number} · {formatDate(journal.entry_date)}</span><span className="text-caption text-ink-muted">{journal.description} · {journal.source}</span></span>
                <Button size="sm" loading={busy} leadingIcon={<Link2 className="h-4 w-4" />} onClick={() => reviewing && void act(() => accountingApi.reconciliationLineAction(sessionId, reviewing.id, "match", { journal_entry: journal.id }))}>Match</Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm"><p className="font-semibold text-ink-strong">No posted journal matches this amount.</p><p className="text-ink-muted">Suggestions need a posted journal whose bank-ledger movement equals the statement amount within 7 days. Post the missing payment, receipt or bank-charge journal, or flag the line as an exception.</p></div>
        )}
      </Dialog>
      <Dialog open={flagging !== null} onClose={() => setFlagging(null)} title="Flag as exception" description="Exceptions stay visible in the reconciliation report and don't block completion."
        footer={<><Button variant="secondary" onClick={() => setFlagging(null)}>Cancel</Button><Button loading={busy} disabled={!note.trim()} onClick={() => flagging && void act(() => accountingApi.reconciliationLineAction(sessionId, flagging.id, "flag", { note: note.trim() }))}>Flag line</Button></>}>
        <label className="block"><span className="mb-1.5 block text-sm font-semibold">Explanation</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Bank charge not yet journalled" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" /></label>
      </Dialog>
    </section>
  );
}
