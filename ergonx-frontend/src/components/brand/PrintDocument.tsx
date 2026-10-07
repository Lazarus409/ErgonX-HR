"use client";

import { Printer } from "lucide-react";
import type { ReactNode } from "react";

import Logo from "@/components/brand/Logo";
import { useAuth } from "@/components/guards/AuthProvider";
import { Button } from "@/components/ui/Button";
import { imageContentUrl } from "@/lib/api/images";

/**
 * Formal print treatment for record pages (journal entries, leave forms,
 * offers, employee records, payroll runs), per branding.md: when printed or
 * saved as PDF the page carries the institution masthead and ErgonX appears
 * only as the monochrome "Powered by" attribution. Nothing renders on screen
 * except the Print button; the application shell is already hidden in print.
 */
export function PrintMasthead({ documentTitle, reference }: { documentTitle: string; reference?: ReactNode }) {
  const { institution } = useAuth();
  const printedOn = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="hidden print:mb-6 print:flex print:items-start print:justify-between print:gap-6 print:border-b print:border-line print:pb-4">
      <div className="flex min-w-0 items-center gap-4">
        {institution?.logoImageId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageContentUrl(institution.logoImageId)} alt={`${institution.name} logo`} className="h-12 w-auto max-w-32 object-contain" />
        )}
        <div className="min-w-0">
          <p className="text-heading font-bold text-ink-strong">{institution?.name ?? "Institution"}</p>
          <p className="text-support font-medium text-ink-muted">{documentTitle}</p>
        </div>
      </div>
      <div className="shrink-0 text-right text-caption text-ink-muted">
        {reference && <p className="font-semibold text-ink-strong">{reference}</p>}
        <p>Printed {printedOn}</p>
      </div>
    </div>
  );
}

export function PrintFooter() {
  return (
    <div className="hidden print:mt-8 print:flex print:items-center print:justify-end print:gap-2 print:border-t print:border-line print:pt-3 print:text-caption print:text-ink-muted">
      Powered by
      <Logo variant="mono" height={11} alt="ErgonX" />
    </div>
  );
}

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button variant="secondary" className="print:hidden" leadingIcon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
      {label}
    </Button>
  );
}
