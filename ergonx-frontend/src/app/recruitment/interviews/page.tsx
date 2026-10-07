"use client";

import { CalendarClock, CheckCircle2, Plus, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable } from "@/components/ui/DataTable";
import ErrorState from "@/components/ui/ErrorState";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { RecruitmentInterview } from "@/types/recruitment";

type Action = { id: string; status: "COMPLETED" | "CANCELLED" | "NO_SHOW" } | null;

export default function InterviewsPage() {
  const [rows, setRows] = useState<RecruitmentInterview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await recruitmentApi.listInterviews({ ordering: "scheduled_at" })).results);
    } catch (caught) {
      setRows(null);
      setError(getApiErrorMessage(caught));
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const updateStatus = async () => {
    if (!action) return;
    setSaving(true);
    try {
      await recruitmentApi.setInterviewStatus(action.id, action.status);
      setAction(null);
      await load();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
      setAction(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Recruitment" title="Interviews" description="Schedule interviews and record controlled outcomes." icon={CalendarClock} accent="recruitment" actions={<ButtonLink href="/recruitment/interviews/new" leadingIcon={<Plus className="h-4 w-4" />}>Schedule interview</ButtonLink>} />
      {error && rows && <ErrorState variant="inline" title="Unable to update the interview" message={error} onRetry={() => void load()} />}
      <DataTable<RecruitmentInterview>
        caption="Interviews"
        rows={rows}
        rowKey={(row) => row.id}
        loading={!rows && !error}
        error={!rows ? error : null}
        onRetry={() => void load()}
        minWidth={700}
        empty={{ title: "No interviews scheduled", description: "Scheduled interviews will appear here.", icon: CalendarClock, action: <ButtonLink variant="secondary" href="/recruitment/interviews/new" leadingIcon={<Plus className="h-4 w-4" />}>Schedule interview</ButtonLink> }}
        columns={[
          { key: "scheduled", header: "Scheduled", sortValue: (row) => row.scheduled_at, cell: (row) => <span className="font-semibold text-ink-strong">{formatDateTime(row.scheduled_at)}</span> },
          { key: "type", header: "Type", cell: (row) => row.interview_type || "Interview" },
          { key: "location", header: "Location / link", hideBelow: "md", cell: (row) => <span className="block max-w-[16rem] truncate" title={row.location_or_link || undefined}>{row.location_or_link || <span className="text-ink-subtle">Not set</span>}</span> },
          { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} size="sm" /> },
          {
            key: "action",
            header: <span className="sr-only">Actions</span>,
            cell: (row) => row.status === "SCHEDULED" ? (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" leadingIcon={<CheckCircle2 className="h-4 w-4 text-success" />} onClick={() => setAction({ id: row.id, status: "COMPLETED" })}>Complete</Button>
                <Button size="sm" variant="ghost" className="text-danger-ink" leadingIcon={<XCircle className="h-4 w-4" />} onClick={() => setAction({ id: row.id, status: "CANCELLED" })}>Cancel</Button>
              </div>
            ) : null,
          },
        ]}
      />
      <ConfirmDialog open={action !== null} title="Update interview status?" description={`The backend will set this interview to ${action?.status.replaceAll("_", " ").toLowerCase()}.`} confirmLabel="Confirm" destructive={action?.status === "CANCELLED"} loading={saving} onConfirm={() => void updateStatus()} onCancel={() => setAction(null)} />
    </div>
  );
}
