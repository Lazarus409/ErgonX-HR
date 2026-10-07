"use client";

import { Plus, Workflow } from "lucide-react";
import { useCallback, useState } from "react";

import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { Checkbox, Field, Input } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";

export default function RecruitmentStagesPage() {
  const load = useCallback(() => recruitmentApi.listRecruitmentStages({ ordering: "sequence" }), []);
  const { data, loading, error, reload } = useApiResource(load);
  const [form, setForm] = useState({ name: "", sequence: "", is_terminal: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.sequence || saving) { setSaveError("Stage name and sequence are required."); return; }
    setSaving(true);
    setSaveError(null);
    try {
      await recruitmentApi.createRecruitmentStage({ name: form.name.trim(), sequence: Number(form.sequence), is_terminal: form.is_terminal, is_active: true });
      setForm({ name: "", sequence: "", is_terminal: false });
      reload();
    } catch (caught) {
      setSaveError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };
  if (loading) return <LoadingState variant="table" />;
  if (error || !data) return <ErrorState message={error ?? "Unable to load recruitment stages."} onRetry={reload} />;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Recruitment" title="Recruitment stages" description="The ordered, institution-scoped stages used by the recruitment pipeline." icon={Workflow} accent="recruitment" />
      <Card title="Add a stage" description="Stages run in sequence order; a terminal stage ends the pipeline." accent="recruitment">
        <form onSubmit={create} className="grid items-end gap-4 md:grid-cols-[1fr_140px_auto_auto]">
          <Field label="Stage name" required><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Technical interview" /></Field>
          <Field label="Sequence" required><Input type="number" min="1" value={form.sequence} onChange={(event) => setForm((current) => ({ ...current, sequence: event.target.value }))} placeholder="1" /></Field>
          <Checkbox className="pb-2.5" label="Terminal" checked={form.is_terminal} onChange={(event) => setForm((current) => ({ ...current, is_terminal: event.target.checked }))} />
          <Button type="submit" loading={saving} loadingLabel="Adding…" leadingIcon={<Plus className="h-4 w-4" />}>Add stage</Button>
        </form>
        {saveError && <Alert tone="danger" className="mt-4">{saveError}</Alert>}
      </Card>
      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1" aria-label="Stages">
        {data.results.length === 0 ? (
          <EmptyState size="compact" icon={Workflow} accent="recruitment" title="No stages configured" description="Applications cannot be submitted until an active stage exists." />
        ) : (
          <ol className="divide-y divide-line-soft">
            {data.results.map((stage) => (
              <li key={stage.id} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-hover">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-mod-recruitment-soft text-sm font-bold text-mod-recruitment">{stage.sequence}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-strong">{stage.name}</p>
                  <p className="text-caption text-ink-muted">{stage.is_terminal ? "Terminal stage" : "Active workflow stage"}</p>
                </div>
                <StatusBadge status={stage.is_active ? "ACTIVE" : "INACTIVE"} size="sm" />
                <Button size="sm" variant="ghost" onClick={async () => { try { await recruitmentApi.updateRecruitmentStage(stage.id, { is_active: !stage.is_active }); reload(); } catch (caught) { setSaveError(getApiErrorMessage(caught)); } }}>{stage.is_active ? "Deactivate" : "Activate"}</Button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
