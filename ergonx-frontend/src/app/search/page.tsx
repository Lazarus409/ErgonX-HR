"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bookmark, BriefcaseBusiness, ChevronDown, ChevronRight, Clock3, FileText, Info, Landmark, Search, Settings, UsersRound, Wallet, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import { Menu, MenuItem, Popover } from "@/components/ui/Overlay";
import { getApiErrorMessage, organizationApi, searchApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDate } from "@/lib/format";
import { isModuleOffered } from "@/lib/product";
import type { SearchEntries, SearchResult } from "@/types/search";

// Record types that belong to Payroll or Accounting, which ErgonX HR does not offer.
const EXCLUDED_RECORD_TYPES = new Set(["PAYROLL_RUN", "PAYROLL_RECORD", "INVOICE", "VENDOR_BILL", "JOURNAL", "ACCOUNT", "VENDOR", "CUSTOMER", "BUDGET"]);
const GROUPS = ([["PEOPLE", "People", UsersRound], ["PAYROLL", "Payroll", Wallet], ["ACCOUNTING", "Accounting", Landmark], ["RECRUITMENT", "Recruitment", BriefcaseBusiness], ["DOCUMENTS", "Documents", FileText], ["OTHER", "Settings", Settings]] as Array<[string, string, typeof UsersRound]>).filter(([code]) => isModuleOffered(code));
const MODULES = ([["", "All modules"], ["CORE_HR", "Core HR"], ["LEAVE", "Leave"], ["PAYROLL", "Payroll"], ["RECRUITMENT", "Recruitment"], ["ACCOUNTING", "Accounting"]] as Array<[string, string]>).filter(([code]) => !code || isModuleOffered(code));
const TYPES = ([["", "All record types"], ["EMPLOYEE", "Employees"], ["CANDIDATE", "Candidates"], ["LEAVE_REQUEST", "Leave requests"], ["PAYROLL_RUN", "Payroll runs"], ["PAYROLL_RECORD", "Payroll records"], ["JOB_POSTING", "Requisitions"], ["OFFER", "Offers"], ["INVOICE", "Invoices"], ["VENDOR_BILL", "Vendor bills"], ["JOURNAL", "Journals"], ["ACCOUNT", "Accounts"], ["VENDOR", "Vendors"], ["CUSTOMER", "Customers"], ["BUDGET", "Budgets"], ["DOCUMENT", "Documents"]] as Array<[string, string]>).filter(([code]) => !EXCLUDED_RECORD_TYPES.has(code));
const WINDOWS: Array<[string, string]> = [["", "Any time"], ["7d", "Past 7 days"], ["30d", "Past 30 days"], ["365d", "Past year"]];
const PREVIEW = 3;

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term || !text) return <>{text}</>;
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<strong className="font-bold text-ink-strong">{text.slice(index, index + term.length)}</strong>{text.slice(index + term.length)}</>;
}

