"use client";

import Link from "next/link";
import RecruitmentList from "@/components/recruitment/RecruitmentList";
import { recruitmentApi } from "@/lib/api";
import type { Candidate } from "@/types/recruitment";

export default function CandidatesPage() {
  return <RecruitmentList<Candidate> title="Candidates" description="Manage applicant profiles in the active institution." createHref="/recruitment/candidates/new" createLabel="New Candidate" load={(search) => recruitmentApi.listCandidates({ search, ordering: "last_name" })} columns={[{ label: "Candidate", render: (item) => <Link href={`/recruitment/candidates/${item.id}`} className="font-medium text-ink-strong hover:underline">{[item.first_name, item.middle_name, item.last_name].filter(Boolean).join(" ")}<span className="mt-0.5 block text-xs font-normal text-ink-muted">{item.email}</span></Link> }, { label: "Phone", render: (item) => item.phone || "—" }, { label: "Source", render: (item) => item.source || "Not recorded" }]} />;
}
