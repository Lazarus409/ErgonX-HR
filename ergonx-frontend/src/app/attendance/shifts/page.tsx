"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Clock3,
  Moon,
  Sun,
  Pencil,
  Eye,
  ChevronDown,
  X,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import { attendanceApi, getApiErrorMessage, schedulingApi } from "@/lib/api";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { Shift } from "@/types/attendance";
import { buttonClasses } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const ALL = "ALL";

interface ShiftForm {
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  gracePeriodMinutes: number;
  isActive: boolean;
}

const emptyForm: ShiftForm = {
  name: "",
  code: "",
  startTime: "08:00",
  endTime: "17:00",
  crossesMidnight: false,
  breakMinutes: 60,
  gracePeriodMinutes: 0,
  isActive: true,
};

/** `HH:MM:SS` from the API is shown and edited as `HH:MM`. */
function toInputTime(value: string): string {
  return value.slice(0, 5);
}

export default function AttendanceShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [overnightFilter, setOvernightFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [form, setForm] = useState<ShiftForm>(emptyForm);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await schedulingApi.listShifts({
          page_size: MAX_PAGE_SIZE,
          ordering: "start_time",
        });

        if (active) {
          setShifts(result.results);
        }
      } catch (caught) {
        if (active) {
          setError(getApiErrorMessage(caught));
          setShifts([]);
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

  const filteredShifts = useMemo(() => {
    const value = search.toLowerCase().trim();

    return shifts.filter((shift) => {
      const matchesSearch =
        !value ||
        shift.name.toLowerCase().includes(value) ||
        shift.code.toLowerCase().includes(value);

      const matchesOvernight =
        overnightFilter === ALL ||
        (overnightFilter === "OVERNIGHT"
          ? shift.crosses_midnight
          : !shift.crosses_midnight);

      const matchesStatus =
        statusFilter === ALL ||
        (statusFilter === "ACTIVE" ? shift.is_active : !shift.is_active);

      return matchesSearch && matchesOvernight && matchesStatus;
    });
  }, [shifts, search, overnightFilter, statusFilter]);

  const openCreate = () => {
    setEditingShift(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (shift: Shift) => {
    setEditingShift(shift);
    setFormError("");

    setForm({
      name: shift.name,
      code: shift.code,
      startTime: toInputTime(shift.start_time),
      endTime: toInputTime(shift.end_time),
      crossesMidnight: shift.crosses_midnight,
      breakMinutes: shift.break_minutes,
      gracePeriodMinutes: shift.grace_period_minutes,
      isActive: shift.is_active,
    });

    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingShift(null);
    setForm(emptyForm);
    setFormError("");
  };

  const saveShift = useCallback(async () => {
    if (!form.name.trim() || !form.startTime || !form.endTime) {
      setFormError("Name, start time and end time are required.");
      return;
    }

    setSaving(true);
    setFormError("");

    // `scheduled_minutes` is derived by the backend from these values and is
    // never sent from the browser.
    const payload: Partial<Shift> = {
      name: form.name.trim(),
      code: form.code.trim(),
      start_time: form.startTime,
      end_time: form.endTime,
      crosses_midnight: form.crossesMidnight,
      break_minutes: form.breakMinutes,
      grace_period_minutes: form.gracePeriodMinutes,
      is_active: form.isActive,
    };

    try {
      if (editingShift) {
        await schedulingApi.updateShift(editingShift.id, payload);
      } else {
        await schedulingApi.createShift(payload);
      }

      closeModal();
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [form, editingShift, reload]);

  const activeCount = shifts.filter((shift) => shift.is_active).length;

  const overnightCount = shifts.filter(
    (shift) => shift.crosses_midnight,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shifts"
        description="Manage the shift definitions used by work schedules."
        actions={
          <button
            onClick={openCreate}
            className={buttonClasses({ variant: "primary" })}
          >
            <Plus className="h-4 w-4" />
            Add Shift
          </button>
        }
      />

      {error && <ErrorState message={error} onRetry={reload} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Total Shifts"
          value={shifts.length}
          icon={<Clock3 className="h-5 w-5" />}
        />

        <SummaryCard
          title="Active"
          value={activeCount}
          icon={<Sun className="h-5 w-5" />}
        />

        <SummaryCard
          title="Overnight"
          value={overnightCount}
          icon={<Moon className="h-5 w-5" />}
        />

        <SummaryCard
          title="Inactive"
          value={shifts.length - activeCount}
          icon={<Clock3 className="h-5 w-5" />}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search shifts..."
              className="w-full h-9 rounded-lg border border-line-strong pl-10 pr-4 text-sm outline-none focus:border-primary"
            />
          </div>

          {/*
            The backend shift model has no shift "type". Overnight shifts are
            identified by `crosses_midnight`.
          */}
          <select
            value={overnightFilter}
            onChange={(event) => setOvernightFilter(event.target.value)}
            aria-label="Filter by overnight"
            className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none"
          >
            <option value={ALL}>All Shifts</option>
            <option value="SAME_DAY">Same day</option>
            <option value="OVERNIGHT">Crosses midnight</option>
          </select>

          <SegmentedControl
            label="Filter by status"
            value={statusFilter}
            onChange={(next) => setStatusFilter(next)}
            options={[{ value: ALL, label: "All" }, { value: "ACTIVE", label: "ACTIVE" }, { value: "INACTIVE", label: "INACTIVE" }]}
          />
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[950px]">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-left">
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Shift
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Start
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  End
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Break
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Grace
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Scheduled
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
              {filteredShifts.map((shift) => (
                <tr
                  key={shift.id}
                  className="border-b border-line-soft last:border-0"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-ink-strong">{shift.name}</p>

                      {shift.crosses_midnight && (
                        <Moon className="h-3.5 w-3.5 text-ink-subtle" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{shift.code}</p>
                  </td>

                  <td className="px-5 py-4 text-sm text-ink">
                    {toInputTime(shift.start_time)}
                  </td>

                  <td className="px-5 py-4 text-sm text-ink">
                    {toInputTime(shift.end_time)}
                  </td>

                  <td className="px-5 py-4 text-sm text-ink">
                    {attendanceApi.formatMinutes(shift.break_minutes)}
                  </td>

                  <td className="px-5 py-4 text-sm text-ink">
                    {attendanceApi.formatMinutes(shift.grace_period_minutes)}
                  </td>

                  <td className="px-5 py-4 text-sm font-medium text-ink-strong">
                    {attendanceApi.formatMinutes(shift.scheduled_minutes)}
                  </td>

                  <td className="px-5 py-4">
                    <StatusBadge
                      status={shift.is_active ? "ACTIVE" : "INACTIVE"}
                    />
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/attendance/shifts/${shift.id}`}
                        className={buttonClasses({ variant: "secondary" })}
                      >
                        <Eye className="h-4 w-4" />
                        View
                      </Link>

                      <button
                        onClick={() => openEdit(shift)}
                        className={buttonClasses({ variant: "secondary" })}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredShifts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center">
                    <p className="text-sm font-medium text-ink">
                      {loading ? "Loading shifts..." : "No shifts found"}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {loading
                        ? "Please wait."
                        : "Create a shift to start building work schedules."}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-line-soft md:hidden">
          {filteredShifts.map((shift) => {
            const expanded = expandedId === shift.id;

            return (
              <div key={shift.id} className="p-4">
                <button
                  onClick={() => setExpandedId(expanded ? null : shift.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <p className="font-medium text-ink-strong">{shift.name}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {shift.code} · {toInputTime(shift.start_time)}–
                      {toInputTime(shift.end_time)}
                    </p>
                  </div>

                  <ChevronDown
                    className={`h-5 w-5 text-ink-subtle transition-transform ${
                      expanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                <div className="mt-3 flex items-center justify-between">
                  <StatusBadge
                    status={shift.is_active ? "ACTIVE" : "INACTIVE"}
                  />

                  <button
                    onClick={() => openEdit(shift)}
                    className="text-sm font-medium text-ink"
                  >
                    Edit
                  </button>
                </div>

                {expanded && (
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-3 text-sm">
                    <Info
                      label="Break"
                      value={attendanceApi.formatMinutes(shift.break_minutes)}
                    />
                    <Info
                      label="Grace"
                      value={attendanceApi.formatMinutes(
                        shift.grace_period_minutes,
                      )}
                    />
                    <Info
                      label="Scheduled"
                      value={attendanceApi.formatMinutes(
                        shift.scheduled_minutes,
                      )}
                    />
                    <Info
                      label="Overnight"
                      value={shift.crosses_midnight ? "Yes" : "No"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-6 py-4">
              <div>
                <h2 className="text-lg font-bold text-headline">
                  {editingShift ? "Edit Shift" : "Add Shift"}
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Scheduled hours are derived by the backend from these values.
                </p>
              </div>

              <button
                onClick={closeModal}
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
                    Shift Name
                  </span>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    placeholder="e.g. Morning Shift"
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

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Start Time
                  </span>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(event) =>
                      setForm({ ...form, startTime: event.target.value })
                    }
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    End Time
                  </span>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(event) =>
                      setForm({ ...form, endTime: event.target.value })
                    }
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Break (minutes)
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={form.breakMinutes}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        breakMinutes: Number(event.target.value),
                      })
                    }
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>

                <label className="space-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    Grace Period (minutes)
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={form.gracePeriodMinutes}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        gracePeriodMinutes: Number(event.target.value),
                      })
                    }
                    className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-lg border border-line p-3">
                  <input
                    type="checkbox"
                    checked={form.crossesMidnight}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        crossesMidnight: event.target.checked,
                      })
                    }
                    className="h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">
                      Crosses midnight
                    </span>
                    <span className="block text-xs text-ink-muted">
                      The shift ends on the following day.
                    </span>
                  </span>
                </label>

                <label className="flex items-center gap-3 rounded-lg border border-line p-3">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) =>
                      setForm({ ...form, isActive: event.target.checked })
                    }
                    className="h-4 w-4"
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">
                      Active
                    </span>
                    <span className="block text-xs text-ink-muted">
                      Available for assignment to work schedules.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-surface px-6 py-4">
              <button
                onClick={closeModal}
                disabled={saving}
                className={buttonClasses({ variant: "secondary" })}
              >
                Cancel
              </button>

              <button
                onClick={saveShift}
                disabled={saving || !form.name.trim()}
                className={buttonClasses({ variant: "primary" })}
              >
                {saving
                  ? "Saving..."
                  : editingShift
                    ? "Save Changes"
                    : "Create Shift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 font-medium text-ink">{value}</p>
    </div>
  );
}
