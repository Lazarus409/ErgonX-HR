"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Target } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import { performanceApi } from "@/lib/api";
import { RATING_LABELS, REVIEW_STATUS_LABELS, REVIEW_STATUS_TONES, type ReviewListItem } from "@/lib/api/performance";
import { useApiResource } from "@/lib/useApiResource";

/** The signed-in member's own reviews, and any they need to complete as a reviewer. */
export default function MyPerformancePage() {
  const router = useRouter();
  const load = useCallback(() => Promise.all([performanceApi.listReviews({ mine: "employee" }), performanceApi.listReviews({ mine: "reviewer" })]), []);
  const { data, loading, error, reload } = useApiResource(load);
  const mine = data?.[0].results ?? [];
  const toReview = data?.[1].results ?? [];
  const waiting = toReview.filter((row) => row.status === "MANAGER_REVIEW").length;
  const initial = loading && !data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="My performance" description="Your performance reviews, and reviews you complete for your team." icon={Target} accent="hr" />
      <DataTable<ReviewListItem>
        caption="My reviews"
        rows={mine}
        rowKey={(row) => row.id}
        loading={initial}
        error={error}
        onRetry={reload}
        onRowClick={(row) => router.push(`/reviews/${row.id}`)}
        empty={{ title: "No reviews yet", description: "When HR opens a review cycle, your review appears here.", icon: Target }}
        columns={[
          { key: "cycle", header: "Review", cell: (row) => <span className="font-semibold text-ink-strong">{row.cycle_name}</span> },
          { key: "reviewer", header: "Reviewer", cell: (row) => row.reviewer_name || "—" },
          { key: "status", header: "Stage", cell: (row) => <Badge size="sm" tone={REVIEW_STATUS_TONES[row.status]}>{row.status === "SELF_ASSESSMENT" ? "Your self-assessment" : REVIEW_STATUS_LABELS[row.status]}</Badge> },
          { key: "rating", header: "Overall", cell: (row) => row.overall_rating ? `${row.overall_rating} · ${RATING_LABELS[row.overall_rating]}` : "—" },
        ]}
      />
      {toReview.length > 0 && (
        <DataTable<ReviewListItem>
          caption="Reviews to complete"
          rows={toReview}
          rowKey={(row) => row.id}
          loading={initial}
          onRowClick={(row) => router.push(`/reviews/${row.id}`)}
          toolbar={<div className="flex items-center gap-2 px-4 py-3"><ClipboardCheck className="h-4 w-4 text-primary" aria-hidden="true" /><span className="font-semibold text-ink-strong">Reviews you give</span>{waiting > 0 && <Badge size="sm" tone="warning">{waiting} waiting for you</Badge>}</div>}
          columns={[
            { key: "employee", header: "Employee", cell: (row) => <span><span className="block font-semibold text-ink-strong">{row.employee_name}</span><span className="text-caption text-ink-muted">{row.cycle_name}</span></span> },
            { key: "status", header: "Stage", cell: (row) => <Badge size="sm" tone={REVIEW_STATUS_TONES[row.status]}>{REVIEW_STATUS_LABELS[row.status]}</Badge> },
            { key: "rating", header: "Overall", cell: (row) => row.overall_rating ? `${row.overall_rating} · ${RATING_LABELS[row.overall_rating]}` : "—" },
          ]}
        />
      )}
    </div>
  );
}
