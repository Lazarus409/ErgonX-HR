"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  Filter,
  Search,
  XCircle,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import {
  attendanceApi,
  employeesApi,
  getApiErrorMessage,
  organizationApi,
} from "@/lib/api";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, emptyPage } from "@/types/api";
import type { PaginatedData } from "@/types/api";
import type {
  AttendanceAdjustment,
  AttendanceRecord,
} from "@/types/attendance";
import type { Department, Employee, Employment } from "@/types/hr";
import { EM_DASH, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const ALL = "ALL";
const SEARCH_DEBOUNCE_MS = 350;


interface Reference {
  employees: Map<string, Employee>;
  employments: Map<string, Employment>;
  departments: Department[];
  attendance: Map<string, AttendanceRecord>;
}

const emptyReference: Reference = {
  employees: new Map(),
  employments: new Map(),
  departments: [],
  attendance: new Map(),
};

/**
 * `old_values` and `proposed_values` are free-form JSON limited by the backend
 * to `check_in`, `check_out` and `notes`. Datetimes arrive as ISO strings.
 */
function adjustmentTime(values: Record<string, unknown>, key: string): string {
  const value = values?.[key];

  if (value === null || value === undefined || value === "") {
    return EM_DASH;
  }

  const parsed = new Date(String(value));

  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AttendanceAdjustmentsPage() {
  const [data, setData] = useState<PaginatedData<AttendanceAdjustment>>(() =>
    emptyPage<AttendanceAdjustment>(),
  );
  const [reference, setReference] = useState<Reference>(emptyReference);
  const [totals, setTotals] = useState<{
    pending: number;
    approved: number;
    rejected: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [departmentFilter, setDepartmentFilter] = useState(ALL);
  const [page, setPage] = useState(1);


  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;

    async function loadReference() {
      try {
        const [
          employeeIndex,
          employmentIndex,
          departments,
          pending,
          approved,
          rejected,
        ] = await Promise.all([
          employeesApi.loadEmployeeIndex(),
          employeesApi.loadCurrentEmploymentIndex(),
          organizationApi.listDepartments({
            page_size: MAX_PAGE_SIZE,
            ordering: "name",
          }),
          attendanceApi
            .listAttendanceAdjustments({ status: "PENDING", page_size: 1 })
            .then((result) => result.count),
          attendanceApi
            .listAttendanceAdjustments({ status: "APPROVED", page_size: 1 })
            .then((result) => result.count),
          attendanceApi
            .listAttendanceAdjustments({ status: "REJECTED", page_size: 1 })
            .then((result) => result.count),
        ]);

        if (!active) {
          return;
        }

        setReference((current) => ({
          ...current,
          employees: employeeIndex.byId,
          employments: employmentIndex.byEmployee,
          departments: departments.results,
        }));

        setTotals({ pending, approved, rejected });
      } catch {
        if (active) {
          setTotals(null);
        }
      }
    }

    loadReference();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    let active = true;

    async function loadAdjustments() {
      setLoading(true);
      setError(null);

      try {
        const result = await attendanceApi.listAttendanceAdjustments({
          page,
          page_size: DEFAULT_PAGE_SIZE,
          ordering: "-created_at",
          status: statusFilter === ALL ? undefined : statusFilter,
        });

        if (!active || requestRef.current !== requestId) {
          return;
        }

        setData(result);

        const attendanceIds = Array.from(
          new Set(result.results.map((item) => item.attendance_record)),
        );

        const records = await Promise.all(
          attendanceIds.map((id) =>
            attendanceApi.getAttendanceRecord(id).catch(() => null),
          ),
        );

        if (!active || requestRef.current !== requestId) {
          return;
        }

        setReference((current) => {
          const next = new Map(current.attendance);

          for (const record of records) {
            if (record) {
              next.set(record.id, record);
            }
          }

          return { ...current, attendance: next };
        });
      } catch (caught) {
        if (!active || requestRef.current !== requestId) {
          return;
        }

        setError(getApiErrorMessage(caught));
        setData(emptyPage<AttendanceAdjustment>());
      } finally {
        if (active && requestRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadAdjustments();

    return () => {
      active = false;
    };
  }, [page, statusFilter, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const describe = useCallback(
    (adjustment: AttendanceAdjustment) => {
      const attendance = reference.attendance.get(adjustment.attendance_record);
      const employee = attendance
        ? reference.employees.get(attendance.employee)
        : undefined;
      const employment = attendance
        ? reference.employments.get(attendance.employee)
        : undefined;

      return {
        name: employee ? employeesApi.employeeDisplayName(employee) : EM_DASH,
        number: employee?.employee_number ?? EM_DASH,
        departmentId: employment?.department ?? null,
        department:
          reference.departments.find(
            (item) => item.id === employment?.department,
          )?.name ?? EM_DASH,
        date: attendance ? formatDate(attendance.attendance_date) : EM_DASH,
      };
    },
    [reference],
  );

  /** The endpoint filters on attendance_record, requested_by and status only. */
  const filteredAdjustments = useMemo(() => {
    return data.results.filter((adjustment) => {
      const info = describe(adjustment);

      const matchesSearch =
        !debouncedSearch ||
        info.name.toLowerCase().includes(debouncedSearch) ||
        info.number.toLowerCase().includes(debouncedSearch);

      const matchesDepartment =
        departmentFilter === ALL || info.departmentId === departmentFilter;

      return matchesSearch && matchesDepartment;
    });
  }, [data.results, debouncedSearch, departmentFilter, describe]);

  const totalPages = Math.max(1, Math.ceil(data.count / DEFAULT_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Adjustments"
        description="Review requested corrections to attendance records."
      />

      {error && <ErrorState message={error} onRetry={reload} />}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          icon={<AlertCircle className="h-5 w-5" />}
          label="Pending"
          value={totals ? formatNumber(totals.pending) : EM_DASH}
          detail="Awaiting review"
        />

        <SummaryCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Approved"
          value={totals ? formatNumber(totals.approved) : EM_DASH}
          detail="Approved requests"
        />

        <SummaryCard
          icon={<XCircle className="h-5 w-5" />}
          label="Rejected"
          value={totals ? formatNumber(totals.rejected) : EM_DASH}
          detail="Rejected requests"
        />
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee or employee number..."
              className="w-full h-9 rounded-lg border border-line-strong pl-10 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>

          <select
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.target.value)}
            aria-label="Filter by department / functional area"
            className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none"
          >
            <option value={ALL}>All Departments</option>

            {reference.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>

          <SegmentedControl
            label="Filter by status"
            value={statusFilter}
            onChange={(next) => {
              setStatusFilter(next);
              setPage(1);
            }}
            options={[{ value: ALL, label: "All" }, { value: "DRAFT", label: "Draft" }, { value: "PENDING", label: "Pending" }, { value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }]}
          />

          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatusFilter(ALL);
              setDepartmentFilter(ALL);
              setPage(1);
            }}
            className={buttonClasses({ variant: "secondary" })}
          >
            <Filter className="h-4 w-4" />
            Clear
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Employee
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Date
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Original
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Proposed
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Requested
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Status
                </th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Action
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line-soft">
              {filteredAdjustments.map((adjustment) => {
                const info = describe(adjustment);

                return (
                  <tr key={adjustment.id} className="hover:bg-surface-hover">
                    <td className="px-5 py-4">
                      <p className="font-medium text-ink-strong">{info.name}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {info.number} · {info.department}
                      </p>
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 text-sm text-ink">
                        <CalendarDays className="h-4 w-4 text-ink-subtle" />
                        {info.date}
                      </div>
                    </td>

                    <td className="px-5 py-4 text-sm text-ink">
                      {adjustmentTime(adjustment.old_values, "check_in")} –{" "}
                      {adjustmentTime(adjustment.old_values, "check_out")}
                    </td>

                    <td className="px-5 py-4 text-sm font-medium text-ink-strong">
                      {adjustmentTime(adjustment.proposed_values, "check_in")} –{" "}
                      {adjustmentTime(adjustment.proposed_values, "check_out")}
                    </td>

                    <td className="px-5 py-4 text-sm text-ink">
                      {formatDateTime(adjustment.created_at)}
                    </td>

                    <td className="px-5 py-4">
                      <StatusBadge status={adjustment.status} />
                    </td>

                    <td className="px-5 py-4 text-right">
                      <Link
                        href={`/attendance/adjustments/${adjustment.id}`}
                        className={buttonClasses({ variant: "secondary", size: "sm" })}
                      >
                        <Eye className="h-4 w-4" />
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}

              {filteredAdjustments.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <p className="text-sm font-medium text-ink">
                      {loading
                        ? "Loading adjustments..."
                        : "No attendance adjustments found"}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {loading
                        ? "Please wait."
                        : "No correction requests match these filters."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <p className="text-xs text-ink-muted">
            Page {page} of {totalPages} · {data.count} records
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || !data.previous}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Previous
            </button>

            <button
              type="button"
              onClick={() => setPage((current) => current + 1)}
              disabled={loading || !data.next}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-surface-muted px-5 py-4">
        <div className="flex items-start gap-3">
          <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />

          <div>
            <p className="text-sm font-semibold text-ink">
              Historical attendance integrity
            </p>

            <p className="mt-1 text-sm leading-6 text-ink-muted">
              An approved adjustment represents a controlled correction to an
              attendance record. The original values are retained on the
              adjustment so the change stays auditable.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-surface-sunken p-2 text-ink-muted">{icon}</div>

        <p className="text-sm font-medium text-ink-muted">{label}</p>
      </div>

      <p className="mt-4 text-2xl font-semibold text-ink-strong">{value}</p>

      <p className="mt-1 text-xs text-ink-muted">{detail}</p>
    </div>
  );
}
