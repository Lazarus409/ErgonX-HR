"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Building2,
  CheckCheck,
  ChevronDown,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserRound,
  X,
  Eye,
} from "lucide-react";

import { getApiErrorMessage, institutionsApi, notificationsApi, searchApi } from "@/lib/api";
import type { AppNotification } from "@/types/notifications";
import type { SearchResult } from "@/types/search";
import type { InstitutionMembership } from "@/types/institutions";
import { useAuth } from "@/components/guards/AuthProvider";
import { useTheme, type ThemePreference } from "@/components/context/ThemeProvider";
import { navigation, selfServiceNavigation } from "@/components/navigation/navigation";
import { Avatar } from "@/components/ui/Card";
import { cx } from "@/lib/cx";
import { accentForPath, moduleAccents } from "@/lib/moduleTheme";
import { formatDateTime } from "@/lib/format";
import { imageContentUrl } from "@/lib/api/images";

interface TopBarProps {
  onOpenSidebar?: () => void;
}

/** Settings sub-pages that are not in the primary navigation. */
const settingsPageLabels: Array<[string, string]> = [
  ["/settings/roles", "Roles & Permissions"],
  ["/settings/modules", "Modules"],
  ["/settings/institution", "Institution Settings"],
  ["/settings/approval-workflows", "Approval Workflows"],
  ["/settings/audit", "Audit Log"],
  ["/settings/security", "Security"],
  ["/settings/profile", "Personal Preferences"],
];

