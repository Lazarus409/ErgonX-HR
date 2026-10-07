"use client";

import Link from "next/link";
import { History, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { formatDateTime } from "@/components/platform/format";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { DataTable, DataToolbar, Pagination } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Field";
import LoadingState from "@/components/ui/LoadingState";
import { SectionTitle, platformTable } from "@/components/platform/ui";
import { platformApi } from "@/lib/api";
import { auditActionLabel, type PlatformAuditEvent } from "@/lib/api/platform";
import { useApiResource } from "@/lib/useApiResource";
import { DEFAULT_PAGE_SIZE } from "@/types/api";

const actionFilters = [
  { value: "", label: "All actions" },
  { value: "institution", label: "Organizations" },
  { value: "invitation", label: "Invitations" },
  { value: "access_request", label: "Access requests" },
];

function actionTone(action: string): BadgeTone {
  if (action.endsWith(".suspended") || action.endsWith(".revoked") || action.endsWith(".declined")) return "danger";
  if (action.endsWith(".reactivated") || action.endsWith(".approved") || action.endsWith(".created")) return "success";
  return "info";
}

/** Human summary of the useful metadata on an event (never tokens; the API redacts those). */
function eventDetail(event: PlatformAuditEvent) {
  const meta = event.metadata;
  const parts = [meta.email, meta.institution_name, meta.name, meta.reason ? `Reason: ${meta.reason}` : null]
    .filter((part): part is string => typeof part === "string" && part.length > 0);
  return parts.join(" · ");
}

function AuditLog() {
  const router = useRouter();
  const params = useSearchParams();
  const institution = params.get("institution") ?? "";
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(() => platformApi.listAuditEvents({ page, q: query, action, institution }), [page, query, action, institution]);
  const { data, loading, error, reload } = useApiResource(load);
  const scopedName = institution ? data?.results.find((event) => event.institution?.id === institution)?.institution?.name : null;

  return (
    <>
      <DataTable<PlatformAuditEvent>
        className={platformTable}
        caption="Platform audit log"
        rows={data?.results}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        rowKey={(event) => event.id}
        minWidth={880}
        toolbar={
          <div className="space-y-4">
          <SectionTitle eyebrow="Accountability" title="Audit log" description="Every action a Super Admin has taken on the platform, and each organization sign-up. Entries cannot be edited or deleted." meta={data ? `${data.count} event${data.count === 1 ? "" : "s"}` : undefined} />
          <DataToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search admin, organization or detail…"
            filters={
              <>
                <Select aria-label="Action type" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}>
                  {actionFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
                {institution && (
                  <button type="button" onClick={() => router.replace("/platform/audit")} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-support font-semibold text-primary-ink">
                    {scopedName ?? "One organization"}<X className="h-3.5 w-3.5" aria-label="Show all organizations" />
                  </button>
                )}
              </>
            }
          />
          </div>
        }
        empty={{ title: "No platform activity yet", description: "Suspensions, invitations and request decisions appear here as they happen.", icon: History }}
        footer={data && data.count > DEFAULT_PAGE_SIZE ? <Pagination page={page} pageSize={DEFAULT_PAGE_SIZE} total={data.count} onPageChange={setPage} /> : undefined}
        columns={[
          { key: "when", header: "When", cell: (event) => <span className="whitespace-nowrap">{formatDateTime(event.created_at)}</span> },
          { key: "action", header: "Action", cell: (event) => <Badge size="sm" tone={actionTone(event.action)}>{auditActionLabel(event.action)}</Badge> },
          { key: "actor", header: "By", cell: (event) => event.actor_email ?? <span className="text-ink-subtle">System</span> },
          {
            key: "organization",
            header: "Organization",
            hideBelow: "md",
            cell: (event) => event.institution
              ? <Link className="font-semibold text-primary-ink hover:underline" href={`/platform/organizations/${event.institution.id}`}>{event.institution.name}</Link>
              : <span className="text-ink-subtle">—</span>,
          },
          { key: "detail", header: "Detail", hideBelow: "lg", cell: (event) => <span className="text-ink-muted">{eventDetail(event) || "—"}</span> },
          { key: "ip", header: "IP address", hideBelow: "xl", cell: (event) => <span className="font-mono text-caption">{event.ip_address ?? "—"}</span> },
        ]}
      />
    </>
  );
}

export default function PlatformAuditPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AuditLog />
    </Suspense>
  );
}
