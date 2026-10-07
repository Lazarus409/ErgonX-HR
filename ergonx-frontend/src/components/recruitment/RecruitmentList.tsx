"use client";

import { Plus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ButtonLink } from "@/components/ui/Button";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage } from "@/lib/api";
import type { PaginatedData } from "@/types/api";

interface RecruitmentListProps<T extends { id: string; status: string }> {
  title: string;
  description: string;
  createHref?: string;
  createLabel?: string;
  load: (search?: string) => Promise<PaginatedData<T>>;
  columns: Array<{ label: string; render: (item: T) => React.ReactNode }>;
}

export default function RecruitmentList<T extends { id: string; status: string }>({
  title,
  description,
  createHref,
  createLabel,
  load,
  columns,
}: RecruitmentListProps<T>) {
  const [search, setSearch] = useState("");
  const [data, setData] = useState<PaginatedData<T> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setData(await load(search.trim() || undefined));
    } catch (caught) {
      setData(null);
      setError(getApiErrorMessage(caught));
    }
  }, [load, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Recruitment"
        title={title}
        description={description}
        icon={UsersRound}
        accent="recruitment"
        actions={createHref && createLabel ? <ButtonLink href={createHref} leadingIcon={<Plus className="h-4 w-4" />}>{createLabel}</ButtonLink> : undefined}
      />
      <DataTable<T>
        caption={title}
        rows={data?.results}
        rowKey={(item) => item.id}
        loading={!data && !error}
        error={error}
        onRetry={() => void refresh()}
        toolbar={<DataToolbar search={search} onSearchChange={setSearch} searchPlaceholder={`Search ${title.toLowerCase()}…`} />}
        empty={{ title: "No records found", description: search ? "Try a different search term." : undefined, action: !search && createHref && createLabel ? <ButtonLink variant="secondary" href={createHref} leadingIcon={<Plus className="h-4 w-4" />}>{createLabel}</ButtonLink> : undefined }}
        columns={[
          ...columns.map((column) => ({ key: column.label, header: column.label, cell: column.render })),
          { key: "status", header: "Status", cell: (item: T) => <StatusBadge status={item.status} size="sm" /> },
        ]}
      />
    </div>
  );
}
