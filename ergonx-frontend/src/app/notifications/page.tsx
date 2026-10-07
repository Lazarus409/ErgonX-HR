"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Bell,
  Briefcase,
  CalendarDays,
  CheckCheck,
  Clock3,
  FileBarChart,
  Landmark,
  ListChecks,
  Settings2,
  ShieldCheck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import AuthenticationGate from "@/components/guards/AuthenticationGate";
import AppShell from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Dialog } from "@/components/ui/Overlay";
import PageHeader from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import Tabs from "@/components/ui/Tabs";
import { getApiErrorMessage, notificationsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { formatDateTime, humanizeEnum } from "@/lib/format";
import { moduleAccents, type ModuleAccent } from "@/lib/moduleTheme";
import { useApiResource } from "@/lib/useApiResource";
import { NOTIFICATION_MODULE_LABELS, type AppNotification, type NotificationModule, type NotificationPreferences } from "@/types/notifications";

type View = "inbox" | "unread" | "archived";

const MODULES = Object.keys(NOTIFICATION_MODULE_LABELS) as NotificationModule[];

const moduleStyle: Record<NotificationModule, { accent: ModuleAccent; icon: LucideIcon }> = {
  APPROVALS: { accent: "brand", icon: ListChecks },
  HR: { accent: "hr", icon: Users },
  LEAVE: { accent: "leave", icon: CalendarDays },
  ATTENDANCE: { accent: "attendance", icon: Clock3 },
  PAYROLL: { accent: "payroll", icon: Wallet },
  RECRUITMENT: { accent: "recruitment", icon: Briefcase },
  ACCOUNTING: { accent: "accounting", icon: Landmark },
  REPORTS: { accent: "reports", icon: FileBarChart },
  SECURITY: { accent: "audit", icon: ShieldCheck },
  SYSTEM: { accent: "settings", icon: Bell },
};

function moduleOf(item: AppNotification): NotificationModule {
  return item.module && item.module in moduleStyle ? item.module : "SYSTEM";
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Presentation-only grouping of the (already ordered) list into Today / Yesterday / dated days. */
function groupByDay(items: AppNotification[]) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const groups: Array<{ key: string; label: string; date?: string; items: AppNotification[] }> = [];
  for (const item of items) {
    const created = new Date(item.created_at);
    const key = Number.isNaN(created.getTime()) ? "unknown" : dayKey(created);
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      const long = Number.isNaN(created.getTime()) ? "" : created.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      const label = key === dayKey(today) ? "Today" : key === dayKey(yesterday) ? "Yesterday" : long || "Earlier";
      group = { key, label, date: label === "Today" || label === "Yesterday" ? long : undefined, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Notification Center (Stitch S056): inbox, unread and archive views, bulk actions, detail panel, email preferences. */
export default function NotificationsPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("inbox");
  const [module, setModule] = useState<NotificationModule | "">("");
  const load = useCallback(
    () => notificationsApi.getNotifications({ unread: view === "unread", archived: view === "archived", module: module || undefined }),
    [view, module],
  );
  const { data, loading, error, reload } = useApiResource(load);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const items = useMemo(() => data ?? [], [data]);
  const active = items.find((item) => item.id === activeId) ?? null;
  const unread = items.filter((item) => !item.is_read).length;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setActionError(null);
    try { await action(); await reload(); }
    catch (caught) { setActionError(getApiErrorMessage(caught)); }
    finally { setBusy(false); }
  };
  const bulk = (action: "mark_read" | "archive" | "unarchive", ids: string[]) => run(async () => {
    await notificationsApi.bulkNotificationAction(ids, action);
    setSelected(new Set());
    if (action !== "mark_read") setActiveId(null);
  });
  const open = async (item: AppNotification) => {
    if (!item.route_hint) return;
    try { if (!item.is_read) await notificationsApi.markNotificationRead(item.id); router.push(item.route_hint); }
    catch (caught) { setActionError(getApiErrorMessage(caught)); }
  };
  const changeView = (next: View) => { setView(next); setSelected(new Set()); setActiveId(null); };
  const changeModule = (next: NotificationModule | "") => { setModule(next); setSelected(new Set()); setActiveId(null); };
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <AuthenticationGate>
      <AppShell>
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Notification center"
            description="Workflow, approval and system updates addressed to you in this institution."
            icon={Bell}
            accent="brand"
            actions={
              <div className="flex flex-wrap gap-2">
                {view !== "archived" && <Button variant="secondary" disabled={!unread || busy} leadingIcon={<CheckCheck className="h-4 w-4" />} onClick={() => void run(() => notificationsApi.markAllNotificationsRead())}>Mark all read</Button>}
                <Button variant="secondary" leadingIcon={<Settings2 className="h-4 w-4" />} onClick={() => setPreferencesOpen(true)}>Preferences</Button>
              </div>
            }
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-elevation-1" aria-label="Notifications">
              <div className="border-b border-line-soft px-4 pt-2">
                <Tabs
                  label="Notification views"
                  value={view}
                  onChange={(value) => changeView(value as View)}
                  items={[
                    { value: "inbox", label: "All notifications" },
                    { value: "unread", label: "Unread", count: view === "unread" ? items.length : undefined },
                    { value: "archived", label: "Archived" },
                  ]}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 border-b border-line-soft bg-surface-muted/40 px-4 py-2.5">
                <label className="inline-flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  <input type="checkbox" className="h-4 w-4" checked={allSelected} disabled={!items.length} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))} aria-label="Select all notifications" />
                  {selected.size} selected
                </label>
                {view === "archived" ? (
                  <Button size="sm" variant="ghost" disabled={!selected.size || busy} leadingIcon={<ArchiveRestore className="h-4 w-4" />} onClick={() => void bulk("unarchive", [...selected])}>Restore</Button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" disabled={!selected.size || busy} leadingIcon={<CheckCheck className="h-4 w-4" />} onClick={() => void bulk("mark_read", [...selected])}>Mark as read</Button>
                    <Button size="sm" variant="ghost" disabled={!selected.size || busy} leadingIcon={<Archive className="h-4 w-4" />} onClick={() => void bulk("archive", [...selected])}>Archive</Button>
                  </>
                )}
                <label className="ml-auto inline-flex items-center gap-2 text-support text-ink-muted">
                  Module
                  <select value={module} onChange={(event) => changeModule(event.target.value as NotificationModule | "")} className="h-8 rounded-lg border border-line-strong bg-surface px-2 text-support text-ink-strong">
                    <option value="">All modules</option>
                    {MODULES.map((code) => <option key={code} value={code}>{NOTIFICATION_MODULE_LABELS[code]}</option>)}
                  </select>
                </label>
              </div>

              {(error || actionError) && <div className="p-4"><ErrorState variant="inline" title="Unable to update notifications" message={error ?? actionError ?? ""} onRetry={reload} /></div>}
              {loading && <div className="space-y-3 p-4" aria-label="Loading notifications">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 rounded-xl" />)}</div>}
              {!loading && !error && items.length === 0 && (
                <div className="p-6">
                  <EmptyState
                    icon={view === "archived" ? Archive : CheckCheck}
                    accent="leave"
                    title={view === "archived" ? "Nothing archived" : view === "unread" ? "No unread notifications" : "You are all caught up"}
                    description={view === "archived" ? "Notifications you archive are kept here." : "New workflow and approval updates will appear here."}
                  />
                </div>
              )}
              {!loading && items.length > 0 && groupByDay(items).map((group) => (
                <div key={group.key}>
                  <h2 className="flex items-baseline justify-between gap-2 px-5 pb-1.5 pt-4"><span className="font-semibold text-ink-strong">{group.label}</span>{group.date && <span className="text-caption uppercase tracking-[0.06em] text-ink-muted">{group.date}</span>}</h2>
                  <ul className="space-y-2 px-3 pb-3">
                    {group.items.map((item) => {
                      const code = moduleOf(item);
                      const { accent, icon: Icon } = moduleStyle[code];
                      const isActive = item.id === activeId;
                      return (
                        <li key={item.id} className={cx("flex items-center gap-3 rounded-xl border bg-surface px-3 py-3 transition-colors sm:gap-4", isActive ? "border-primary ring-2 ring-primary/15" : "border-line-soft hover:bg-surface-hover")}>
                          <input type="checkbox" className="h-4 w-4 shrink-0" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Select ${item.title}`} />
                          <span className={cx("h-2 w-2 shrink-0 rounded-full", item.is_read ? "bg-transparent" : "bg-primary")} aria-label={item.is_read ? "Read" : "Unread"} />
                          <span className={cx("hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg sm:flex", moduleAccents[accent].tile)} aria-hidden="true"><Icon className="h-5 w-5" /></span>
                          <button type="button" onClick={() => setActiveId(item.id)} className="min-w-0 flex-1 text-left" aria-pressed={isActive}>
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={cx("text-ink-strong", item.is_read ? "font-medium" : "font-semibold")}>{item.title}</span>
                              <Badge size="sm" tone="neutral">{NOTIFICATION_MODULE_LABELS[code]}</Badge>
                            </span>
                            <span className="mt-0.5 block truncate text-support text-ink-muted">{item.message}</span>
                          </button>
                          <time className="hidden shrink-0 text-caption text-ink-muted sm:block" dateTime={item.created_at} title={formatDateTime(item.created_at)}>{formatTime(item.created_at)}</time>
                          <button type="button" onClick={() => void open(item)} disabled={!item.route_hint} className={cx("rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-primary", !item.route_hint && "invisible")} aria-label={`Open ${item.title}`}><ArrowRight className="h-4 w-4" /></button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>

            <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Notification detail">
              {active ? (
                <NotificationDetail
                  item={active}
                  busy={busy}
                  onClose={() => setActiveId(null)}
                  onOpen={() => void open(active)}
                  onMarkRead={() => void bulk("mark_read", [active.id])}
                  onArchive={() => void bulk(active.is_archived ? "unarchive" : "archive", [active.id])}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-line-strong p-6 text-center text-support text-ink-muted">Select a notification to see its details.</div>
              )}
            </aside>
          </div>
        </div>
        {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
      </AppShell>
    </AuthenticationGate>
  );
}

function NotificationDetail({ item, busy, onClose, onOpen, onMarkRead, onArchive }: { item: AppNotification; busy: boolean; onClose: () => void; onOpen: () => void; onMarkRead: () => void; onArchive: () => void }) {
  const code = moduleOf(item);
  const { accent, icon: Icon } = moduleStyle[code];
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cx("flex h-10 w-10 items-center justify-center rounded-lg", moduleAccents[accent].tile)} aria-hidden="true"><Icon className="h-5 w-5" /></span>
          <Badge size="sm" tone="neutral">{NOTIFICATION_MODULE_LABELS[code]}</Badge>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-muted" aria-label="Close detail"><X className="h-4 w-4" /></button>
      </div>
      <h2 className="mt-4 text-section-title font-semibold text-ink-strong">{item.title}</h2>
      <p className="mt-2 text-support text-ink-muted">{item.message}</p>
      <p className="mt-3 flex items-center justify-between border-t border-line-soft pt-3 text-caption text-ink-muted">
        <time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time>
        <span className={item.is_read ? "" : "font-semibold text-primary"}>{item.is_archived ? "Archived" : item.is_read ? "Read" : "Unread"}</span>
      </p>
      <dl className="mt-4 space-y-2 rounded-lg bg-surface-muted/60 p-3 text-support">
        <div className="flex justify-between gap-3"><dt className="text-ink-muted">Event</dt><dd className="text-right text-ink-strong">{humanizeEnum(item.notification_type)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-ink-muted">Module</dt><dd className="text-ink-strong">{NOTIFICATION_MODULE_LABELS[code]}</dd></div>
        {item.read_at && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Read</dt><dd className="text-ink-strong">{formatDateTime(item.read_at)}</dd></div>}
      </dl>
      <p className="mt-3 text-caption text-ink-muted">Opening the related record checks your access again; you see only what your role allows.</p>
      <div className="mt-4 grid gap-2">
        {item.route_hint && <Button onClick={onOpen} leadingIcon={<ArrowRight className="h-4 w-4" />}>Open related record</Button>}
        {!item.is_read && <Button variant="secondary" disabled={busy} onClick={onMarkRead} leadingIcon={<CheckCheck className="h-4 w-4" />}>Mark as read</Button>}
        <Button variant="ghost" disabled={busy} onClick={onArchive} leadingIcon={item.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}>{item.is_archived ? "Restore to inbox" : "Archive"}</Button>
      </div>
    </section>
  );
}

/** Mounted only while open, so every opening starts from the saved preferences. */
function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [chosen, setChosen] = useState<Set<NotificationModule>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    notificationsApi.getNotificationPreferences()
      .then((value) => { setPreferences(value); setChosen(new Set(value.email_modules)); })
      .catch((caught) => setError(getApiErrorMessage(caught)));
  }, []);

  const save = async () => {
    setSaving(true); setError(null);
    try { await notificationsApi.saveNotificationPreferences(MODULES.filter((code) => chosen.has(code))); onClose(); }
    catch (caught) { setError(getApiErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  const emailOff = preferences !== null && !preferences.email_available;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Notification preferences"
      description="Every notification appears here in ErgonX. Choose which modules also send you a copy by email."
      size="md"
      footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} loadingLabel="Saving…" disabled={!preferences || emailOff} onClick={() => void save()}>Save preferences</Button></div>}
    >
      {error && <ErrorState variant="inline" title="Preferences unavailable" message={error} />}
      {emailOff && <p className="mb-3 rounded-lg bg-warning-soft p-3 text-support text-warning-ink">Email copies are turned off for this institution, or email delivery is not configured. In-app notifications still arrive.</p>}
      {!preferences && !error && <Skeleton className="h-40 rounded-xl" />}
      {preferences && (
        <fieldset disabled={emailOff} className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Email copies by module</legend>
          {MODULES.map((code) => (
            <label key={code} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-support">
              <input type="checkbox" className="h-4 w-4" checked={chosen.has(code)} onChange={() => setChosen((current) => { const next = new Set(current); if (next.has(code)) next.delete(code); else next.add(code); return next; })} />
              <span className="font-medium text-ink-strong">{NOTIFICATION_MODULE_LABELS[code]}</span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
