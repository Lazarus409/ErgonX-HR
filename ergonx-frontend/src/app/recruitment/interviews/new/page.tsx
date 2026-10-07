"use client";

import InterviewScheduler from "@/components/recruitment/InterviewScheduler";

export default function ScheduleInterviewPage() {
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  return <InterviewScheduler applicationId={params?.get("application") ?? null} interviewId={params?.get("interview") ?? null} />;
}
