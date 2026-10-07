"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ListChecks, PlayCircle } from "lucide-react";

import { ButtonLink } from "@/components/ui/Button";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/Field";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { payrollApi } from "@/lib/api";
import { EM_DASH, formatDateTime, humanizeEnum } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { PayrollPeriod } from "@/types/payroll";
import { useAccess } from "@/lib/access";

const ALL = "ALL";
const RUN_STATUSES = ["DRAFT", "CALCULATING", "CALCULATED", "UNDER_REVIEW", "APPROVED", "FINALIZED", "CANCELLED"];

export default function PayrollRunsPage() {
  const { can } = useAccess();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);

  const load = useCallback(
    () =>
      payrollApi.listPayrollRuns({
        page_size: MAX_PAGE_SIZE,
        status: status === ALL ? undefined : status,
        ordering: "-started_at",
      }),
    [status],
  );
  const { data, loading, error, reload } = useApiResource(load);

  useEffect(() => {
    let active = true;
    payrollApi
      .listPayrollPeriods({ page_size: MAX_PAGE_SIZE, ordering: "-start_date" })
      .then((page) => { if (active) setPeriods(page.results); })
      .catch(() => { if (active) setPeriods([]); });
    return () => { active = false; };
  }, []);

  const periodNames = useMemo(() => new Map(periods.map((period) => [period.id, period.name])), [periods]);

  const runs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.results ?? []).filter((run) => {
      const period = periodNames.get(run.payroll_period) ?? "";
      return !query || period.toLowerCase().includes(query) || String(run.run_number).includes(query);
    });
  }, [data, periodNames, search]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payroll" title="Payroll runs" description="Review payroll calculations, approvals and finalised runs." icon={ListChecks} accent="payroll" actions={can("payroll.prepare") ? <ButtonLink href="/payroll/periods" leadingIcon={<PlayCircle className="h-4 w-4" />}>Start from period</ButtonLink> : null} />
      <DataTable
        caption="Payroll runs"
        rows={runs}
        rowKey={(run) => run.id}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        minWidth={640}
        toolbar={
          <DataToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search by period or run number…"
            filters={<Select size="sm" aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)}><option value={ALL}>All statuses</option>{RUN_STATUSES.map((value) => <option key={value} value={value}>{humanizeEnum(value)}</option>)}</Select>}
            onClear={search || status !== ALL ? () => { setSearch(""); setStatus(ALL); } : undefined}
          />
        }
        empty={{ title: "No payroll runs found", description: search || status !== ALL ? "Try a different search or status." : "Start a run from an open payroll period.", icon: ListChecks }}
        columns={[
          { key: "period", header: "Period", sortValue: (run) => periodNames.get(run.payroll_period) ?? "", cell: (run) => <Link href={`/payroll/runs/${run.id}`} className="font-semibold text-ink-strong hover:text-primary-ink">{periodNames.get(run.payroll_period) ?? EM_DASH}</Link> },
          { key: "run", header: "Run", sortValue: (run) => run.run_number, cell: (run) => <span className="font-mono">#{run.run_number}</span> },
          { key: "started", header: "Started", sortValue: (run) => run.started_at ?? "", cell: (run) => formatDateTime(run.started_at) },
          { key: "status", header: "Status", cell: (run) => <StatusBadge status={run.status} size="sm" /> },
          { key: "open", header: <span className="sr-only">Open</span>, cell: (run) => <Link href={`/payroll/runs/${run.id}`} aria-label={`Open run ${run.run_number}`} className="flex justify-end text-ink-subtle hover:text-ink-strong"><ChevronRight className="h-4 w-4" /></Link> },
        ]}
      />
    </div>
  );
}
