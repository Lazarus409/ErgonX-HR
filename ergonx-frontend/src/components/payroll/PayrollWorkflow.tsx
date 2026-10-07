import { Check } from "lucide-react";

import { cx } from "@/lib/cx";
import { humanizeEnum } from "@/lib/format";

export const PAYROLL_WORKFLOW = ["DRAFT", "CALCULATING", "CALCULATED", "UNDER_REVIEW", "APPROVED", "FINALIZED"] as const;

/**
 * Presentation of the controlled payroll lifecycle. The current status is
 * backend-reported; this component never advances or infers workflow state.
 */
export default function PayrollWorkflow({ current }: { current?: string | null }) {
  const currentIndex = current ? PAYROLL_WORKFLOW.indexOf(current as (typeof PAYROLL_WORKFLOW)[number]) : -1;
  return (
    <ol className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label="Payroll workflow">
      {PAYROLL_WORKFLOW.map((status, index) => {
        const done = currentIndex > index || (currentIndex === index && status === "FINALIZED");
        const active = currentIndex === index && status !== "FINALIZED";
        return (
          <li key={status} aria-current={active ? "step" : undefined} className={cx("relative flex items-center gap-2.5 rounded-xl border px-3 py-2.5", active ? "border-mod-payroll bg-mod-payroll-soft" : done ? "border-line bg-surface" : "border-dashed border-line bg-surface-muted/40")}>
            <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-caption font-bold", done ? "bg-success text-white" : active ? "bg-mod-payroll text-white" : "bg-surface-sunken text-ink-subtle")} aria-hidden="true">
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className={cx("min-w-0 truncate text-support font-semibold", active || done ? "text-ink-strong" : "text-ink-muted")}>{humanizeEnum(status)}</span>
            <span className="sr-only">{done ? "(completed)" : active ? "(current)" : "(not started)"}</span>
          </li>
        );
      })}
    </ol>
  );
}
