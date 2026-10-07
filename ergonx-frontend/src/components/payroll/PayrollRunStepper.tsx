import { Banknote, CheckCircle2, FileText, Settings2, type LucideIcon } from "lucide-react";

import { cx } from "@/lib/cx";

/**
 * Concept payroll stepper: Draft → Validating → Approved → Paid. Backend states
 * map onto it: DRAFT/CALCULATING/CALCULATED are Draft, UNDER_REVIEW is
 * Validating, APPROVED is Approved and FINALIZED is Paid.
 */
export const PAYROLL_STEPS: Array<{ key: string; label: string; description: string; icon: LucideIcon }> = [
  { key: "draft", label: "Draft", description: "Payroll data is being prepared and can be updated.", icon: FileText },
  { key: "validating", label: "Validating", description: "Checked for errors and compliance issues before approval.", icon: Settings2 },
  { key: "approved", label: "Approved", description: "Payroll run is approved and locked for payment.", icon: CheckCircle2 },
  { key: "paid", label: "Paid", description: "Payroll is finalized and payslips are issued.", icon: Banknote },
];

export function payrollStepIndex(status: string | null | undefined): number {
  switch (status) {
    case "DRAFT":
    case "CALCULATING":
    case "CALCULATED":
      return 0;
    case "UNDER_REVIEW":
      return 1;
    case "APPROVED":
      return 2;
    case "FINALIZED":
      return 3;
    default:
      return -1;
  }
}

export default function PayrollRunStepper({ status, compact = false, showDescriptions = true }: { status: string | null | undefined; compact?: boolean; showDescriptions?: boolean }) {
  const current = payrollStepIndex(status);
  return (
    <ol className="grid grid-cols-4" aria-label="Payroll run progress">
      {PAYROLL_STEPS.map((step, index) => {
        const Icon = step.icon;
        const done = current > index;
        const active = current === index;
        return (
          <li key={step.key} className="relative flex flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            {index < PAYROLL_STEPS.length - 1 && (
              <span aria-hidden="true" className={cx("absolute top-[calc(var(--dot)/2)] h-0.5 [--dot:4.5rem]", compact && "[--dot:3.5rem]", "left-[calc(50%+var(--dot)/2)] right-[calc(-50%+var(--dot)/2)]", done ? "bg-mod-recruitment" : "bg-line")} />
            )}
            <span
              className={cx(
                "relative flex items-center justify-center rounded-full",
                compact ? "h-14 w-14" : "h-[4.5rem] w-[4.5rem]",
                active ? "bg-mod-recruitment text-white ring-8 ring-mod-recruitment-soft" : done ? "bg-mod-recruitment-soft text-mod-recruitment" : "bg-surface-muted text-ink-muted",
              )}
              aria-hidden="true"
            >
              <Icon className={compact ? "h-6 w-6" : "h-7 w-7"} />
            </span>
            <span className={cx("mt-3 font-bold", compact ? "text-support" : "text-card-title", active ? "text-mod-recruitment" : "text-headline")}>{step.label}</span>
            {showDescriptions && <span className="mt-1 max-w-[12rem] text-caption text-ink-muted">{step.description}</span>}
          </li>
        );
      })}
    </ol>
  );
}
