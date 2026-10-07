"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Clock3,
  Edit3,
  Plus,
  Search,
  X,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import { getApiErrorMessage, schedulingApi } from "@/lib/api";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { Shift, ShiftPattern, ShiftPatternDay } from "@/types/attendance";
import { EM_DASH } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const ALL = "ALL";

interface PatternForm {
  name: string;
  code: string;
  cycleLengthDays: number;
  isActive: boolean;
}

const emptyForm: PatternForm = {
  name: "",
  code: "",
  cycleLengthDays: 7,
  isActive: true,
};

export default function ShiftPatternsPage() {
  const [patterns, setPatterns] = useState<ShiftPattern[]>([]);
  const [days, setDays] = useState<ShiftPatternDay[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftPattern | null>(null);
  const [form, setForm] = useState<PatternForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dayError, setDayError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [patternPage, dayPage, shiftPage] = await Promise.all([
          schedulingApi.listShiftPatterns({
            page_size: MAX_PAGE_SIZE,
            ordering: "name",
          }),
          schedulingApi.listShiftPatternDays({
            page_size: MAX_PAGE_SIZE,
            ordering: "day_index",
          }),
          schedulingApi.listShifts({
            page_size: MAX_PAGE_SIZE,
            ordering: "name",
          }),
        ]);

        if (!active) {
          return;
        }

        setPatterns(patternPage.results);
        setDays(dayPage.results);
        setShifts(shiftPage.results);
      } catch (caught) {
        if (active) {
          setError(getApiErrorMessage(caught));
          setPatterns([]);
          setDays([]);
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

  const shiftNames = useMemo(
    () => new Map(shifts.map((shift) => [shift.id, shift.name])),
    [shifts],
  );

  const daysByPattern = useMemo(() => {
    const grouped = new Map<string, ShiftPatternDay[]>();

    for (const day of days) {
      const existing = grouped.get(day.shift_pattern) ?? [];
      existing.push(day);
      grouped.set(day.shift_pattern, existing);
    }

    for (const list of grouped.values()) {
      list.sort((a, b) => a.day_index - b.day_index);
    }

    return grouped;
  }, [days]);

  const filteredPatterns = useMemo(() => {
    const value = search.trim().toLowerCase();

    return patterns.filter((pattern) => {
      const matchesSearch =
        !value ||
        pattern.name.toLowerCase().includes(value) ||
        pattern.code.toLowerCase().includes(value);

      const matchesStatus =
        statusFilter === ALL ||
        (statusFilter === "ACTIVE" ? pattern.is_active : !pattern.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [patterns, search, statusFilter]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (pattern: ShiftPattern) => {
    setEditing(pattern);
    setFormError("");
    setForm({
      name: pattern.name,
      code: pattern.code,
      cycleLengthDays: pattern.cycle_length_days,
      isActive: pattern.is_active,
    });
    setModalOpen(true);
  };

  const savePattern = useCallback(async () => {
    if (!form.name.trim()) {
      setFormError("Pattern name is required.");
      return;
    }

    setSaving(true);
    setFormError("");

    const payload: Partial<ShiftPattern> = {
      name: form.name.trim(),
      code: form.code.trim(),
      cycle_length_days: form.cycleLengthDays,
      is_active: form.isActive,
    };

    try {
      if (editing) {
        await schedulingApi.updateShiftPattern(editing.id, payload);
      } else {
        await schedulingApi.createShiftPattern(payload);
      }

      setModalOpen(false);
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [form, editing, reload]);

  /** Pattern days are separate records under `/shift-pattern-days/`. */
  const setPatternDay = useCallback(
    async (
      pattern: ShiftPattern,
      dayIndex: number,
      existing: ShiftPatternDay | undefined,
      shiftId: string,
    ) => {
      setDayError("");

      try {
        if (shiftId === "") {
          if (existing) {
            await schedulingApi.deleteShiftPatternDay(existing.id);
          }
        } else if (shiftId === "OFF") {
          const payload = {
            shift_pattern: pattern.id,
            day_index: dayIndex,
            shift: null,
            is_off_day: true,
          };

          if (existing) {
            await schedulingApi.updateShiftPatternDay(existing.id, payload);
          } else {
            await schedulingApi.createShiftPatternDay(payload);
          }
        } else {
          const payload = {
            shift_pattern: pattern.id,
            day_index: dayIndex,
            shift: shiftId,
            is_off_day: false,
          };

          if (existing) {
            await schedulingApi.updateShiftPatternDay(existing.id, payload);
          } else {
            await schedulingApi.createShiftPatternDay(payload);
          }
        }

        reload();
      } catch (caught) {
        setDayError(getApiErrorMessage(caught));
      }
    },
    [reload],
  );

  const activeCount = patterns.filter((pattern) => pattern.is_active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Shift Patterns"
        description="Define repeating shift cycles and the shift worked on each day of the cycle."
        actions={
          <button
            onClick={openCreate}
            className={buttonClasses({ variant: "primary" })}
          >
            <Plus className="h-4 w-4" />
            Add Pattern
          </button>
        }
      />

      {error && <ErrorState message={error} onRetry={reload} />}

      {dayError && (
        <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          {dayError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Total Patterns"
          value={patterns.length}
          icon={<CalendarDays className="h-5 w-5" />}
        />
        <SummaryCard
          title="Active"
          value={activeCount}
          icon={<Clock3 className="h-5 w-5" />}
        />
        <SummaryCard
          title="Configured Days"
          value={days.length}
          icon={<CalendarDays className="h-5 w-5" />}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search shift patterns..."
              className="w-full h-9 rounded-lg border border-line-strong pl-10 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>

          <SegmentedControl
            label="Filter by status"
            value={statusFilter}
            onChange={(next) => setStatusFilter(next)}
            options={[{ value: ALL, label: "All" }, { value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]}
          />
        </div>
      </div>

      {error ? null : filteredPatterns.length === 0 ? (
        <EmptyState
          title={loading ? "Loading patterns..." : "No shift patterns"}
          description={
            loading
              ? "Please wait."
              : "Create a pattern to define a repeating shift cycle."
          }
        />
      ) : (
        <div className="space-y-4">
          {filteredPatterns.map((pattern) => {
            const patternDays = daysByPattern.get(pattern.id) ?? [];
            const expanded = expandedId === pattern.id;

            return (
              <section
                key={pattern.id}
                className="rounded-2xl border border-line bg-surface shadow-elevation-1"
              >
                <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-base font-bold text-headline">
                        {pattern.name}
                      </h2>

                      <StatusBadge
                        status={pattern.is_active ? "ACTIVE" : "INACTIVE"}
                      />
                    </div>

                    <p className="mt-1 text-xs text-ink-muted">
                      {pattern.code} · {pattern.cycle_length_days}-day cycle ·{" "}
                      {patternDays.length} day
                      {patternDays.length === 1 ? "" : "s"} configured
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setExpandedId(expanded ? null : pattern.id)
                      }
                      className={buttonClasses({ variant: "secondary" })}
                    >
                      {expanded ? "Hide cycle" : "Edit cycle"}
                    </button>

                    <button
                      onClick={() => openEdit(pattern)}
                      className={buttonClasses({ variant: "secondary" })}
                    >
                      <Edit3 className="h-4 w-4" />
                      Edit
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
                    {Array.from(
                      { length: pattern.cycle_length_days },
                      (_, index) => index + 1,
                    ).map((dayIndex) => {
                      const day = patternDays.find(
                        (item) => item.day_index === dayIndex,
                      );

                      const value = day
                        ? day.is_off_day
                          ? "OFF"
                          : (day.shift ?? "")
                        : "";

                      return (
                        <label
                          key={dayIndex}
                          className="space-y-1.5 rounded-lg border border-line p-3"
                        >
                          <span className="text-xs font-medium text-ink-muted">
                            Day {dayIndex}
                          </span>

                          <select
                            value={value}
                            onChange={(event) =>
                              setPatternDay(
                                pattern,
                                dayIndex,
                                day,
                                event.target.value,
                              )
                            }
                            className="w-full h-9 rounded-lg border border-line-strong px-2 text-sm outline-none focus:border-primary"
                          >
                            <option value="">Not configured</option>
                            <option value="OFF">Off day</option>

                            {shifts.map((shift) => (
                              <option key={shift.id} value={shift.id}>
                                {shift.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                )}

                {!expanded && patternDays.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-5">
                    {patternDays.map((day) => (
                      <span
                        key={day.id}
                        className="rounded-full border border-line bg-surface-muted px-3 py-1.5 text-xs text-ink"
                      >
                        Day {day.day_index}:{" "}
                        {day.is_off_day
                          ? "Off"
                          : (shiftNames.get(day.shift ?? "") ?? EM_DASH)}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="w-full max-w-lg rounded-2xl bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-lg font-bold text-headline">
                {editing ? "Edit Shift Pattern" : "Add Shift Pattern"}
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

            <div className="space-y-4 p-6">
              {formError && (
                <div className="rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger-ink">
                  {formError}
                </div>
              )}

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Pattern Name
                </span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  placeholder="e.g. Standard 5-Day Pattern"
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">Code</span>
                <input
                  value={form.code}
                  onChange={(event) =>
                    setForm({ ...form, code: event.target.value })
                  }
                  placeholder="Auto-generated if left blank"
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Cycle Length (days)
                </span>
                <input
                  type="number"
                  min="1"
                  value={form.cycleLengthDays}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      cycleLengthDays: Number(event.target.value),
                    })
                  }
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
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
                <span className="text-sm font-medium text-ink">
                  Active
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-3 border-t border-line px-6 py-4">
              <button
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className={buttonClasses({ variant: "secondary" })}
              >
                Cancel
              </button>

              <button
                onClick={savePattern}
                disabled={saving || !form.name.trim()}
                className={buttonClasses({ variant: "primary" })}
              >
                {saving
                  ? "Saving..."
                  : editing
                    ? "Save Changes"
                    : "Create Pattern"}
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
