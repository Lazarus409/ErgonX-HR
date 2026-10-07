"use client";

import { ClipboardList, Plus } from "lucide-react";
import { useCallback } from "react";

import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import { recruitmentApi } from "@/lib/api";
import { formatDate, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

export default function EvaluationsPage() {
  const load = useCallback(() => recruitmentApi.listCandidateEvaluations({ ordering: "-created_at" }), []);
  const { data, loading, error, reload } = useApiResource(load);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Recruitment" title="Candidate evaluations" description="Structured interviewer scores and recommendations for recruitment applications." icon={ClipboardList} accent="recruitment" actions={<ButtonLink href="/recruitment/evaluations/new" leadingIcon={<Plus className="h-4 w-4" />}>Add evaluation</ButtonLink>} />
      <DataTable
        caption="Candidate evaluations"
        rows={data?.results}
        rowKey={(item) => item.id}
        loading={loading}
        error={error}
        onRetry={reload}
        minWidth={600}
        empty={{ title: "No evaluations recorded", description: "Interviewer evaluations will appear here.", icon: ClipboardList, action: <ButtonLink variant="secondary" href="/recruitment/evaluations/new" leadingIcon={<Plus className="h-4 w-4" />}>Add evaluation</ButtonLink> }}
        columns={[
          { key: "application", header: "Application", cell: (item) => <span className="font-mono text-support">{item.application.slice(0, 8)}</span> },
          { key: "score", header: "Score", numeric: true, sortValue: (item) => Number(item.score), cell: (item) => <span className="font-semibold text-ink-strong">{item.score}</span> },
          { key: "recommendation", header: "Recommendation", cell: (item) => <Badge tone={/HIRE|STRONG|YES/i.test(item.recommendation) && !/NO/i.test(item.recommendation) ? "success" : /NO|REJECT/i.test(item.recommendation) ? "danger" : "neutral"} size="sm">{humanizeEnum(item.recommendation)}</Badge> },
          { key: "date", header: "Date", sortValue: (item) => item.created_at, cell: (item) => formatDate(item.created_at) },
        ]}
      />
    </div>
  );
}
