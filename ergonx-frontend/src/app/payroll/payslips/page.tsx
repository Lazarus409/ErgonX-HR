"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Avatar } from "@/components/ui/Card";
import { DataTable, DataToolbar } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import { employeesApi, payrollApi } from "@/lib/api";
import { EM_DASH, formatAmount, formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/useApiResource";
import { MAX_PAGE_SIZE } from "@/types/api";

export default function PayrollPayslipsPage() {
  const [search, setSearch] = useState("");
  const load = useCallback(async () => Promise.all([payrollApi.listPayslips({ page_size: MAX_PAGE_SIZE, ordering: "-generated_at" }), payrollApi.listPayrollRecords({ page_size: MAX_PAGE_SIZE }), payrollApi.listPayrollRuns({ page_size: MAX_PAGE_SIZE }), payrollApi.listPayrollPeriods({ page_size: MAX_PAGE_SIZE }), employeesApi.loadEmployeeIndex()]), []);
  const { data, loading, error, reload } = useApiResource(load);
  const rows = useMemo(() => {
    if (!data) return [];
    const [payslips, records, runs, periods, employees] = data;
    const recordById = new Map(records.results.map((item) => [item.id, item]));
    const runById = new Map(runs.results.map((item) => [item.id, item]));
    const periodById = new Map(periods.results.map((item) => [item.id, item]));
    return payslips.results.map((item) => {
      const record = recordById.get(item.payroll_record);
      const run = record ? runById.get(record.payroll_run) : undefined;
      const employee = record ? employees.byId.get(record.employee) : undefined;
      return { payslip: item, record, employeeName: employee ? employeesApi.employeeDisplayName(employee) : EM_DASH, employeeNumber: employee?.employee_number ?? EM_DASH, period: run ? periodById.get(run.payroll_period)?.name ?? EM_DASH : EM_DASH };
    });
  }, [data]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => !query || row.employeeName.toLowerCase().includes(query) || row.employeeNumber.toLowerCase().includes(query) || row.period.toLowerCase().includes(query));
  }, [rows, search]);
  type Row = (typeof rows)[number];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Payroll" title="Payslips" description="View employee payslips generated from completed payroll runs." icon={FileText} accent="payroll" />
      <DataTable<Row>
        caption="Payslips"
        rows={filtered}
        rowKey={(row) => row.payslip.id}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        minWidth={860}
        toolbar={<DataToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Search employee or payroll period…" />}
        empty={{ title: "No payslips found", description: search ? "Try a different search term." : "Payslips are generated when a payroll run is finalized.", icon: FileText }}
        columns={[
          { key: "employee", header: "Employee", sortValue: (row) => row.employeeName, cell: (row) => <span className="flex items-center gap-3"><Avatar name={row.employeeName} size="sm" /><span className="min-w-0"><span className="block truncate font-semibold text-ink-strong">{row.employeeName}</span><span className="block text-caption text-ink-muted">{row.employeeNumber}</span></span></span> },
          { key: "period", header: "Period", sortValue: (row) => row.period, cell: (row) => row.period },
          { key: "gross", header: "Gross", numeric: true, sortValue: (row) => Number(row.payslip.payload.gross_pay), cell: (row) => formatAmount(row.payslip.payload.gross_pay, row.payslip.payload.currency) },
          { key: "deductions", header: "Deductions", numeric: true, hideBelow: "lg", sortValue: (row) => Number(row.payslip.payload.total_deductions), cell: (row) => formatAmount(row.payslip.payload.total_deductions, row.payslip.payload.currency) },
          { key: "net", header: "Net pay", numeric: true, sortValue: (row) => Number(row.payslip.payload.net_pay), cell: (row) => <span className="font-semibold text-ink-strong">{formatAmount(row.payslip.payload.net_pay, row.payslip.payload.currency)}</span> },
          { key: "generated", header: "Generated", sortValue: (row) => row.payslip.generated_at, cell: (row) => <span className="flex flex-col items-start gap-1"><StatusBadge status="FINALIZED" size="sm" /><span className="text-caption text-ink-muted">{formatDate(row.payslip.generated_at)}</span></span> },
          { key: "view", header: <span className="sr-only">Actions</span>, cell: (row) => <div className="flex justify-end"><Link href={`/payroll/payslips/${row.payslip.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-support font-semibold text-primary-ink hover:bg-primary-soft"><FileText className="h-4 w-4" aria-hidden="true" />View</Link></div> },
        ]}
      />
    </div>
  );
}