/** Resolves the most specific navigation label for the current route. */
function routeContext(pathname: string): { section: string; page?: string } {
  {
    const matches = (href: string) => (href === "/" || href === "/dashboard" || href === "/me" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
    const rootOf = (href: string) => `/${href.split("/")[1] ?? ""}`;
    const settingsPage = settingsPageLabels.find(([href]) => pathname === href || pathname.startsWith(`${href}/`));
    if (settingsPage) return { section: "Settings", page: settingsPage[1] };
    // A module's own menu wins over another menu linking into it (the
    // Department menu's "Team leave calendar" must not claim every /leave page).
    const home = navigation.find((item) => item.children?.length && rootOf(item.href) === rootOf(pathname));
    if (home) {
      const child = [...(home.children ?? [])].filter((candidate) => matches(candidate.href)).sort((a, b) => b.href.length - a.href.length)[0];
      if (child) return { section: home.label, page: child.label };
      if (matches(home.href)) return { section: home.label };
    }
    for (const item of navigation) {
      for (const child of item.children ?? []) {
        // A child owns its exact route tree, or — when it lives in a different
        // module root than its parent (e.g. HR › Leave) — that whole root.
        const foreignRoot = rootOf(child.href) !== rootOf(item.href) ? rootOf(child.href) : null;
        if (matches(child.href) || (foreignRoot && matches(foreignRoot))) return { section: item.label, page: child.label };
      }
      if (matches(item.href)) return { section: item.label };
    }
    for (const item of selfServiceNavigation) if (matches(item.href)) return { section: "My workspace", page: item.label };
    if (pathname.startsWith("/notifications")) return { section: "Notifications" };
    if (pathname.startsWith("/approvals")) return { section: "Approvals" };
    if (pathname.startsWith("/documents")) return { section: "Documents" };
    if (pathname.startsWith("/operations")) return { section: "Operations" };
    if (pathname.startsWith("/records/")) return { section: "Home", page: "Record history" };
    if (pathname.startsWith("/search")) return { section: "Home", page: "Search" };
    if (pathname.startsWith("/design/states")) return { section: "Home", page: "Empty, Error and Loading States" };
    return { section: "Workspace" };
  }
}

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export default function TopBar({ onOpenSidebar }: TopBarProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const { institution, logout, switchInstitution, user } = useAuth();
  const { theme, preference, setTheme, toggleTheme } = useTheme();
  const context = routeContext(pathname);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<InstitutionMembership[]>([]);
  const [switchingInstitutionId, setSwitchingInstitutionId] = useState<string | null>(null);
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "ErgonX user";

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
  };

  const openSearch = () => {
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const navigateFromProfile = (path: string) => {
    setProfileOpen(false);
    router.push(path);
  };

  const handleSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    setProfileOpen(false);
    logout();
    router.replace("/login");
  };

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || query.length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      setSearchError(null);
      searchApi.universalSearch({ query })
        .then((response) => { if (active) setSearchResults(response.results); })
        .catch((caught) => {
          if (active) {
            setSearchResults([]);
            setSearchError(getApiErrorMessage(caught));
          }
        })
        .finally(() => { if (active) setSearchLoading(false); });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchQuery]);

  // Unread badge is available before the popover is first opened.
  useEffect(() => {
    let active = true;
    notificationsApi.getNotifications({ unread: true })
      .then((items) => { if (active) setUnreadNotificationCount(items.length); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [institution?.id]);

  useEffect(() => {
    if (!notificationsOpen) return;
    let active = true;
    notificationsApi.getNotifications({ unread: true })
      .then((items) => {
        if (!active) return;
        setNotifications(items.slice(0, 5));
        setUnreadNotificationCount(items.length);
      })
      .catch((caught) => { if (active) setNotificationsError(getApiErrorMessage(caught)); })
      .finally(() => { if (active) setNotificationsLoading(false); });
    return () => { active = false; };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    let active = true;
    institutionsApi.getMyMemberships()
      .then((items) => { if (active) setMemberships(items.filter((item) => item.status === "ACTIVE")); })
      .catch(() => { if (active) setMemberships([]); });
    return () => { active = false; };
  }, [profileOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (event.key === "Escape") {
        closeSearch();
        setProfileOpen(false);
        setNotificationsOpen(false);
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-topbar-popover]")) {
        setProfileOpen(false);
        setNotificationsOpen(false);
      }
      if (!target.closest("[data-search-popover], [data-search-trigger]")) closeSearch();
    };
    document.addEventListener("click", closeMenus);
    return () => document.removeEventListener("click", closeMenus);
  }, []);

  const markNotificationRead = async (notification: AppNotification) => {
    if (notification.is_read) return;
    try {
      const updated = await notificationsApi.markNotificationRead(notification.id);
      setNotifications((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setUnreadNotificationCount((current) => Math.max(0, current - 1));
      window.dispatchEvent(new CustomEvent("ergonx:toast", { detail: { title: "Notification updated", message: "Notification marked as read.", tone: "success" } }));
    } catch (caught) {
      setNotificationsError(getApiErrorMessage(caught));
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await notificationsApi.markAllNotificationsRead();
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true, status: "READ" })));
      setUnreadNotificationCount(0);
    } catch (caught) {
      setNotificationsError(getApiErrorMessage(caught));
    }
  };

  const iconButton = "relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink-strong";
  const pageTitle = context.page ?? context.section;
  const crumb = context.page ? context.section : "Home";

  return (
    <header data-shell-chrome className="sticky top-0 z-30 h-[var(--shell-topbar)] border-b border-line-soft bg-surface/95 shadow-[0_2px_12px_-6px_rgb(15_35_69/0.12)] backdrop-blur-xl supports-[backdrop-filter]:bg-surface/85">
      <div className="relative flex h-full items-center gap-2 px-4 sm:gap-3 sm:px-6 xl:px-8">
        <button type="button" onClick={onOpenSidebar} className={cx(iconButton, "lg:hidden")} aria-label="Open navigation">
          <Menu className="h-[18px] w-[18px]" />
        </button>

        {/* Context identity: tenant + current area */}
        <div className="min-w-0 shrink leading-tight lg:w-56 xl:w-72">
          <p className="truncate text-caption font-medium text-primary-ink" title={institution?.name ?? undefined}>{crumb}</p>
          <p className="truncate text-[1.375rem] font-bold leading-7 tracking-tight text-headline">{pageTitle}</p>
        </div>

        <div className="flex flex-1 justify-center">

        {/* Universal search trigger */}
        <button
          type="button"
          data-search-trigger
          onClick={(event) => { event.stopPropagation(); openSearch(); }}
          className="hidden h-11 w-full max-w-sm items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left text-sm text-ink-subtle shadow-elevation-1 transition-colors hover:border-primary/50 md:flex xl:max-w-md"
          aria-label="Search (Ctrl+K)"
        >
          <Search className="h-[18px] w-[18px] shrink-0 text-ink-strong" aria-hidden="true" />
          <span className="flex-1 truncate">Search</span>
          <kbd className="rounded-md border border-line bg-surface-muted px-1.5 py-0.5 font-sans text-[0.6875rem] font-semibold text-ink-muted">Ctrl K</kbd>
        </button>
        </div>
        <button type="button" data-search-trigger onClick={(event) => { event.stopPropagation(); openSearch(); }} className={cx(iconButton, "md:hidden")} aria-label="Search">
          <Search className="h-[18px] w-[18px]" />
        </button>

        {user?.readOnly && (
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-muted px-2.5 py-1 text-caption font-semibold text-ink-muted sm:inline-flex" title="Your role can view records but not create, change or approve them.">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />Read-only access
          </span>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          className={cx("hidden sm:inline-flex", iconButton, theme === "dark" && "bg-surface-hover text-ink-strong")}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          <Moon className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* Notifications */}
        <div className="relative" data-topbar-popover onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              const opening = !notificationsOpen;
              if (opening) {
                setNotificationsLoading(true);
                setNotificationsError(null);
              }
              setNotificationsOpen(opening);
              setProfileOpen(false);
            }}
            className={cx("relative inline-flex h-12 min-w-10 flex-col items-center justify-center rounded-lg px-2 text-ink-strong transition-colors duration-150 hover:bg-surface-hover", notificationsOpen && "bg-surface-hover")}
            title="Notifications"
            aria-label={unreadNotificationCount ? `Notifications, ${unreadNotificationCount} unread` : "Notifications"}
            aria-expanded={notificationsOpen}
            aria-haspopup="dialog"
          >
            <Bell className="h-5 w-5" />
            <span className="hidden text-caption font-medium text-primary-ink xl:block">Notifications</span>
            {unreadNotificationCount > 0 && (
              <span className="absolute right-1.5 top-1 flex h-4 min-w-4 xl:right-6 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-surface">
                {unreadNotificationCount > 9 ? "9+" : unreadNotificationCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div role="dialog" aria-label="Notifications" className="absolute right-0 top-14 w-[min(calc(100vw-2rem),22rem)] origin-top-right animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay">
              <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3.5">
                <div>
                  <p className="text-sm font-semibold text-ink-strong">Notifications</p>
                  <p className="text-caption text-ink-muted">Updates for your active institution</p>
                </div>
                <span className="rounded-full bg-primary-soft px-2 py-0.5 text-caption font-bold text-primary-ink tabular-nums">{unreadNotificationCount} new</span>
              </div>

              <div className="max-h-[22rem] divide-y divide-line-soft overflow-y-auto">
                {notificationsLoading && (
                  <div className="space-y-3 p-4" role="status" aria-label="Loading notifications">
                    {[0, 1, 2].map((index) => <div key={index} className="space-y-1.5"><span className="skeleton block h-3.5 w-3/5 rounded" /><span className="skeleton block h-3 w-4/5 rounded" /></div>)}
                  </div>
                )}
                {notificationsError && <p className="p-4 text-support text-danger-ink" role="alert">{notificationsError}</p>}
                {!notificationsLoading && !notificationsError && notifications.length === 0 && (
                  <div className="flex flex-col items-center px-4 py-8 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-success-soft text-success"><CheckCheck className="h-5 w-5" aria-hidden="true" /></span>
                    <p className="mt-3 text-sm font-semibold text-ink-strong">You&apos;re all caught up</p>
                    <p className="mt-0.5 text-caption text-ink-muted">New updates will appear here.</p>
                  </div>
                )}
                {!notificationsLoading && !notificationsError && notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={async () => {
                      await markNotificationRead(notification);
                      if (notification.route_hint) {
                        setNotificationsOpen(false);
                        router.push(notification.route_hint);
                      }
                    }}
                    className={cx("block w-full px-4 py-3 text-left transition-colors hover:bg-surface-hover", !notification.is_read && "bg-primary-soft/40")}
                    aria-label={`Open ${notification.title}`}
                  >
                    <span className="flex items-start gap-3">
                      <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", notification.is_read ? "bg-line-strong" : "bg-primary")} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-strong">{notification.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-support text-ink-muted">{notification.message}</span>
                        {notification.created_at && <span className="mt-1 block text-caption text-ink-subtle">{formatDateTime(notification.created_at)}</span>}
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-line-soft px-4 py-2.5 text-support">
                <button type="button" onClick={markAllNotificationsRead} disabled={!unreadNotificationCount} className="font-semibold text-primary-ink hover:underline disabled:text-ink-subtle disabled:no-underline">Mark all read</button>
                <button type="button" onClick={() => { setNotificationsOpen(false); router.push("/notifications"); }} className="inline-flex items-center gap-1 font-semibold text-primary-ink hover:underline">View all<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </div>
            </div>
          )}
        </div>

        {/* Profile */}
        <div className="relative" data-topbar-popover onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            onClick={() => {
              setProfileOpen((current) => !current);
              setNotificationsOpen(false);
            }}
            className={cx("flex items-center gap-3 rounded-xl p-1 pr-1.5 transition-colors hover:bg-surface-hover xl:pr-2.5", profileOpen && "bg-surface-hover")}
            aria-label="Open profile menu"
            aria-haspopup="menu"
            aria-expanded={profileOpen}
          >
            <Avatar name={fullName} src={user?.profileImageId ? imageContentUrl(user.profileImageId) : null} size="md" solid />
            <span className="hidden min-w-0 text-left leading-tight xl:block">
              <span className="block max-w-40 truncate text-sm font-bold text-ink-strong">{fullName}</span>
              <span className="block max-w-40 truncate text-caption text-heading-support">{user?.role ? user.role.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : ""}</span>
            </span>
            <ChevronDown className={cx("hidden h-4 w-4 text-ink-subtle transition-transform xl:block", profileOpen && "rotate-180")} aria-hidden="true" />
          </button>

          {profileOpen && (
            <div role="menu" aria-label="Profile menu" className="absolute right-0 top-14 z-50 w-[min(calc(100vw-2rem),20rem)] origin-top-right animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay">
              <div className="flex items-center gap-3 border-b border-line-soft p-4">
                <Avatar name={fullName} src={user?.profileImageId ? imageContentUrl(user.profileImageId) : null} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-strong">{fullName}</p>
                  <p className="truncate text-caption text-ink-muted">{user?.email ?? ""}</p>
                </div>
              </div>

              <div className="p-1.5">
                <ProfileItem icon={UserRound} label="My Profile" onClick={() => navigateFromProfile("/me/profile")} />
                <ProfileItem icon={SlidersHorizontal} label="Personal Preferences" onClick={() => navigateFromProfile("/settings/profile")} />
                <ProfileItem icon={ShieldCheck} label="Security" onClick={() => navigateFromProfile("/settings/security")} />
              </div>

              <div className="border-t border-line-soft px-4 py-3">
                <p className="mb-2 text-caption font-semibold text-ink-subtle" id="theme-label">Appearance</p>
                <div role="radiogroup" aria-labelledby="theme-label" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-muted p-1">
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    const selected = preference === option.value;
                    return (
                      <button key={option.value} type="button" role="radio" aria-checked={selected} onClick={() => setTheme(option.value)} className={cx("inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-caption font-semibold transition-colors", selected ? "bg-surface text-ink-strong shadow-elevation-1" : "text-ink-muted hover:text-ink-strong")}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />{option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {memberships.length > 1 && (
                <div className="border-t border-line-soft p-1.5">
                  <p className="px-3 pb-1 pt-2 text-caption font-semibold text-ink-subtle">Switch institution</p>
                  {memberships.map((membership) => {
                    const current = membership.institution.id === institution?.id;
                    return (
                      <button
                        key={membership.id}
                        type="button"
                        role="menuitem"
                        disabled={current || switchingInstitutionId !== null}
                        onClick={async () => {
                          setSwitchingInstitutionId(membership.institution.id);
                          try {
                            await switchInstitution(membership.institution.id);
                            setProfileOpen(false);
                            router.replace("/");
                            router.refresh();
                          } finally {
                            setSwitchingInstitutionId(null);
                          }
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        <Building2 className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate">{membership.institution.name}</span>
                        <span className={cx("shrink-0 text-caption font-semibold", current ? "text-success-ink" : "text-ink-subtle")}>
                          {current ? "Active" : switchingInstitutionId === membership.institution.id ? "Switching…" : "Switch"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="border-t border-line-soft p-1.5">
                <button type="button" role="menuitem" onClick={handleSignOut} disabled={signingOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-danger-ink transition-colors hover:bg-danger-soft disabled:cursor-wait disabled:opacity-60">
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Universal search palette */}
      {searchOpen && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-[12vh]">
          <div className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]" aria-hidden="true" />
          <div data-search-popover role="dialog" aria-modal="true" aria-label="Universal search" className="relative w-full max-w-2xl animate-pop-in overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-14 items-center gap-3 border-b border-line-soft px-4">
              <Search className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <input
                ref={searchInputRef}
                autoFocus
                data-ui="input"
                placeholder="Search employees, payroll, leave, accounting…"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && searchQuery.trim().length >= 2) {
                    router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
                    closeSearch();
                  }
                }}
                aria-label="Search"
                className="min-w-0 flex-1 bg-transparent text-body text-ink-strong outline-none placeholder:text-ink-subtle"
              />
              <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[0.6875rem] font-semibold text-ink-muted sm:block">Esc</kbd>
              <button type="button" onClick={closeSearch} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover hover:text-ink-strong" aria-label="Close search">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto" aria-live="polite">
              {searchQuery.trim().length < 2 && !searchLoading && (
                <p className="px-5 py-6 text-support text-ink-muted">Type at least two characters. References such as <span className="font-semibold text-ink">PR-…</span> and <span className="font-semibold text-ink">LR-…</span> are supported.</p>
              )}
              {searchLoading && <p className="px-5 py-4 text-support text-ink-muted">Searching…</p>}
              {searchError && <p className="px-5 py-4 text-support text-danger-ink" role="alert">{searchError}</p>}
              {!searchLoading && !searchError && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <p className="px-5 py-6 text-support text-ink-muted">No results found for “{searchQuery.trim()}”.</p>
              )}
              {!searchLoading && searchResults.length > 0 && (
                <ul className="p-2">
                  {searchResults.map((result) => (
                    <li key={`${result.type}-${result.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          router.push(result.route_hint);
                          closeSearch();
                        }}
                        className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover"
                      >
                        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-caption font-bold uppercase", moduleAccents[accentForPath(result.route_hint || "/")].tile)}>
                          {result.type.slice(0, 2)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink-strong">{result.title}</span>
                          <span className="block truncate text-caption text-ink-muted">{result.subtitle || result.reference || result.module}</span>
                        </span>
                        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-caption font-medium text-ink-muted">{result.status.replaceAll("_", " ").toLowerCase()}</span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {searchQuery.trim().length >= 2 && (
              <button type="button" onClick={() => { router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`); closeSearch(); }} className="flex w-full items-center justify-between border-t border-line-soft px-5 py-3 text-sm font-semibold text-primary-ink hover:bg-surface-hover">
                See all results for “{searchQuery.trim()}”<span className="inline-flex items-center gap-1 text-caption text-ink-muted">Enter<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function ProfileItem({ icon: Icon, label, onClick }: { icon: typeof UserRound; label: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-hover hover:text-ink-strong">
      <Icon className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
      {label}
    </button>
  );
}
