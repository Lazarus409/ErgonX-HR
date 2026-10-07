import { Check, Lock } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cx } from "@/lib/cx";
import type { Lifecycle } from "@/lib/lifecycles";

/**
 * Governed record lifecycle (Stitch S061 "Workflow transitions"). Shows the
 * main path with reached, current and upcoming stages. A state off the main
 * path (rejected, void, reversed, …) is shown as a labelled outcome rather
 * than a step, because the record did not travel the rest of the path.
 * Purely descriptive: actions stay on the module's own record page.
 */
export default function LifecycleStepper({ lifecycle, status, className }: { lifecycle: Lifecycle; status: string; className?: string }) {
  const code = status.toUpperCase();
  const outcome = lifecycle.outcomes[code];
  const reachedIndex = outcome ? (outcome.afterStep ? lifecycle.steps.findIndex((step) => step.key === outcome.afterStep) : -1) : lifecycle.steps.findIndex((step) => step.key === code);

  return (
    <section aria-label="Record lifecycle" className={cx("rounded-xl border border-line bg-surface p-5 shadow-elevation-1", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-card-title font-semibold text-ink-strong">Lifecycle</h2>
        {outcome && <Badge tone={outcome.tone as BadgeTone} dot>{outcome.label}</Badge>}
      </div>
      <ol className="mt-4 grid gap-3 sm:grid-flow-col sm:auto-cols-fr">
        {lifecycle.steps.map((step, index) => {
          const done = index < reachedIndex || (index === reachedIndex && (Boolean(outcome) || step.final));
          const current = !outcome && index === reachedIndex && !step.final;
          return (
            <li key={step.key} aria-current={current ? "step" : undefined} className="relative flex items-start gap-3 sm:flex-col sm:items-center sm:text-center">
              {index > 0 && <span aria-hidden="true" className={cx("absolute hidden h-px sm:block sm:left-[calc(-50%+1.25rem)] sm:right-[calc(50%+1.25rem)] sm:top-4", index <= reachedIndex ? "bg-success" : "bg-line")} />}
              <span
                className={cx(
                  "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
                  done && "bg-success-soft text-success",
                  current && "bg-primary text-white ring-4 ring-primary-soft",
                  !done && !current && "bg-surface-muted text-ink-subtle",
                )}
              >
                {done ? (step.final ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />) : index + 1}
              </span>
              <span className="min-w-0">
                <span className={cx("block text-sm font-semibold", done || current ? "text-ink-strong" : "text-ink-muted")}>{step.label}</span>
                {step.hint && <span className="block text-caption text-ink-muted">{step.hint}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
