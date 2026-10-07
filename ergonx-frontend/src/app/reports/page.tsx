"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  Briefcase,
  Building2,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Filter,
  FolderCog,
  Landmark,
  LayoutGrid,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/guards/AuthProvider";
import CreateLibraryItemDialog from "@/components/reports/CreateLibraryItemDialog";
import LibraryDetail, { FreshnessDot, KindIcon, PersonChip } from "@/components/reports/LibraryDetail";
import { Button } from "@/components/ui/Button";
import EmptyState, { NoResultsState } from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Input, Select } from "@/components/ui/Field";
import { Drawer, Menu, MenuItem } from "@/components/ui/Overlay";
import StatusBadge from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/ToastProvider";
import { getApiErrorMessage, reportLibraryApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import type { LibraryCategory, LibraryEntry, LibraryKind } from "@/types/reportLibrary";

type Section = "all" | `DASHBOARD:${"mine" | "shared" | "institution"}` | `REPORT:${"mine" | "shared" | "institution" | "scheduled"}` | `CATEGORY:${LibraryCategory}`;
type Sort = "refreshed" | "name" | "module" | "created";

const CATEGORY_ICONS: Record<LibraryCategory, LucideIcon> = { FINANCE: Landmark, HR: Users, RECRUITMENT: Briefcase, OPERATIONS: Building2, CUSTOM: FolderCog };
const CATEGORY_LABELS: Record<LibraryCategory, string> = { FINANCE: "Finance", HR: "HR", RECRUITMENT: "Recruitment", OPERATIONS: "Operations", CUSTOM: "Custom" };

function sectionOf(entry: LibraryEntry, userId?: string): "mine" | "shared" | "institution" {
  if (entry.owner && entry.owner.id === userId) return "mine";
  if (entry.shared_with_me) return "shared";
  return "institution";
}

/** The detail panel sits beside the table on very wide screens and opens as a drawer otherwise. */
function useWideScreen() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1800px)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

function RailItem({ icon: Icon, label, count, active, onClick }: { icon: LucideIcon; label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={active ? "true" : undefined} className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-support transition-colors", active ? "bg-primary-soft font-semibold text-primary-ink" : "text-ink hover:bg-surface-hover")}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cx("rounded-full px-2 text-caption font-semibold tabular-nums", active ? "bg-primary text-white" : "bg-surface-muted text-ink-muted")}>{count}</span>
      </button>
    </li>
  );
}

function RailGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-line-soft pt-3">
      <div className="mb-1 flex items-center justify-between px-3"><p className="text-caption font-bold uppercase tracking-wide text-ink-muted">{title}</p>{action}</div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

/**
 * Concept "Reports and analytics": the catalogue of dashboards and reports the
 * member may open, with ownership, sharing, freshness and publication status.
 */
