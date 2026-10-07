"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import AuthenticationGate from "@/components/guards/AuthenticationGate";
import { cx } from "@/lib/cx";
import { listMyPreferences } from "@/lib/api/institutions";
import { applyDisplayPreferences, DISPLAY_PREFERENCE_KEY, normalizeDisplay, rememberDisplayPreferences } from "@/lib/displayPreferences";

const COLLAPSE_KEY = "ergonx-sidebar-collapsed";
const COLLAPSE_EVENT = "ergonx-sidebar-collapsed-change";

/* The collapsed rail is a per-browser convenience, never shared state. */
function subscribeCollapsed(onChange: () => void) {
  window.addEventListener(COLLAPSE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const sidebarCollapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const setSidebarCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* not persisted */
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, []);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const breakpointMatchesRef = useRef<boolean | null>(null);

  // Personal display preferences (S050): apply the browser copy now, then adopt the saved account copy.
  useEffect(() => {
    applyDisplayPreferences();
    let active = true;
    listMyPreferences()
      .then((rows) => {
        const saved = rows.find((row) => row.preference_key === DISPLAY_PREFERENCE_KEY);
        if (active && saved) rememberDisplayPreferences(normalizeDisplay(saved.value_json));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    breakpointMatchesRef.current = desktopQuery.matches;
    const closeMobileNavigationAtBreakpoint = () => {
      if (breakpointMatchesRef.current === desktopQuery.matches) return;
      breakpointMatchesRef.current = desktopQuery.matches;
      setMobileNavigationOpen(false);
    };
    desktopQuery.addEventListener("change", closeMobileNavigationAtBreakpoint);
    return () => desktopQuery.removeEventListener("change", closeMobileNavigationAtBreakpoint);
  }, []);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavigationOpen(false); };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [mobileNavigationOpen]);

  return (
    <AuthenticationGate>
      <div className="min-h-screen bg-canvas text-ink">
        <a href="#main-content" className="sr-only z-[400] rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Skip to content
        </a>
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          mobileOpen={mobileNavigationOpen}
          onMobileClose={() => setMobileNavigationOpen(false)}
        />

        <div className={cx("min-h-screen min-w-0 transition-[padding] duration-[220ms] ease-standard", sidebarCollapsed ? "lg:pl-[var(--shell-sidebar-collapsed)]" : "lg:pl-[var(--shell-sidebar-expanded)]")}>
          <TopBar onOpenSidebar={() => setMobileNavigationOpen(true)} />
          <main id="main-content" data-shell-main tabIndex={-1} className="px-4 pb-16 pt-6 outline-none sm:px-6 sm:pt-8 xl:px-10">
            <div className="mx-auto w-full max-w-[1360px] min-w-0">{children}</div>
          </main>
        </div>
      </div>
    </AuthenticationGate>
  );
}
