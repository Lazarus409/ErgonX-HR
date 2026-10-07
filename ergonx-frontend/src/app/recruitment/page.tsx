"use client";

import { BriefcaseBusiness, CalendarDays, ClipboardCheck, FileText, Handshake, UsersRound, Workflow } from "lucide-react";

import ModuleLanding from "@/components/home/ModuleLanding";

const areas = [
  { title: "Recruitment Dashboard", description: "Review open jobs, applications, interviews, offers, and pipeline distribution.", href: "/recruitment/dashboard", icon: BriefcaseBusiness, permission: "candidate.view" },
  { title: "Job Postings", description: "Create, publish, close, and monitor open roles.", href: "/recruitment/job-postings", icon: BriefcaseBusiness, permission: "job_posting.view" },
  { title: "Candidates", description: "Maintain candidate records and recruitment sources.", href: "/recruitment/candidates", icon: UsersRound, permission: "candidate.view" },
  { title: "Recruitment Pipeline", description: "See application volume by the server-defined hiring stage.", href: "/recruitment/pipeline", icon: Workflow, permission: "candidate.view" },
  { title: "Recruitment Stages", description: "Review the ordered stages used by the recruitment pipeline.", href: "/recruitment/stages", icon: Workflow, permission: "recruitment_stage.view" },
  { title: "Applications", description: "Submit candidates and move them through the controlled pipeline.", href: "/recruitment/applications", icon: ClipboardCheck, permission: "candidate.view" },
  { title: "Interviews", description: "Schedule interviews and record their controlled outcomes.", href: "/recruitment/interviews", icon: CalendarDays, permission: "interview.view" },
  { title: "Evaluations", description: "Record interviewer scores and hiring recommendations.", href: "/recruitment/evaluations", icon: FileText, permission: "interview.view" },
  { title: "Offers", description: "Manage offer decisions and hire accepted candidates.", href: "/recruitment/offers", icon: Handshake, permission: "offer.view" },
];

export default function RecruitmentHomePage() {
  return <ModuleLanding title="Recruitment" eyebrow="Talent acquisition" description="Manage job postings, candidates, and the hiring pipeline." module="RECRUITMENT" accent="recruitment" icon={UsersRound} areas={areas} />;
}
