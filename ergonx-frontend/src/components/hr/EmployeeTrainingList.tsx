"use client";

import { useCallback } from "react";
import { Award, GraduationCap } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { trainingApi } from "@/lib/api";
import { CERTIFICATE_STATUS_LABELS, CERTIFICATE_STATUS_TONES, ENROLLMENT_STATUS_LABELS, ENROLLMENT_STATUS_TONES, type TrainingEnrollment } from "@/lib/api/training";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

function dates(item: TrainingEnrollment) {
  if (item.completed_on) return `Completed ${formatDate(item.completed_on)}${item.score ? ` · score ${Number(item.score)}%` : ""}`;
  if (item.planned_start) return `${formatDate(item.planned_start)}${item.planned_end ? ` – ${formatDate(item.planned_end)}` : ""}`;
  return "Not scheduled yet";
}

/** One employee's training: on their HR record (``employeeId``) or their own page (``mine``). */
export default function EmployeeTrainingList({ employeeId, mine = false }: { employeeId?: string; mine?: boolean }) {
  const load = useCallback(
    () => (mine ? trainingApi.getMyTraining().then((data) => data.enrollments) : trainingApi.listEnrollments({ employee: employeeId, ordering: "-planned_start" }).then((page) => page.results)),
    [mine, employeeId],
  );
  const { data, loading, error, reload } = useApiResource(load);
  const items = data ?? [];
  const certificates = items.filter((item) => item.certificate_status);

  return (
    <div className="space-y-6">
      {certificates.length > 0 && (
        <Card title="Certificates" description="Certifications from completed training, with their renewal dates." icon={Award} accent="hr">
          <ul className="divide-y divide-line-soft">
            {certificates.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><span className="block font-semibold text-ink-strong">{item.course_title}</span><span className="text-caption text-ink-muted">{item.certificate_number ? `No. ${item.certificate_number} · ` : ""}valid until {formatDate(item.certificate_expires_on)}</span></span>
                {item.certificate_status && <Badge size="sm" tone={CERTIFICATE_STATUS_TONES[item.certificate_status]}>{CERTIFICATE_STATUS_LABELS[item.certificate_status]}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Training history" description={mine ? "Courses you are enrolled on or have completed." : "Courses this employee is enrolled on or has completed."} icon={GraduationCap} accent="hr">
        {error ? <ErrorState variant="inline" title="Unable to load training" message={error} onRetry={reload} /> : loading && !data ? <p className="text-support text-ink-muted">Loading training…</p> : items.length === 0 ? (
          <EmptyState size="compact" icon={GraduationCap} title="No training yet" description={mine ? "Training HR enrols you on will appear here." : "Enrol this employee from the Training page."} />
        ) : (
          <ul className="divide-y divide-line-soft">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span><span className="block font-semibold text-ink-strong">{item.course_title}</span><span className="text-caption text-ink-muted">{item.course_code} · {dates(item)}</span></span>
                <Badge size="sm" tone={ENROLLMENT_STATUS_TONES[item.status]}>{ENROLLMENT_STATUS_LABELS[item.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
