"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { getApiErrorMessage, recruitmentApi } from "@/lib/api";

/** Applications are reviewed on the candidate detail page; keep old links working. */
export default function ApplicationRedirectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    recruitmentApi.getApplication(id)
      .then((application) => { if (active) router.replace(`/recruitment/candidates/${application.candidate}?application=${application.id}`); })
      .catch((caught) => { if (active) setError(getApiErrorMessage(caught)); });
    return () => { active = false; };
  }, [id, router]);
  return error ? <ErrorState message={error} /> : <LoadingState />;
}