/** Concept "Global search results" (option 1). */
export default function GlobalSearchPage() {
  const router = useRouter();
  const [input, setInput] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("q") ?? ""));
  const [query, setQuery] = useState(input);
  const [filters, setFilters] = useState({ module: "", type: "", since: "", location: "", department: "", sort: "relevance" });
  const [group, setGroup] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<SearchEntries | null>(null);
  const [lookups, setLookups] = useState<{ departments: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    searchApi.getSearchEntries().then((value) => active && setEntries(value)).catch(() => undefined);
    organizationApi.loadOrganizationLookups().then((value) => active && setLookups({ departments: value.departments, locations: value.locations })).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const term = query.trim();
    if (term.length < 2) { Promise.resolve().then(() => { if (active) { setResults(null); setCounts({}); } }); return () => { active = false; }; }
    Promise.resolve().then(() => active && setLoading(true));
    searchApi.universalSearch({ query: term, full: true, module: filters.module || undefined, types: filters.type ? [filters.type] : undefined, since: filters.since || undefined, department: filters.department || undefined, location: filters.location || undefined, sort: filters.sort })
      .then((response) => { if (!active) return; setResults(response.results); setCounts(response.groups ?? {}); setError(null); return searchApi.getSearchEntries().then((value) => active && setEntries(value)); })
      .catch((caught) => active && setError(getApiErrorMessage(caught)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query, filters]);

  const submit = useCallback(() => { setQuery(input.trim()); setGroup(""); router.replace(`/search?q=${encodeURIComponent(input.trim())}`); }, [input, router]);
  const grouped = useMemo(() => GROUPS.map(([key, label, Icon]) => ({ key, label, Icon, rows: (results ?? []).filter((row) => (row.group ?? "OTHER") === key) })).filter((item) => item.rows.length && (!group || item.key === group)), [results, group]);
  const total = results?.length ?? 0;
  const term = query.trim();
  const saveCurrent = async () => {
    try { setEntries(await searchApi.saveSearch(term, term, Object.fromEntries(Object.entries(filters).filter(([, value]) => value)))); setNotice(`Saved “${term}”.`); } catch (caught) { setError(getApiErrorMessage(caught)); }
  };
  const selectClass = "h-11 w-full appearance-none rounded-lg border border-line-strong bg-surface pl-3 pr-9 text-sm";

  return (
    <div className="space-y-5">
      <div><h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Global Search</h1><p className="mt-1.5 text-[1.0625rem] text-heading-support">Search across people, payroll, finance, recruitment and more.</p></div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="relative min-w-[18rem] flex-1" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input value={input} onChange={(event) => setInput(event.target.value)} autoFocus aria-label="Search" placeholder="Search people, records and documents" className="h-12 w-full rounded-xl border border-line-strong bg-surface pl-12 pr-10 text-body" />
          {input && <button type="button" aria-label="Clear search" onClick={() => setInput("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:bg-surface-hover"><X className="h-4 w-4" /></button>}
        </form>
        <Button size="lg" className="min-w-[8rem]" disabled={input.trim().length < 2} onClick={submit}>Search</Button>
        <Popover label="Search tips" width="w-80" trigger={(props) => <button {...props} type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-ink hover:underline"><Info className="h-4 w-4" aria-hidden="true" />Search tips</button>}>
          <ul className="space-y-1.5 p-4 text-sm text-ink">
            <li>Search by name, email, employee number or record reference.</li>
            <li>References work directly: <strong>EMP-…</strong>, <strong>PR-…</strong>, <strong>LR-…</strong>, invoice and bill numbers.</li>
            <li>Results only include records your role can open.</li>
            <li>Department and location filters apply to people.</li>
          </ul>
        </Popover>
        <span aria-hidden="true" className="hidden h-6 w-px bg-line sm:block" />
        <Menu label="Saved searches" width="w-72" trigger={(props) => <button {...props} type="button" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-ink"><Bookmark className="h-4 w-4" aria-hidden="true" />Saved searches<ChevronDown className="h-4 w-4" aria-hidden="true" /></button>}>
          {(close) => (
            <div className="p-1.5">
              {term.length >= 2 && <MenuItem icon={<Bookmark className="h-4 w-4" />} onSelect={() => { close(); void saveCurrent(); }}>Save “{term}”</MenuItem>}
              {(entries?.saved ?? []).map((item) => (
                <MenuItem key={item.id} icon={<Search className="h-4 w-4" />} description={Object.values(item.filters).join(" · ") || undefined} onSelect={() => { close(); setInput(item.query); setQuery(item.query); setFilters((current) => ({ ...current, ...item.filters })); }}>{item.name}</MenuItem>
              ))}
              {!entries?.saved.length && <p className="px-3 py-2 text-caption text-ink-muted">No saved searches yet.</p>}
            </div>
          )}
        </Menu>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        {([["module", MODULES], ["type", TYPES], ["since", WINDOWS]] as const).map(([key, options]) => (
          <label key={key} className="relative"><span className="sr-only">{key}</span><select value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))} className={selectClass}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></label>
        ))}
        <label className="relative"><span className="sr-only">Location</span><select value={filters.location} disabled={!lookups} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))} className={selectClass}><option value="">All locations</option>{(lookups?.locations ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></label>
        <label className="relative"><span className="sr-only">Department</span><select value={filters.department} disabled={!lookups} onChange={(event) => setFilters((current) => ({ ...current, department: event.target.value }))} className={selectClass}><option value="">All departments</option>{(lookups?.departments ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></label>
        <button type="button" onClick={() => { setFilters({ module: "", type: "", since: "", location: "", department: "", sort: filters.sort }); setGroup(""); }} className="text-sm font-semibold text-primary-ink hover:underline">Clear all</button>
      </div>

      {error && <ErrorState variant="inline" title="Search failed" message={error} />}
      {notice && <p className="rounded-xl bg-success-soft px-4 py-2 text-sm text-success-ink">{notice}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <nav aria-label="Result groups" className="space-y-1 text-sm">
            <button type="button" onClick={() => setGroup("")} className={cx("flex w-full items-center rounded-lg px-3 py-2 font-semibold", !group ? "bg-primary-soft text-primary-ink" : "hover:bg-surface-hover")}>Results ({total})</button>
            {GROUPS.filter(([key]) => counts[key]).map(([key, label, Icon]) => (
              <button key={key} type="button" onClick={() => setGroup(key)} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2", group === key ? "bg-primary-soft font-semibold text-primary-ink" : "hover:bg-surface-hover")}><Icon className="h-5 w-5 text-section-icon" aria-hidden="true" /><span className="flex-1 text-left">{label}</span><span className="rounded-full bg-surface-muted px-2 text-caption font-semibold">{counts[key]}</span></button>
            ))}
          </nav>
          <div className="border-t border-line-soft pt-3">
            <div className="flex items-center justify-between px-3"><p className="flex items-center gap-2 text-sm font-semibold text-ink-strong"><Clock3 className="h-4 w-4" aria-hidden="true" />Recent searches</p>{!!entries?.recent.length && <button type="button" onClick={() => void searchApi.deleteSearchEntry({ kind: "RECENT" }).then(setEntries)} className="text-caption text-primary-ink hover:underline">Clear</button>}</div>
            <ul className="mt-1 text-sm">{(entries?.recent ?? []).map((item) => <li key={item.id}><button type="button" onClick={() => { setInput(item.query); setQuery(item.query); }} className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-surface-hover", item.query.toLowerCase() === term.toLowerCase() && "bg-primary-soft/60")}><Clock3 className="h-4 w-4 text-ink-subtle" aria-hidden="true" />{item.query}</button></li>)}</ul>
            {entries && !entries.recent.length && <p className="px-3 py-1 text-caption text-ink-muted">Your searches will appear here.</p>}
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4 shadow-elevation-1 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-heading text-ink-strong">{term.length < 2 ? "Type at least two characters to search." : loading && !results ? "Searching…" : <>Showing <strong>{total}</strong> result{total === 1 ? "" : "s"} for <strong>“{term}”</strong></>}</p>
            <label className="flex items-center gap-2 text-sm">Sort by<span className="relative"><select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))} className="h-10 appearance-none rounded-lg border border-line-strong bg-surface pl-3 pr-9"><option value="relevance">Relevance</option><option value="newest">Recently updated</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" /></span></label>
          </div>
          <div className="mt-4 space-y-6">
            {grouped.map(({ key, label, Icon, rows }) => {
              const visible = group || expanded[key] ? rows : rows.slice(0, PREVIEW);
              return (
                <div key={key}>
                  <div className="flex items-center justify-between border-b border-line-soft pb-2"><h2 className="flex items-center gap-2 text-heading font-bold text-ink-strong"><Icon className="h-6 w-6 text-section-icon" aria-hidden="true" />{label} <span className="font-normal text-ink-muted">({rows.length})</span></h2>{!group && rows.length > PREVIEW && <button type="button" onClick={() => setGroup(key)} className="inline-flex items-center gap-1 text-sm font-semibold text-primary-ink hover:underline">View all {label.toLowerCase()} results<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>}</div>
                  <ul className="divide-y divide-line-soft">
                    {visible.map((row) => (
                      <li key={`${row.type}-${row.id}-${row.reference}`}>
                        <Link href={row.route_hint} className="grid gap-3 py-3 hover:bg-surface-hover sm:grid-cols-[3rem_minmax(0,1.3fr)_minmax(0,1fr)_7rem_1rem] sm:items-center">
                          {key === "PEOPLE" ? <Avatar name={row.title} size="lg" className="!h-12 !w-12" /> : <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-section-icon"><FileText className="h-6 w-6" aria-hidden="true" /></span>}
                          <span className="min-w-0"><span className="block truncate font-semibold text-primary-ink"><Highlight text={row.title} term={term} /></span><span className="block text-sm text-ink">{row.kind || row.subtitle} · {label}</span><span className="block truncate text-caption text-ink-muted">{(row.meta ?? []).join("  |  ")}</span></span>
                          <span className="hidden text-sm text-ink-muted sm:block">{row.snippet ? <>… <Highlight text={row.snippet} term={term} /> …</> : row.subtitle}</span>
                          <span className="text-caption text-ink-muted">Updated {formatDate(row.updated_at)}</span>
                          <ChevronRight className="hidden h-5 w-5 text-ink-muted sm:block" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {!group && rows.length > PREVIEW && <button type="button" onClick={() => setExpanded((current) => ({ ...current, [key]: !current[key] }))} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-surface-muted py-2 text-sm text-ink hover:bg-surface-hover">{expanded[key] ? "Show fewer" : `Show more ${label.toLowerCase()} results (${rows.length - PREVIEW})`}<ChevronDown className={cx("h-4 w-4 transition", expanded[key] && "rotate-180")} aria-hidden="true" /></button>}
                </div>
              );
            })}
            {term.length >= 2 && results && !results.length && !loading && (
              <div className="flex flex-col items-center py-12 text-center"><span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-ink-muted"><Search className="h-9 w-9" aria-hidden="true" /></span><p className="mt-3 text-heading font-bold text-headline">No results for “{term}”</p><p className="mt-1 max-w-sm text-support text-ink-muted">Check the spelling, try a reference number, or clear the filters.</p></div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
