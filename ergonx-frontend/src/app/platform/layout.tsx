"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Building2, History, LogOut, MailPlus, Moon, ShieldAlert, Sun, UserRoundCog, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import Logo from "@/components/brand/Logo";
import { useTheme } from "@/components/context/ThemeProvider";
import { useAuth } from "@/components/guards/AuthProvider";
import LoadingState from "@/components/ui/LoadingState";
import { platformSolid } from "@/components/platform/ui";
import { cx } from "@/lib/cx";

const sections: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: "Invitations", href: "/platform", icon: MailPlus },
  { label: "Organizations", href: "/platform/organizations", icon: Building2 },
  { label: "Audit log", href: "/platform/audit", icon: History },
];

function isActive(pathname: string, href: string) {
  return href === "/platform" ? pathname === "/platform" : pathname.startsWith(href);
}

const headerButton = "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold text-ink transition hover:border-line-strong hover:bg-surface-hover";

/** Super Admin console shell: floating header card and section menu for every /platform page. */
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isPlatformAdmin, loading, logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Signed out: the Super Admin entrance is /admin.
  useEffect(() => {
    if (!loading && !user) router.replace("/admin");
  }, [loading, user, router]);

  if (loading || !user) return <LoadingState variant="splash" />;
  if (!isPlatformAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-brand-navy-deep p-6">
        <div className="max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-elevation-3">
          <ShieldAlert className="mx-auto h-10 w-10 text-danger" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold text-ink-strong">Platform access required</h1>
          <p className="mt-2 text-sm text-ink-muted">This workspace is only available to ErgonX Super Admins.</p>
        </div>
      </main>
    );
  }

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Super Administrator";

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 lg:px-10 lg:py-7">
        <header className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[0_12px_35px_rgb(15_23_42/0.04)] sm:px-6">
          <Link href="/platform" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-navy-deep p-2 shadow-lg dark:ring-1 dark:ring-line-strong"><Logo variant="mark" height={22} alt="" priority /></span>
            <span>
              <span className="block text-sm font-bold tracking-[0.18em] text-ink-strong">ERGONX</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-ink">Platform control</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-ink-strong">{fullName}</p>
              <p className="text-xs text-ink-muted">Super Administrator</p>
            </div>
            <button type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title={theme === "dark" ? "Light mode" : "Dark mode"} className={cx(headerButton, "w-10 px-0")}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span className="hidden h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-brand-navy-deep p-2 shadow-md dark:ring-1 dark:ring-line-strong sm:flex" aria-hidden="true"><Logo variant="mark" height={20} alt="" /></span>
            <button type="button" onClick={() => router.push("/platform/profile")} className={cx(headerButton, "hidden md:inline-flex")}><UserRoundCog className="h-4 w-4" />My profile</button>
            <button type="button" onClick={() => { logout(); router.replace("/admin"); }} className={headerButton}><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </header>

        <nav aria-label="Platform sections" className="mt-4 flex gap-1 overflow-x-auto">
          {sections.map(({ label, href, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition",
                  active ? `${platformSolid} shadow-md` : "text-ink-muted hover:bg-surface hover:text-ink-strong",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />{label}
              </Link>
            );
          })}
        </nav>

        <main className="mt-6 space-y-6">{children}</main>
      </div>
    </div>
  );
}
