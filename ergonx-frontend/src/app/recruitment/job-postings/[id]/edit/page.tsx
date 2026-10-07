"use client";

import { useParams } from "next/navigation";
import { useCallback } from "react";

import RequisitionForm from "@/components/recruitment/RequisitionForm";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { recruitmentApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";

export default function EditRequisitionPage() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(() => recruitmentApi.getJobPosting(id), [id]);
  const { data, loading, error, reload } = useApiResource(load);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Requisition not found."} onRetry={reload} />;
  return <RequisitionForm posting={data} />;
}
