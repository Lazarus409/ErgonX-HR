"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Check,
  Clock3,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import {
  employeesApi,
  getApiErrorMessage,
  schedulingApi,
} from "@/lib/api";
import { MAX_PAGE_SIZE } from "@/types/api";
import { SCHEDULE_TYPES } from "@/types/attendance";
import type {
  FlexibleWorkRule,
  RotationPattern,
  ScheduleAssignment,
  ScheduleType,
  Shift,
  ShiftPattern,
  WorkSchedule,
} from "@/types/attendance";
import type { Employee } from "@/types/hr";
import { formatDate, humanizeEnum, toISODate } from "@/lib/format";
import { IconButton, buttonClasses } from "@/components/ui/Button";
import { Menu, MenuItem } from "@/components/ui/Overlay";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const ALL = "ALL";

interface ScheduleForm {
  name: string;
  code: string;
  scheduleType: ScheduleType;
  fixedShift: string;
  shiftPattern: string;
  rotationPattern: string;
  flexibleRule: string;
  effectiveFrom: string;
  effectiveTo: string;
  timezone: string;
  isActive: boolean;
}

function newForm(): ScheduleForm {
  return {
    name: "",
    code: "",
    scheduleType: "FIXED",
    fixedShift: "",
    shiftPattern: "",
    rotationPattern: "",
    flexibleRule: "",
    effectiveFrom: toISODate(new Date()),
    effectiveTo: "",
    timezone: "Africa/Accra",
    isActive: true,
  };
}

interface Reference {
  shifts: Shift[];
  shiftPatterns: ShiftPattern[];
  rotationPatterns: RotationPattern[];
  flexibleRules: FlexibleWorkRule[];
  employees: Employee[];
  assignments: ScheduleAssignment[];
}

