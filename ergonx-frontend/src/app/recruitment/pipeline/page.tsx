"use client";

import { Layers } from "lucide-react";
import { useCallback } from "react";

import { FunnelChart } from "@/components/charts/Visuals";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import { recruitmentApi } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

export default function RecruitmentPipelinePage() {
  const load = useCallback(() => recruitmentApi.getPipeline(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const stages = [...(data ?? [])].sort((a, b) => a.sequence - b.sequence);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Recruitment" title="Recruitment pipeline" description="Application volume by the institution-defined recruitment stages." icon={Layers} accent="recruitment" />
      {loading && !data && <LoadingState variant="dashboard" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (stages.length ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Stages">
            {stages.map((stage) => (
              <article key={stage.stage_id} className="relative overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-elevation-1">
                <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] bg-mod-recruitment" style={{ opacity: 0.35 + (0.65 * stage.sequence) / Math.max(stages.length, 1) }} />
                <p className="flex items-center gap-2 text-support font-medium text-ink-muted"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-mod-recruitment-soft text-caption font-bold text-mod-recruitment">{stage.sequence}</span>{stage.stage_name}</p>
                <p className="mt-4 text-kpi font-semibold text-ink-strong tabular-nums">{formatNumber(stage.application_count)}</p>
                <p className="text-caption text-ink-muted">applications</p>
              </article>
            ))}
          </section>
          <Card title="Stage conversion" description="Share of applications that reach each stage, relative to the one before." icon={Layers} accent="recruitment">
            <FunnelChart stages={stages.map((stage) => ({ label: stage.stage_name, value: stage.application_count }))} />
          </Card>
        </>
      ) : (
        <EmptyState icon={Layers} accent="recruitment" title="No recruitment stages configured" description="Configure ordered stages before applications can move through the pipeline." />
      ))}
    </div>
  );
}
