import type { ReactNode } from "react";

import Logo from "@/components/brand/Logo";
import { cx } from "@/lib/cx";

/**
 * Formal / official document surface (payslips, financial statements).
 * The institution (its uploaded logo when present) is the primary identity;
 * ErgonX appears only as a monochrome "Powered by" attribution, per branding.md. Prints cleanly: the application
 * shell is hidden and the document keeps neutral ink.
 */
export default function DocumentFrame({ institutionName, institutionLogoSrc, documentTitle, meta, children, footerNote, className }: { institutionName: string; institutionLogoSrc?: string | null; documentTitle: string; meta?: ReactNode; children: ReactNode; footerNote?: ReactNode; className?: string }) {
  return (
    <article className={cx("mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-2 print:rounded-none print:border-0 print:shadow-none", className)}>
      <header className="flex flex-col justify-between gap-5 border-b border-line px-6 py-6 sm:flex-row sm:items-start sm:px-8">
        <div className="flex min-w-0 items-center gap-4">
          {institutionLogoSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={institutionLogoSrc} alt={`${institutionName} logo`} className="h-12 w-auto max-w-32 shrink-0 object-contain" />
          )}
          <div className="min-w-0">
            <p className="text-heading font-bold text-ink-strong">{institutionName}</p>
            <p className="mt-0.5 text-support font-medium text-ink-muted">{documentTitle}</p>
          </div>
        </div>
        {meta && <div className="text-left text-support sm:text-right">{meta}</div>}
      </header>
      <div>{children}</div>
      <footer className="flex flex-col gap-3 border-t border-line bg-surface-muted/40 px-6 py-4 text-caption text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 print:bg-transparent">
        <div className="min-w-0">{footerNote}</div>
        <span className="inline-flex shrink-0 items-center gap-2 opacity-80">
          Powered by
          <Logo variant="mono" height={11} alt="ErgonX" className="dark:hidden print:block" />
          <Logo variant="mono-white" height={11} alt="ErgonX" className="hidden dark:block print:hidden" />
        </span>
      </footer>
    </article>
  );
}
