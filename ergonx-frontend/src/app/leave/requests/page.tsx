"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";

import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import { employeesApi, getApiErrorMessage, leaveApi } from "@/lib/api";
import { DEFAULT_PAGE_SIZE, emptyPage } from "@/types/api";
import type { PaginatedData } from "@/types/api";
import type { Employee } from "@/types/hr";
import type { LeaveRequest, LeaveType } from "@/types/leave";
import { EM_DASH, formatDate, formatNumber } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";

const ALL = "ALL";
const SEARCH_DEBOUNCE_MS = 350;

interface StatusTotals {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export default function LeaveRequestsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [leaveType, setLeaveType] = useState(ALL);
  const [employee, setEmployee] = useState(ALL);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<PaginatedData<LeaveRequest>>(() =>
    emptyPage<LeaveRequest>(),
  );
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [totals, setTotals] = useState<StatusTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [search]);

  // Filter options and the unfiltered status totals shown in the summary row.
  useEffect(() => {
    let active = true;

    async function loadReferenceData() {
      try {
        const [types, employeeIndex, all, pending, approved, rejected] =
          await Promise.all([
            leaveApi.listLeaveTypes({ page_size: 100, ordering: "name" }),
            employeesApi.loadEmployeeIndex(),
            // page_size 1: only the envelope `count` is needed.
            leaveApi.listLeaveRequests({ page_size: 1 }),
            leaveApi.listLeaveRequests({ page_size: 1, status: "PENDING" }),
            leaveApi.listLeaveRequests({ page_size: 1, status: "APPROVED" }),
            leaveApi.listLeaveRequests({ page_size: 1, status: "REJECTED" }),
          ]);

        if (!active) {
          return;
        }

        setLeaveTypes(types.results);
        setEmployees(Array.from(employeeIndex.byId.values()));
        setTotals({
          total: all.count,
          pending: pending.count,
          approved: approved.count,
          rejected: rejected.count,
        });
      } catch {
        if (active) {
          setLeaveTypes([]);
          setEmployees([]);
          setTotals(null);
        }
      }
    }

    loadReferenceData();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    let active = true;

    async function loadRequests() {
      setLoading(true);
      setError(null);

      try {
        const result = await leaveApi.listLeaveRequests({
          page,
          page_size: DEFAULT_PAGE_SIZE,
          ordering: "-start_date",
          search: debouncedSearch || undefined,
          status: status === ALL ? undefined : status,
          leave_type: leaveType === ALL ? undefined : leaveType,
          employee: employee === ALL ? undefined : employee,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
        });

        if (!active || requestRef.current !== requestId) {
          return;
        }

        setData(result);
      } catch (caught) {
        if (!active || requestRef.current !== requestId) {
          return;
        }

        setError(getApiErrorMessage(caught));
        setData(emptyPage<LeaveRequest>());
      } finally {
        if (active && requestRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadRequests();

    return () => {
      active = false;
    };
  }, [
    page,
    debouncedSearch,
    status,
    leaveType,
    employee,
    startDate,
    endDate,
    reloadToken,
  ]);

  const employeeNames = useMemo(
    () =>
      new Map(
        employees.map((item) => [
          item.id,
          employeesApi.employeeDisplayName(item),
        ]),
      ),
    [employees],
  );

  const employeeNumbers = useMemo(
    () => new Map(employees.map((item) => [item.id, item.employee_number])),
    [employees],
  );

  const leaveTypeNames = useMemo(
    () => new Map(leaveTypes.map((item) => [item.id, item.name])),
    [leaveTypes],
  );

  const resetFilters = useCallback(() => {
    setSearch("");
    setStatus(ALL);
    setLeaveType(ALL);
    setEmployee(ALL);
    setStartDate("");
    setEndDate("");
    setPage(1);
  }, []);

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const requests = data.results;
  const summaryPlaceholder = totals === null ? EM_DASH : null;

  return (
    <>
      <PageHeader
        title="Leave Requests"
        description="Review and manage employee leave requests."
      />

      <div className="mt-6 space-y-6">
        {/* Management summary */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              Total Requests
            </p>
            <p className="mt-2 text-2xl font-semibold text-ink-strong">
              {summaryPlaceholder ?? formatNumber(totals?.total)}
            </p>
          </div>

          <div className="rounded-xl border border-warning/30 bg-warning-soft p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-warning-ink">
              Pending
            </p>
            <p className="mt-2 text-2xl font-semibold text-warning-ink">
              {summaryPlaceholder ?? formatNumber(totals?.pending)}
            </p>
          </div>

          <div className="rounded-xl border border-success/25 bg-success-soft p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-success-ink">
              Approved
            </p>
            <p className="mt-2 text-2xl font-semibold text-success-ink">
              {summaryPlaceholder ?? formatNumber(totals?.approved)}
            </p>
          </div>

          <div className="rounded-xl border border-danger/25 bg-danger-soft p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-danger-ink">
              Rejected
            </p>
            <p className="mt-2 text-2xl font-semibold text-danger-ink">
              {summaryPlaceholder ?? formatNumber(totals?.rejected)}
            </p>
          </div>
        </div>

        {/* Filters */}
        <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <div className="grid gap-3 lg:grid-cols-6">
            <div className="relative lg:col-span-2">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
              />

              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee name or number..."
                className="w-full h-9 rounded-lg border border-line-strong pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </div>

            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
            >
              <option value={ALL}>All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>

            <select
              value={leaveType}
              onChange={(event) => {
                setLeaveType(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
            >
              <option value={ALL}>All leave types</option>

              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>

            <select
              value={employee}
              onChange={(event) => {
                setEmployee(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
            >
              <option value={ALL}>All employees</option>

              {employees.map((item) => (
                <option key={item.id} value={item.id}>
                  {employeesApi.employeeDisplayName(item)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={resetFilters}
              className={buttonClasses({ variant: "secondary" })}
            >
              <X size={16} />
              Clear
            </button>
          </div>

          {/*
            The list endpoint filters `start_date` and `end_date` by exact
            match; it exposes no range lookup, so these are exact-date filters
            rather than a from/to window.
          */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="filter-start-date"
                className="mb-1.5 block text-xs font-medium text-ink-muted"
              >
                Start date
              </label>

              <input
                id="filter-start-date"
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label
                htmlFor="filter-end-date"
                className="mb-1.5 block text-xs font-medium text-ink-muted"
              >
                End date
              </label>

              <input
                id="filter-end-date"
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setPage(1);
                }}
                className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
        </section>

        {/* Requests */}
        <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-sm font-bold text-headline">
              Employee Leave Requests
            </h2>

            <p className="mt-1 text-xs text-ink-muted">
              Review submitted requests and take authorised workflow actions.
            </p>
          </div>

          {error ? (
            <div className="p-8">
              <ErrorState message={error} onRetry={retry} />
            </div>
          ) : loading ? (
            <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-primary" />

              <p className="mt-4 text-sm text-ink-muted">
                Loading leave requests...
              </p>
            </div>
          ) : requests.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="No leave requests found"
                description="Try changing your filters."
              />
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line bg-surface-muted">
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        Employee
                      </th>

                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        Leave Type
                      </th>

                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        Period
                      </th>

                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        Days
                      </th>

                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        Status
                      </th>

                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {requests.map((request) => (
                      <tr
                        key={request.id}
                        className="border-b border-line-soft last:border-0"
                      >
                        <td className="px-5 py-4">
                          <Link
                            href={`/leave/requests/${request.id}`}
                            className="font-medium text-ink-strong hover:underline"
                          >
                            {employeeNames.get(request.employee) ?? EM_DASH}
                          </Link>

                          <p className="mt-0.5 text-xs text-ink-subtle">
                            {employeeNumbers.get(request.employee) ?? EM_DASH}
                          </p>
                        </td>

                        <td className="px-5 py-4 text-sm text-ink-muted">
                          {leaveTypeNames.get(request.leave_type) ?? EM_DASH}
                        </td>

                        <td className="px-5 py-4 text-sm text-ink-muted">
                          {formatDate(request.start_date)} -{" "}
                          {formatDate(request.end_date)}
                        </td>

                        <td className="px-5 py-4 text-sm font-medium text-ink">
                          {formatNumber(request.requested_days)}
                        </td>

                        <td className="px-5 py-4">
                          <StatusBadge status={request.status} />
                        </td>

                        <td className="px-5 py-4 text-right">
                          <Link
                            href={`/leave/requests/${request.id}`}
                            className={buttonClasses({ variant: "secondary", size: "sm" })}
                          >
                            <Eye size={14} />
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile */}
              <div className="divide-y divide-line-soft md:hidden">
                {requests.map((request) => (
                  <div key={request.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/leave/requests/${request.id}`}
                          className="font-medium text-ink-strong"
                        >
                          {employeeNames.get(request.employee) ?? EM_DASH}
                        </Link>

                        <p className="mt-0.5 text-xs text-ink-subtle">
                          {employeeNumbers.get(request.employee) ?? EM_DASH}
                        </p>
                      </div>

                      <StatusBadge status={request.status} />
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-ink-subtle">Leave Type</p>
                        <p className="mt-1 text-ink">
                          {leaveTypeNames.get(request.leave_type) ?? EM_DASH}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-ink-subtle">Days</p>
                        <p className="mt-1 text-ink">
                          {formatNumber(request.requested_days)}
                        </p>
                      </div>

                      <div className="col-span-2">
                        <p className="text-xs text-ink-subtle">Period</p>
                        <p className="mt-1 text-ink">
                          {formatDate(request.start_date)} -{" "}
                          {formatDate(request.end_date)}
                        </p>
                      </div>
                    </div>

                    <Link
                      href={`/leave/requests/${request.id}`}
                      className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-ink"
                    >
                      <Eye size={15} />
                      Review request
                    </Link>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-line px-5 py-3">
                <p className="text-xs text-ink-muted">
                  Showing {requests.length} of {data.count}
                </p>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={loading || !data.previous}
                    aria-label="Previous page"
                    className="rounded-md border border-line p-1.5 text-ink-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent"
                  >
                    <ChevronLeft size={16} />
                  </button>

                  <span className="px-2 text-xs font-medium text-ink-muted">
                    {page}
                  </span>

                  <button
                    type="button"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={loading || !data.next}
                    aria-label="Next page"
                    className="rounded-md border border-line p-1.5 text-ink-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
