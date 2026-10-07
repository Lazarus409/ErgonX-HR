"use client";

import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "@/lib/cx";
import type { ModuleAccent } from "@/lib/moduleTheme";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small context label above the title (e.g. module name). */
  eyebrow?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  icon?: LucideIcon;
  accent?: ModuleAccent;
  /** Back affordance rendered above the title (e.g. <BackButton />). */
  back?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, description, actions, breadcrumbs, back, meta, className }: PageHeaderProps) {
  // Concept header: large royal-blue title with a blue supporting line. The
  // top bar already carries the route breadcrumb and module context, so the
  // legacy `eyebrow`, `icon` and `accent` props are accepted but not drawn.
  return (
    <header className={cx("flex flex-col gap-4 pb-2 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {back && <div className="mb-3">{back}</div>}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-caption text-ink-muted">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="h-3 w-3 text-ink-subtle" aria-hidden="true" />}
                  {crumb.href ? <Link href={crumb.href} className="font-medium hover:text-ink-strong">{crumb.label}</Link> : <span aria-current="page" className="font-medium text-ink">{crumb.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="text-balance text-[1.75rem] font-bold leading-9 tracking-tight text-headline sm:text-title">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-[0.9375rem] leading-6 text-heading-support sm:text-[1.0625rem]">{description}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5 sm:pt-1.5">{actions}</div>}
    </header>
  );
}