const emptyReference: Reference = {
  shifts: [],
  shiftPatterns: [],
  rotationPatterns: [],
  flexibleRules: [],
  employees: [],
  assignments: [],
};

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [reference, setReference] = useState<Reference>(emptyReference);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WorkSchedule | null>(null);
  const [form, setForm] = useState<ScheduleForm>(newForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [assignFor, setAssignFor] = useState<WorkSchedule | null>(null);
  const [selectedEmployees, setSelectedEmployees] = useState<Set<string>>(
    new Set(),
  );
  const [assignFrom, setAssignFrom] = useState(toISODate(new Date()));
  const [employeeSearch, setEmployeeSearch] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [
          schedulePage,
          shifts,
          shiftPatterns,
          rotationPatterns,
          flexibleRules,
          employeeIndex,
          assignments,
        ] = await Promise.all([
          schedulingApi.listWorkSchedules({
            page_size: MAX_PAGE_SIZE,
            ordering: "name",
          }),
          schedulingApi.listShifts({ page_size: MAX_PAGE_SIZE, ordering: "name" }),
          schedulingApi.listShiftPatterns({
            page_size: MAX_PAGE_SIZE,
            ordering: "name",
          }),
          schedulingApi.listRotationPatterns({
            page_size: MAX_PAGE_SIZE,
            ordering: "name",
          }),
          schedulingApi.listFlexibleWorkRules({
            page_size: MAX_PAGE_SIZE,
            ordering: "name",
          }),
          employeesApi.loadEmployeeIndex(),
          schedulingApi.listScheduleAssignments({
            page_size: MAX_PAGE_SIZE,
            is_current: true,
          }),
        ]);

        if (!active) {
          return;
        }

        setSchedules(schedulePage.results);
        setReference({
          shifts: shifts.results,
          shiftPatterns: shiftPatterns.results,
          rotationPatterns: rotationPatterns.results,
          flexibleRules: flexibleRules.results,
          employees: Array.from(employeeIndex.byId.values()),
          assignments: assignments.results,
        });
      } catch (caught) {
        if (active) {
          setError(getApiErrorMessage(caught));
          setSchedules([]);
          setReference(emptyReference);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  /** Current assignments per schedule, used for the employee counts. */
  const assignedCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const assignment of reference.assignments) {
      counts.set(
        assignment.work_schedule,
        (counts.get(assignment.work_schedule) ?? 0) + 1,
      );
    }

    return counts;
  }, [reference.assignments]);

  const filteredSchedules = useMemo(() => {
    const value = search.trim().toLowerCase();

    return schedules.filter((schedule) => {
      const matchesSearch =
        !value ||
        schedule.name.toLowerCase().includes(value) ||
        schedule.code.toLowerCase().includes(value);

      const matchesType =
        typeFilter === ALL || schedule.schedule_type === typeFilter;

      const matchesStatus =
        statusFilter === ALL ||
        (statusFilter === "ACTIVE" ? schedule.is_active : !schedule.is_active);

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [schedules, search, typeFilter, statusFilter]);

  const describeSource = useCallback(
    (schedule: WorkSchedule): string => {
      switch (schedule.schedule_type) {
        case "FIXED":
          return (
            reference.shifts.find((item) => item.id === schedule.fixed_shift)
              ?.name ?? "No shift set"
          );
        case "SHIFT_PATTERN":
          return (
            reference.shiftPatterns.find(
              (item) => item.id === schedule.shift_pattern,
            )?.name ?? "No pattern set"
          );
        case "ROTATING":
          return (
            reference.rotationPatterns.find(
              (item) => item.id === schedule.rotation_pattern,
            )?.name ?? "No rotation set"
          );
        case "FLEXIBLE":
          return (
            reference.flexibleRules.find(
              (item) => item.id === schedule.flexible_rule,
            )?.name ?? "No rule set"
          );
        default:
          return humanizeEnum(schedule.schedule_type);
      }
    },
    [reference],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(newForm());
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (schedule: WorkSchedule) => {
    setEditing(schedule);
    setFormError("");
    setForm({
      name: schedule.name,
      code: schedule.code,
      scheduleType: (schedule.schedule_type as ScheduleType) ?? "FIXED",
      fixedShift: schedule.fixed_shift ?? "",
      shiftPattern: schedule.shift_pattern ?? "",
      rotationPattern: schedule.rotation_pattern ?? "",
      flexibleRule: schedule.flexible_rule ?? "",
      effectiveFrom: schedule.effective_from,
      effectiveTo: schedule.effective_to ?? "",
      timezone: schedule.timezone,
      isActive: schedule.is_active,
    });
    setModalOpen(true);
  };

  const saveSchedule = useCallback(async () => {
    if (!form.name.trim() || !form.effectiveFrom) {
      setFormError("Name and effective-from are required.");
      return;
    }

    setSaving(true);
    setFormError("");

    // Only the reference matching the selected schedule type is sent; the
    // others are explicitly cleared.
    const payload: Partial<WorkSchedule> = {
      name: form.name.trim(),
      code: form.code.trim(),
      schedule_type: form.scheduleType,
      effective_from: form.effectiveFrom,
      effective_to: form.effectiveTo || null,
      timezone: form.timezone,
      is_active: form.isActive,
      fixed_shift: form.scheduleType === "FIXED" ? form.fixedShift || null : null,
      shift_pattern:
        form.scheduleType === "SHIFT_PATTERN" ? form.shiftPattern || null : null,
      rotation_pattern:
        form.scheduleType === "ROTATING" ? form.rotationPattern || null : null,
      flexible_rule:
        form.scheduleType === "FLEXIBLE" ? form.flexibleRule || null : null,
    };

    try {
      if (editing) {
        await schedulingApi.updateWorkSchedule(editing.id, payload);
      } else {
        await schedulingApi.createWorkSchedule(payload);
      }

      setModalOpen(false);
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [form, editing, reload]);

  /**
   * Assignments are append-only. Creating a current assignment closes the
   * employee's previous effective-dated record in the backend service rather
   * than overwriting it.
   */
  const assignEmployees = useCallback(async () => {
    if (!assignFor || selectedEmployees.size === 0) {
      setFormError("Select at least one employee.");
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      for (const employeeId of selectedEmployees) {
        await schedulingApi.createScheduleAssignment({
          employee: employeeId,
          work_schedule: assignFor.id,
          effective_from: assignFrom,
          is_current: true,
        });
      }

      setAssignFor(null);
      setSelectedEmployees(new Set());
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [assignFor, selectedEmployees, assignFrom, reload]);

  const filteredEmployees = useMemo(() => {
    const value = employeeSearch.trim().toLowerCase();

    if (!value) {
      return reference.employees;
    }

    return reference.employees.filter(
      (employee) =>
        employeesApi.employeeDisplayName(employee).toLowerCase().includes(value) ||
        employee.employee_number.toLowerCase().includes(value),
    );
  }, [reference.employees, employeeSearch]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Schedules"
        description="Define fixed, pattern-based, rotating and flexible work schedules, and assign them to employees."
        actions={
          <button
            onClick={openCreate}
            className={buttonClasses({ variant: "primary" })}
          >
            <Plus className="h-4 w-4" />
            New Schedule
          </button>
        }
      />

      {error && <ErrorState message={error} onRetry={reload} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Schedules"
          value={schedules.length}
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <SummaryCard
          title="Active"
          value={schedules.filter((schedule) => schedule.is_active).length}
          icon={<Clock3 className="h-5 w-5" />}
        />
        <SummaryCard
          title="Current Assignments"
          value={reference.assignments.length}
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search work schedules..."
              className="w-full h-9 rounded-lg border border-line-strong pl-10 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Filter by schedule type"
            className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none"
          >
            <option value={ALL}>All Types</option>

            {SCHEDULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanizeEnum(type)}
              </option>
            ))}
          </select>

          <SegmentedControl
            label="Filter by status"
            value={statusFilter}
            onChange={(next) => setStatusFilter(next)}
            options={[{ value: ALL, label: "All" }, { value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]}
          />
        </div>
      </div>

      {error ? null : filteredSchedules.length === 0 ? (
        <EmptyState
          title={loading ? "Loading schedules..." : "No work schedules"}
          description={
            loading
              ? "Please wait."
              : "Create a work schedule to assign employees to shifts."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-elevation-1">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-line bg-surface-muted">
                <tr>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Schedule
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Type
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Source
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Effective From
                  </th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Assigned
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
                {filteredSchedules.map((schedule) => (
                  <tr key={schedule.id} className="hover:bg-surface-hover">
                    <td className="px-5 py-4">
                      <p className="font-medium text-ink-strong">
                        {schedule.name}
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {schedule.code}
                      </p>
                    </td>

                    <td className="px-5 py-4 text-sm text-ink">
                      {humanizeEnum(schedule.schedule_type)}
                    </td>

                    <td className="px-5 py-4 text-sm text-ink">
                      {describeSource(schedule)}
                    </td>

                    <td className="px-5 py-4 text-sm text-ink">
                      {formatDate(schedule.effective_from)}
                    </td>

                    <td className="px-5 py-4 text-sm text-ink">
                      {assignedCounts.get(schedule.id) ?? 0}
                    </td>

                    <td className="px-5 py-4">
                      <StatusBadge
                        status={schedule.is_active ? "ACTIVE" : "INACTIVE"}
                      />
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/attendance/schedules/${schedule.id}`}
                          className={buttonClasses({ variant: "ghost", size: "sm" })}
                        >
                          <Eye className="h-4 w-4" />
                          View
                        </Link>

                        <Menu
                          label={`Actions for ${schedule.name}`}
                          trigger={(props) => <IconButton {...props} label={`Actions for ${schedule.name}`} size="sm"><MoreHorizontal className="h-4 w-4" /></IconButton>}
                        >
                          {(close) => (
                            <div className="p-1.5">
                              <MenuItem
                                icon={<Users />}
                                onSelect={() => {
                                  close();
                                  setAssignFor(schedule);
                                  setSelectedEmployees(new Set());
                                  setEmployeeSearch("");
                                  setFormError("");
                                }}
                              >
                                Assign employees
                              </MenuItem>
                              <MenuItem icon={<Pencil />} onSelect={() => { close(); openEdit(schedule); }}>Edit schedule</MenuItem>
                            </div>
                          )}
                        </Menu>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule editor */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-6 py-4">
              <h2 className="text-lg font-bold text-headline">
                {editing ? "Edit Work Schedule" : "New Work Schedule"}
              </h2>

              <button
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="rounded-lg p-2 text-ink-subtle hover:bg-surface-hover hover:text-ink-strong"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 p-6">
              {formError && (
                <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                  {formError}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Name
                  </span>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    placeholder="e.g. Standard Morning Schedule"
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Code
                  </span>
                  <input
                    value={form.code}
                    onChange={(event) =>
                      setForm({ ...form, code: event.target.value })
                    }
                    placeholder="Auto-generated if left blank"
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Schedule Type
                </span>
                <select
                  value={form.scheduleType}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      scheduleType: event.target.value as ScheduleType,
                    })
                  }
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                >
                  {SCHEDULE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {humanizeEnum(type)}
                    </option>
                  ))}
                </select>
              </label>

              {form.scheduleType === "FIXED" && (
                <ReferenceSelect
                  label="Fixed Shift"
                  value={form.fixedShift}
                  onChange={(value) => setForm({ ...form, fixedShift: value })}
                  options={reference.shifts.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              )}

              {form.scheduleType === "SHIFT_PATTERN" && (
                <ReferenceSelect
                  label="Shift Pattern"
                  value={form.shiftPattern}
                  onChange={(value) =>
                    setForm({ ...form, shiftPattern: value })
                  }
                  options={reference.shiftPatterns.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              )}

              {form.scheduleType === "ROTATING" && (
                <ReferenceSelect
                  label="Rotation Pattern"
                  value={form.rotationPattern}
                  onChange={(value) =>
                    setForm({ ...form, rotationPattern: value })
                  }
                  options={reference.rotationPatterns.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              )}

              {form.scheduleType === "FLEXIBLE" && (
                <ReferenceSelect
                  label="Flexible Work Rule"
                  value={form.flexibleRule}
                  onChange={(value) =>
                    setForm({ ...form, flexibleRule: value })
                  }
                  options={reference.flexibleRules.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              )}

              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Effective From
                  </span>
                  <input
                    type="date"
                    value={form.effectiveFrom}
                    onChange={(event) =>
                      setForm({ ...form, effectiveFrom: event.target.value })
                    }
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Effective To
                  </span>
                  <input
                    type="date"
                    value={form.effectiveTo}
                    onChange={(event) =>
                      setForm({ ...form, effectiveTo: event.target.value })
                    }
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Timezone
                  </span>
                  <input
                    value={form.timezone}
                    onChange={(event) =>
                      setForm({ ...form, timezone: event.target.value })
                    }
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
              </div>

              <label className="flex items-center gap-3 rounded-lg border border-line p-3">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm({ ...form, isActive: event.target.checked })
                  }
                  className="h-4 w-4"
                />
                <span className="text-sm font-medium text-ink">
                  Active
                </span>
              </label>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-surface px-6 py-4">
              <button
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className={buttonClasses({ variant: "secondary" })}
              >
                Cancel
              </button>

              <button
                onClick={saveSchedule}
                disabled={saving}
                className={buttonClasses({ variant: "primary" })}
              >
                <Check className="h-4 w-4" />
                {saving ? "Saving..." : editing ? "Save Changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assignment modal */}
      {assignFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-headline">
                  Assign Employees
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  {assignFor.name}
                </p>
              </div>

              <button
                onClick={() => setAssignFor(null)}
                disabled={saving}
                className="rounded-lg p-2 text-ink-subtle hover:bg-surface-hover hover:text-ink-strong"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-6">
              {formError && (
                <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                  {formError}
                </div>
              )}

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Effective From
                </span>
                <input
                  type="date"
                  value={assignFrom}
                  onChange={(event) => setAssignFrom(event.target.value)}
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
              </label>

              <p className="rounded-lg bg-surface-muted p-3 text-xs leading-5 text-ink-muted">
                Assigning a current schedule closes each employee&apos;s
                previous effective-dated assignment. The earlier record is
                preserved.
              </p>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />

                <input
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  placeholder="Search employees..."
                  className="w-full h-9 rounded-lg border border-line-strong pl-10 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {filteredEmployees.length === 0 && (
                  <p className="p-3 text-sm text-ink-muted">
                    No employees found.
                  </p>
                )}

                {filteredEmployees.map((employee) => {
                  const checked = selectedEmployees.has(employee.id);

                  return (
                    <label
                      key={employee.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-hover"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedEmployees((current) => {
                            const next = new Set(current);

                            if (next.has(employee.id)) {
                              next.delete(employee.id);
                            } else {
                              next.add(employee.id);
                            }

                            return next;
                          })
                        }
                        className="h-4 w-4"
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-strong">
                          {employeesApi.employeeDisplayName(employee)}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {employee.employee_number}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line px-6 py-4">
              <p className="text-xs text-ink-muted">
                {selectedEmployees.size} selected
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setAssignFor(null)}
                  disabled={saving}
                  className={buttonClasses({ variant: "secondary" })}
                >
                  Cancel
                </button>

                <button
                  onClick={assignEmployees}
                  disabled={saving || selectedEmployees.size === 0}
                  className={buttonClasses({ variant: "primary" })}
                >
                  {saving ? "Assigning..." : "Assign"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReferenceSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
      >
        <option value="">Select {label.toLowerCase()}</option>

        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SummaryCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">{title}</p>

        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-sunken text-ink">
          {icon}
        </span>
      </div>

      <p className="mt-3 text-2xl font-bold text-ink-strong">{value}</p>
    </div>
  );
}
