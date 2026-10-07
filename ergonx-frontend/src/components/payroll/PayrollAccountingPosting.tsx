"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Lock,
  RefreshCw,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

type PostingStatus =
  | "NOT_POSTED"
  | "DRAFT"
  | "MAPPING_REVIEW"
  | "READY"
  | "POSTED";

const statusLabels: Record<PostingStatus, string> = {
  NOT_POSTED: "Not Posted",
  DRAFT: "Draft Journal",
  MAPPING_REVIEW: "Mapping Review",
  READY: "Ready to Post",
  POSTED: "Posted",
};

const statusSteps: PostingStatus[] = [
  "NOT_POSTED",
  "DRAFT",
  "MAPPING_REVIEW",
  "READY",
  "POSTED",
];

export default function PayrollAccountingPosting() {
  const [status, setStatus] = useState<PostingStatus>("MAPPING_REVIEW");

  const currentIndex = statusSteps.indexOf(status);

  const advance = () => {
    if (status === "MAPPING_REVIEW") {
      setStatus("READY");
      return;
    }

    if (status === "READY") {
      setStatus("POSTED");
    }
  };

  return (
    <section className="rounded-2xl border bg-surface p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-card-title font-bold text-headline">
            Payroll → Accounting
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Review the accounting journal generated from this payroll run.
          </p>
        </div>

        <span className="rounded-full bg-surface-sunken px-3 py-1.5 text-xs font-semibold">
          {statusLabels[status]}
        </span>
      </div>

      <div className="mt-6 overflow-x-auto">
        <div className="flex min-w-[650px] items-center">
          {statusSteps.map((step, index) => {
            const complete = index <= currentIndex;

            return (
              <div key={step} className="flex flex-1 items-center">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold ${
                      complete
                        ? "bg-primary text-white"
                        : "bg-surface text-ink-subtle"
                    }`}
                  >
                    {index < currentIndex ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      index + 1
                    )}
                  </div>

                  <span className="whitespace-nowrap text-xs font-medium">
                    {statusLabels[step]}
                  </span>
                </div>

                {index < statusSteps.length - 1 && (
                  <ArrowRight className="mx-3 h-4 w-4 text-ink-subtle" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-surface-muted p-4">
          <p className="text-xs text-ink-muted">Payroll Amount</p>
          <p className="mt-1 font-semibold">GHS 486,200.00</p>
        </div>

        <div className="rounded-xl bg-surface-muted p-4">
          <p className="text-xs text-ink-muted">Journal Reference</p>
          <p className="mt-1 font-semibold">
            JV-PAY-2026-008
          </p>
        </div>

        <div className="rounded-xl bg-surface-muted p-4">
          <p className="text-xs text-ink-muted">Posting Period</p>
          <p className="mt-1 font-semibold">August 2026</p>
        </div>
      </div>

      {status === "MAPPING_REVIEW" && (
        <div className="mt-5 rounded-xl border bg-surface-muted p-4">
          <div className="flex gap-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="font-semibold text-ink-strong">
                Mapping review required
              </p>

              <p className="mt-1 text-sm leading-6 text-ink-muted">
                Review the payroll-to-account mappings before the journal
                can be posted.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/payroll/configuration"
                  className="rounded-lg border bg-surface px-3 py-2 text-xs font-semibold"
                >
                  Review Mapping
                </Link>

                <Link
                  href="/accounting/journals/JV-PAY-2026-008"
                  className="rounded-lg border bg-surface px-3 py-2 text-xs font-semibold"
                >
                  View Draft Journal
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {status === "READY" && (
        <div className="mt-5 rounded-xl border bg-surface-muted p-4">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="font-semibold">Ready for posting</p>
              <p className="mt-1 text-sm text-ink-muted">
                Payroll totals and accounting mappings have been reviewed.
              </p>
            </div>
          </div>
        </div>
      )}

      {status === "POSTED" && (
        <div className="mt-5 rounded-xl border bg-surface-muted p-4">
          <div className="flex gap-3">
            <Lock className="mt-0.5 h-5 w-5 shrink-0" />

            <div>
              <p className="font-semibold">Payroll journal posted</p>
              <p className="mt-1 text-sm text-ink-muted">
                Posting reference: POST-2026-0081
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                The posted accounting record is historical and read-only.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {status !== "POSTED" && (
          <button
            onClick={() => setStatus("MAPPING_REVIEW")}
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh Status
          </button>
        )}

        {(status === "MAPPING_REVIEW" || status === "READY") && (
          <button
            onClick={advance}
            className={buttonClasses({ variant: "primary" })}
          >
            {status === "MAPPING_REVIEW"
              ? "Mark Ready"
              : "Post to Accounting"}
          </button>
        )}
      </div>
    </section>
  );
}