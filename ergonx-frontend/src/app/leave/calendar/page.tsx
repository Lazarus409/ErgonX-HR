"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Users,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import ErrorState from "@/components/ui/ErrorState";
import {
  employeesApi,
  getApiErrorMessage,
  leaveApi,
  organizationApi,
} from "@/lib/api";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { Department, Employee, Employment } from "@/types/hr";
import type { LeaveRequest, LeaveType } from "@/types/leave";
import { toISODate } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";

const ALL = "ALL";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isDateInRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);

  // Convert JavaScript Sunday-first index to Monday-first.
  const mondayIndex = (firstDay.getDay() + 6) % 7;

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const previousMonthDays = new Date(year, month, 0).getDate();

  const cells: Array<{
    date: Date;
    currentMonth: boolean;
  }> = [];

  for (let i = mondayIndex - 1; i >= 0; i--) {
    cells.push({
      date: new Date(year, month - 1, previousMonthDays - i),
      currentMonth: false,
    });
  }

  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      date: new Date(year, month, day),
      currentMonth: true,
    });
  }

  let nextDay = 1;

  while (cells.length < 42) {
    cells.push({
      date: new Date(year, month + 1, nextDay),
      currentMonth: false,
    });

    nextDay++;
  }

  return cells;
}

interface CalendarReference {
  employees: Map<string, Employee>;
  employments: Map<string, Employment>;
  departments: Department[];
  leaveTypes: LeaveType[];
}

const emptyReference: CalendarReference = {
  employees: new Map(),
  employments: new Map(),
  departments: [],
  leaveTypes: [],
};

export default function LeaveCalendarPage() {
  const today = useMemo(() => new Date(), []);

  const [currentDate, setCurrentDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const [department, setDepartment] = useState(ALL);
  const [leaveType, setLeaveType] = useState(ALL);

  const [events, setEvents] = useState<LeaveRequest[]>([]);
  const [reference, setReference] = useState<CalendarReference>(emptyReference);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const days = useMemo(() => getMonthDays(year, month), [year, month]);

  // The visible grid spans six weeks, so the request covers the whole grid
  // rather than just the calendar month.
  const rangeStart = days.length > 0 ? toISODate(days[0].date) : "";
  const rangeEnd = days.length > 0 ? toISODate(days[days.length - 1].date) : "";

  useEffect(() => {
    let active = true;

    async function loadReference() {
      try {
        const [employeeIndex, employmentIndex, departments, types] =
          await Promise.all([
            employeesApi.loadEmployeeIndex(),
            employeesApi.loadCurrentEmploymentIndex(),
            organizationApi.listDepartments({
              page_size: MAX_PAGE_SIZE,
              ordering: "name",
            }),
            leaveApi.listLeaveTypes({
              page_size: MAX_PAGE_SIZE,
              ordering: "name",
            }),
          ]);

        if (!active) {
          return;
        }

        setReference({
          employees: employeeIndex.byId,
          employments: employmentIndex.byEmployee,
          departments: departments.results,
          leaveTypes: types.results,
        });
      } catch {
        if (active) {
          setReference(emptyReference);
        }
      }
    }

    loadReference();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!rangeStart || !rangeEnd) {
      return;
    }

    let active = true;

    async function loadCalendar() {
      setLoading(true);
      setError(null);

      try {
        // The calendar action returns PENDING and APPROVED requests
        // overlapping the range.
        const result = await leaveApi.getLeaveCalendar({
          date_from: rangeStart,
          date_to: rangeEnd,
          page_size: MAX_PAGE_SIZE,
          leave_type: leaveType === ALL ? undefined : leaveType,
        });

        if (active) {
          setEvents(result.results);
        }
      } catch (caught) {
        if (active) {
          setError(getApiErrorMessage(caught));
          setEvents([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadCalendar();

    return () => {
      active = false;
    };
  }, [rangeStart, rangeEnd, leaveType, reloadToken]);

  /**
   * Leave requests carry no department. It is resolved through the employee's
   * current employment record, so this filter is applied client-side.
   */
  const filteredEvents = useMemo(() => {
    if (department === ALL) {
      return events;
    }

    return events.filter(
      (event) =>
        reference.employments.get(event.employee)?.department === department,
    );
  }, [events, department, reference.employments]);

  const leaveTypeNames = useMemo(
    () => new Map(reference.leaveTypes.map((type) => [type.id, type.name])),
    [reference.leaveTypes],
  );

  const previousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const todayString = toISODate(today);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Calendar"
        description="View approved and pending employee leave across the institution."
      />

      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={previousMonth}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink-muted hover:bg-surface-hover"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <button
            onClick={nextMonth}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink-muted hover:bg-surface-hover"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <button
            onClick={goToToday}
            className={buttonClasses({ variant: "secondary" })}
          >
            Today
          </button>

          <div className="ml-1 flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-ink-muted" />
            <h2 className="text-lg font-bold text-headline">
              {monthNames[month]} {year}
            </h2>
          </div>

          {loading && (
            <span className="text-xs text-ink-subtle">Loading...</span>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            aria-label="Filter by department / functional area"
            className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-primary"
          >
            <option value={ALL}>All Departments</option>

            {reference.departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <select
            value={leaveType}
            onChange={(event) => setLeaveType(event.target.value)}
            aria-label="Filter by leave type"
            className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none focus:border-primary"
          >
            <option value={ALL}>All Types</option>

            {reference.leaveTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={retry} />}

      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
        <div className="grid grid-cols-7 border-b border-line bg-surface-muted">
          {weekDays.map((day) => (
            <div
              key={day}
              className="border-r border-line px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted last:border-r-0"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map(({ date, currentMonth }, index) => {
            const dateString = toISODate(date);

            const dayEvents = filteredEvents.filter((event) =>
              isDateInRange(dateString, event.start_date, event.end_date),
            );

            const isToday = dateString === todayString;

            return (
              <div
                key={`${dateString}-${index}`}
                className={`min-h-[145px] border-r border-b border-line p-2 last:border-r-0 ${
                  currentMonth ? "bg-surface" : "bg-surface-muted/70"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                      isToday
                        ? "bg-primary font-semibold text-white"
                        : currentMonth
                          ? "text-ink"
                          : "text-ink-subtle"
                    }`}
                  >
                    {date.getDate()}
                  </span>

                  {dayEvents.length > 0 && (
                    <span className="text-xs text-ink-subtle">
                      {dayEvents.length}
                    </span>
                  )}
                </div>

                <div className="space-y-1.5">
                  {dayEvents.map((event) => {
                    const employee = reference.employees.get(event.employee);

                    return (
                      <Link
                        key={event.id}
                        href={`/leave/requests/${event.id}`}
                        className={`block rounded-md border px-2 py-1.5 text-left transition hover:shadow-sm ${
                          event.status === "APPROVED"
                            ? "border-line bg-surface-muted"
                            : "border-warning/30 bg-warning-soft"
                        }`}
                      >
                        <p className="truncate text-xs font-semibold text-ink">
                          {employee
                            ? employeesApi.employeeDisplayName(employee)
                            : "Employee"}
                        </p>
                        <p className="truncate text-[11px] text-ink-muted">
                          {leaveTypeNames.get(event.leave_type) ?? "Leave"}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="h-3 w-3 rounded-sm bg-line" />
          Approved Leave
        </div>

        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span className="h-3 w-3 rounded-sm bg-warning-soft ring-1 border-warning/30" />
          Pending Leave
        </div>

        <div className="ml-auto flex items-center gap-2 text-sm text-ink-muted">
          <Users className="h-4 w-4" />
          {filteredEvents.length} leave request
          {filteredEvents.length !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
