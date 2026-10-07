"use client";

import ApplicationWizard from "@/components/recruitment/ApplicationWizard";

export default function NewCandidatePage() {
  const initialJob = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("job_posting") ?? undefined;
  return <ApplicationWizard initialJob={initialJob} />;
}
