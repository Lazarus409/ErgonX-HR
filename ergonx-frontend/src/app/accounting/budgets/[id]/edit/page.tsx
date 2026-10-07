"use client";

import { useParams } from "next/navigation";
import { useCallback } from "react";

import BudgetForm from "@/components/accounting/BudgetForm";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import { accountingApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";

export default function EditBudgetPage() {
  const { id } = useParams<{ id: string }>();
  const load = useCallback(() => accountingApi.getBudget(id), [id]);
  const { data, loading, error, reload } = useApiResource(load);
  if (loading && !data) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Budget not found."} onRetry={reload} />;
  return <BudgetForm budget={data} />;
}
