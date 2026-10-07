"use client";

import Link from "next/link";
import { ClipboardCheck, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ButtonLink } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Candidate, JobPosting, RecruitmentApplication } from "@/types/recruitment";

export default function ApplicationsPage() {
  const [rows, setRows] = useState<RecruitmentApplication[] | null>(null);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const [applications, jobPostings, candidateRows] = await Promise.all([recruitmentApi.listApplications({ ordering: "-created_at" }), recruitmentApi.listJobPostings({ page_size: 100 }), recruitmentApi.listCandidates({ page_size: 100 })]);
      setRows(applications.results);
      setJobs(jobPostings.results);
      setCandidates(candidateRows.results);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
      setRows(null);
    }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const jobName = new Map(jobs.map((job) => [job.id, job.title]));
  const candidateName = new Map(candidates.map((candidate) => [candidate.id, [candidate.first_name, candidate.last_name].filter(Boolean).join(" ")]));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Recruitment" title="Applications" description="Draft and submit applications through the institution recruitment pipeline." icon={ClipboardCheck} accent="recruitment" actions={<ButtonLink href="/recruitment/applications/new" leadingIcon={<Plus className="h-4 w-4" />}>New application</ButtonLink>} />
      <DataTable<RecruitmentApplication>
        caption="Applications"
        rows={rows}
        rowKey={(row) => row.id}
        loading={!rows && !error}
        error={error}
        onRetry={() => void load()}
        minWidth={650}
        empty={{ title: "No applications found", description: "Submit a candidate against an open job posting to start.", icon: ClipboardCheck, action: <ButtonLink href="/recruitment/applications/new" size="sm">New application</ButtonLink> }}
        columns={[
          { key: "candidate", header: "Candidate", cell: (row) => { const name = candidateName.get(row.candidate) ?? row.candidate; return <Link href={`/recruitment/applications/${row.id}`} className="flex items-center gap-3 font-semibold text-ink-strong hover:underline"><Avatar name={name} size="sm" />{name}</Link>; } },
          { key: "job", header: "Job posting", cell: (row) => jobName.get(row.job_posting) ?? row.job_posting },
          { key: "submitted", header: "Submitted", sortValue: (row) => row.applied_at ?? "", cell: (row) => (row.applied_at ? formatDate(row.applied_at) : <span className="text-ink-subtle">Draft</span>) },
          { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} size="sm" /> },
        ]}
      />
    </div>
  );
}