export default function ReportsLibraryPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const loadList = useCallback(() => reportLibraryApi.listLibrary(), []);
  const { data, loading, error, reload, setData } = useApiResource(loadList);
  const loadOptions = useCallback(() => reportLibraryApi.getLibraryOptions(), []);
  const { data: options } = useApiResource(loadOptions);
  const [section, setSection] = useState<Section>("all");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"" | LibraryKind>("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<Sort>("refreshed");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<LibraryKind | null>(null);
  const entries = useMemo(() => data?.results ?? [], [data]);
  const userId = user?.id;
  const wide = useWideScreen();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = entries.filter((entry) => {
      if (section.startsWith("DASHBOARD:") || section.startsWith("REPORT:")) {
        const [kind, part] = section.split(":");
        if (entry.kind !== kind) return false;
        if (part === "scheduled") { if (entry.schedule === "NONE") return false; } else if (sectionOf(entry, userId) !== part) return false;
      }
      if (section.startsWith("CATEGORY:") && entry.category !== section.slice(9)) return false;
      if (kindFilter && entry.kind !== kindFilter) return false;
      if (statusFilter && entry.status !== statusFilter) return false;
      return !needle || [entry.name, entry.description, entry.module_label, entry.owner?.name ?? "", entry.code].some((value) => value.toLowerCase().includes(needle));
    });
    const time = (value: string | null) => (value ? new Date(value).getTime() : 0);
    return [...rows].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "module" ? a.module_label.localeCompare(b.module_label) || a.name.localeCompare(b.name) : sort === "created" ? time(b.created_at) - time(a.created_at) : time(b.last_refreshed_at) - time(a.last_refreshed_at) || a.name.localeCompare(b.name));
  }, [entries, section, kindFilter, statusFilter, query, sort, userId]);

  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const counts = data?.counts;
  const replace = (entry: LibraryEntry) => setData((current) => current ? { ...current, results: current.results.map((item) => (item.id === entry.id && item.origin === entry.origin ? entry : item)) } : current);
  const add = (entry: LibraryEntry) => { void reload(); setSelectedId(entry.id); showToast({ tone: "success", message: `${entry.name} saved.` }); };
  const openEntry = (entry: LibraryEntry) => {
    if (entry.origin === "library") void reportLibraryApi.refreshLibraryItem(entry.id).catch(() => undefined);
    router.push(entry.href);
  };
  const quick = async (entry: LibraryEntry, run: () => Promise<LibraryEntry>, message: string, isNew = false) => {
    try { const result = await run(); if (isNew) add(result); else { replace(result); showToast({ tone: "success", message }); } } catch (caught) { showToast({ tone: "error", message: getApiErrorMessage(caught) }); }
  };
  const clear = () => { setQuery(""); setKindFilter(""); setStatusFilter(""); setSection("all"); };
  const detail = selected && <LibraryDetail key={`${selected.origin}-${selected.id}`} embedded={!wide} entry={selected} options={options} onClose={() => setSelectedId(null)} onChanged={replace} onDuplicated={add} />;
  // Beside the panel the table drops the owner and refresh columns, which the panel shows.
  const compact = wide && Boolean(selected);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">Reports &amp; Analytics</h1>
          <p className="mt-1 text-[1.0625rem] text-heading-support">Discover insights. Make informed decisions.</p>
        </div>
        <Button size="lg" leadingIcon={<Plus className="h-5 w-5" />} onClick={() => setCreating("REPORT")} disabled={!options?.sources.length}>Create report</Button>
      </header>

      {error && <ErrorState variant="inline" title="Unable to load reports and dashboards" message={error} onRetry={reload} />}

      <div className={cx("grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]", selected && wide && "lg:grid-cols-[17rem_minmax(0,1fr)_25rem]")}>
        <nav aria-label="Library sections" className="h-fit rounded-2xl border border-line bg-surface p-2 shadow-elevation-1 lg:sticky lg:top-24">
          <ul className="mb-3"><RailItem icon={LayoutGrid} label="All dashboards & reports" count={counts?.all ?? 0} active={section === "all"} onClick={() => setSection("all")} /></ul>
          <div className="space-y-3">
            <RailGroup title="Dashboards" action={options?.sources.some((source) => source.kind === "DASHBOARD") && <button type="button" aria-label="Save a dashboard" onClick={() => setCreating("DASHBOARD")} className="rounded p-1 text-primary hover:bg-primary-soft"><Plus className="h-4 w-4" /></button>}>
              <RailItem icon={Settings2} label="My dashboards" count={counts?.dashboards.mine ?? 0} active={section === "DASHBOARD:mine"} onClick={() => setSection("DASHBOARD:mine")} />
              <RailItem icon={Users} label="Shared with me" count={counts?.dashboards.shared ?? 0} active={section === "DASHBOARD:shared"} onClick={() => setSection("DASHBOARD:shared")} />
              <RailItem icon={Building2} label="Institution dashboards" count={counts?.dashboards.institution ?? 0} active={section === "DASHBOARD:institution"} onClick={() => setSection("DASHBOARD:institution")} />
            </RailGroup>
            <RailGroup title="Saved reports" action={options?.sources.some((source) => source.kind === "REPORT") && <button type="button" aria-label="Save a report" onClick={() => setCreating("REPORT")} className="rounded p-1 text-primary hover:bg-primary-soft"><Plus className="h-4 w-4" /></button>}>
              <RailItem icon={FileText} label="My reports" count={counts?.reports.mine ?? 0} active={section === "REPORT:mine"} onClick={() => setSection("REPORT:mine")} />
              <RailItem icon={Users} label="Shared with me" count={counts?.reports.shared ?? 0} active={section === "REPORT:shared"} onClick={() => setSection("REPORT:shared")} />
              <RailItem icon={Building2} label="Institution reports" count={counts?.reports.institution ?? 0} active={section === "REPORT:institution"} onClick={() => setSection("REPORT:institution")} />
              <RailItem icon={Clock3} label="Scheduled reports" count={counts?.reports.scheduled ?? 0} active={section === "REPORT:scheduled"} onClick={() => setSection("REPORT:scheduled")} />
            </RailGroup>
            <RailGroup title="Categories">
              {(Object.keys(CATEGORY_LABELS) as LibraryCategory[]).map((category) => (
                <RailItem key={category} icon={CATEGORY_ICONS[category]} label={CATEGORY_LABELS[category]} count={counts?.categories[category] ?? 0} active={section === `CATEGORY:${category}`} onClick={() => setSection(`CATEGORY:${category}`)} />
              ))}
            </RailGroup>
          </div>
        </nav>

        <section aria-label="Dashboards and reports" className="min-w-0 rounded-2xl border border-line bg-surface shadow-elevation-1">
          <div className="flex flex-col gap-2 border-b border-line-soft p-3 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search dashboards and reports</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search dashboards and reports…" className="pl-9" />
            </label>
            <Button variant="secondary" leadingIcon={<Filter className="h-4 w-4" />} aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)}>Filter{kindFilter || statusFilter ? " (on)" : ""}</Button>
            <label className="relative">
              <span className="sr-only">Sort by</span>
              <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <Select value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="pl-9">
                <option value="refreshed">Last refreshed</option><option value="name">Name</option><option value="module">Module</option><option value="created">Newest</option>
              </Select>
            </label>
          </div>
          {showFilters && (
            <div className="flex flex-wrap gap-2 border-b border-line-soft bg-surface-muted/50 p-3">
              <Select aria-label="Type" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as "" | LibraryKind)} className="w-44"><option value="">All types</option><option value="DASHBOARD">Dashboards</option><option value="REPORT">Reports</option></Select>
              <Select aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-44"><option value="">Any status</option><option value="PUBLISHED">Published</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></Select>
              {(kindFilter || statusFilter) && <Button variant="ghost" onClick={() => { setKindFilter(""); setStatusFilter(""); }}>Clear filters</Button>}
            </div>
          )}

          {loading && !data ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((index) => <div key={index} className="skeleton h-14 rounded-lg" />)}</div>
          ) : !entries.length ? (
            <EmptyState className="m-4 border-0" icon={FileText} title="No reports or dashboards yet" description="Create your first report to start exploring your data." action={options?.sources.length ? <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating("REPORT")}>Create report</Button> : undefined} />
          ) : !visible.length ? (
            <NoResultsState className="m-4 border-0" noun="dashboards or reports" query={query || undefined} onClear={clear} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className={cx("w-full text-sm", compact ? "min-w-[34rem]" : "min-w-[760px]")}>
                  <caption className="sr-only">Dashboards and reports</caption>
                  <thead>
                    <tr className="border-b border-line-soft text-left text-caption font-semibold text-ink-muted">
                      <th scope="col" className="px-4 py-2.5">Name</th><th scope="col" className="px-3 py-2.5">Module</th>{!compact && <><th scope="col" className="px-3 py-2.5">Owner</th><th scope="col" className="px-3 py-2.5">Last refresh</th></>}<th scope="col" className="px-3 py-2.5">Data freshness</th><th scope="col" className="px-3 py-2.5">Status</th><th scope="col" className="px-2 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((entry) => {
                      const active = selected?.id === entry.id && selected.origin === entry.origin;
                      return (
                        <tr key={`${entry.origin}-${entry.id}`} className={cx("cursor-pointer border-b border-line-soft last:border-0", active ? "bg-primary-soft/50" : "hover:bg-surface-hover")} onClick={() => setSelectedId(entry.id)}>
                          <td className="px-4 py-3">
                            <button type="button" className="flex items-center gap-3 text-left" onClick={(event) => { event.stopPropagation(); setSelectedId(entry.id); }} aria-pressed={active}>
                              <KindIcon entry={entry} />
                              <span className="min-w-0"><span className="block font-semibold text-ink-strong">{entry.name}</span><span className="block text-caption text-ink-muted">{entry.kind === "DASHBOARD" ? "Dashboard" : "Report"}{entry.shared_with_me ? " · shared with you" : ""}</span></span>
                            </button>
                          </td>
                          <td className="px-3 py-3 text-ink">{entry.module_label}</td>
                          {!compact && <td className="max-w-[10rem] px-3 py-3 text-ink"><PersonChip person={entry.owner} /></td>}
                          {!compact && <td className="whitespace-nowrap px-3 py-3 text-ink">{entry.last_refreshed_at ? formatDateTime(entry.last_refreshed_at) : "Never"}</td>}
                          <td className="px-3 py-3 text-ink"><FreshnessDot entry={entry} /></td>
                          <td className="px-3 py-3"><StatusBadge status={entry.status} size="sm" /></td>
                          <td className="px-2 py-3" onClick={(event) => event.stopPropagation()}>
                            <Menu label={`Actions for ${entry.name}`} trigger={(props) => <button {...props} type="button" aria-label={`Actions for ${entry.name}`} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover hover:text-ink-strong"><MoreVertical className="h-4 w-4" /></button>}>
                              <MenuItem icon={<ExternalLink className="h-4 w-4" />} onSelect={() => openEntry(entry)}>Open</MenuItem>
                              {entry.origin === "library" && <MenuItem icon={<RefreshCw className="h-4 w-4" />} onSelect={() => void quick(entry, () => reportLibraryApi.refreshLibraryItem(entry.id), `${entry.name} refreshed.`)}>Refresh</MenuItem>}
                              {entry.origin === "library" && <MenuItem icon={<Copy className="h-4 w-4" />} onSelect={() => void quick(entry, () => reportLibraryApi.duplicateLibraryItem(entry.id), "", true)}>Duplicate</MenuItem>}
                            </Menu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line-soft md:hidden">
                {visible.map((entry) => (
                  <li key={`${entry.origin}-${entry.id}`}>
                    <button type="button" onClick={() => setSelectedId(entry.id)} className="flex w-full items-start gap-3 p-4 text-left hover:bg-surface-hover">
                      <KindIcon entry={entry} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2"><span className="font-semibold text-ink-strong">{entry.name}</span><StatusBadge status={entry.status} size="sm" /></span>
                        <span className="mt-0.5 block text-caption text-ink-muted">{entry.module_label} · {entry.owner?.name ?? "ErgonX"}</span>
                        <span className="mt-1 block text-caption text-ink"><FreshnessDot entry={entry} /></span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {wide && detail}
      </div>

      {!wide && (
        <Drawer open={Boolean(selected)} onClose={() => setSelectedId(null)} title={selected?.kind === "DASHBOARD" ? "Dashboard details" : "Report details"} width="md">
          {detail}
        </Drawer>
      )}

      {creating && <CreateLibraryItemDialog key={creating} open initialKind={creating} onClose={() => setCreating(null)} options={options} onCreated={add} />}
    </div>
  );
}
