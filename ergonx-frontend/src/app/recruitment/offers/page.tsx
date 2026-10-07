"use client";

import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import { useCallback } from "react";

import { ButtonLink } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { recruitmentApi } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";

export default function OffersPage() {
  const load = useCallback(() => recruitmentApi.listOffers({ ordering: "-created_at" }), []);
  const { data, loading, error, reload } = useApiResource(load);
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Recruitment" title="Offers" description="Track offer decisions and use the controlled hire workflow for accepted offers." icon={FileSignature} accent="recruitment" actions={<ButtonLink href="/recruitment/offers/new" leadingIcon={<Plus className="h-4 w-4" />}>New offer</ButtonLink>} />
      <DataTable
        caption="Offers"
        rows={data?.results}
        rowKey={(offer) => offer.id}
        loading={loading}
        error={error}
        onRetry={reload}
        minWidth={700}
        empty={{ title: "No offers found", description: "Offers you draft for candidates will appear here.", icon: FileSignature, action: <ButtonLink variant="secondary" href="/recruitment/offers/new" leadingIcon={<Plus className="h-4 w-4" />}>New offer</ButtonLink> }}
        columns={[
          { key: "offer", header: "Offer", cell: (offer) => <Link href={`/recruitment/offers/${offer.id}`} className="font-semibold text-ink-strong hover:underline">Offer <span className="font-mono">{offer.id.slice(0, 8)}</span></Link> },
          { key: "start", header: "Start date", sortValue: (offer) => offer.proposed_start_date, cell: (offer) => formatDate(offer.proposed_start_date) },
          { key: "compensation", header: "Compensation", numeric: true, sortValue: (offer) => Number(offer.base_salary ?? 0), cell: (offer) => (offer.base_salary ? formatAmount(offer.base_salary, offer.currency) : <span className="text-ink-subtle">Not set</span>) },
          { key: "status", header: "Status", cell: (offer) => <StatusBadge status={offer.status} size="sm" /> },
        ]}
      />
    </div>
  );
}
