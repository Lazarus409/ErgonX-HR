"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Edit3, Plus, Search, X } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import { Button, buttonClasses } from "@/components/ui/Button";
import { attendanceApi, getApiErrorMessage, schedulingApi } from "@/lib/api";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { FlexibleWorkRule } from "@/types/attendance";
import { EM_DASH } from "@/lib/format";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const ALL = "ALL";

/** `HH:MM:SS` or null from the API; `HH:MM` or "" in the form. */
function toInputTime(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

export default function FlexibleWorkPage() {
  const [rules, setRules] = useState<FlexibleWorkRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);

  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<FlexibleWorkRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [name, setName] = useState("");
  const [earliestStart, setEarliestStart] = useState("07:00");
  const [latestStart, setLatestStart] = useState("10:00");
  const [earliestEnd, setEarliestEnd] = useState("15:00");
  const [latestEnd, setLatestEnd] = useState("19:00");
  const [requiredHours, setRequiredHours] = useState("8");
  const [requiredMinutes, setRequiredMinutes] = useState("0");
  const [hasCoreHours, setHasCoreHours] = useState(true);
  const [coreStart, setCoreStart] = useState("10:00");
  const [coreEnd, setCoreEnd] = useState("15:00");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await schedulingApi.listFlexibleWorkRules({
          page_size: MAX_PAGE_SIZE,
          ordering: "name",
        });

        if (active) {
          setRules(result.results);
        }
      } catch (caught) {
        if (active) {
          setError(getApiErrorMessage(caught));
          setRules([]);
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

  const filteredRules = useMemo(() => {
    const value = search.trim().toLowerCase();

    return rules.filter((rule) => {
      const matchesSearch = !value || rule.name.toLowerCase().includes(value);

      const matchesStatus =
        status === ALL ||
        (status === "ACTIVE" ? rule.is_active : !rule.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [rules, search, status]);

  const openNew = () => {
    setEditing(null);
    setFormError("");
    setName("");
    setEarliestStart("07:00");
    setLatestStart("10:00");
    setEarliestEnd("15:00");
    setLatestEnd("19:00");
    setRequiredHours("8");
    setRequiredMinutes("0");
    setHasCoreHours(true);
    setCoreStart("10:00");
    setCoreEnd("15:00");
    setIsActive(true);
    setShowEditor(true);
  };

  const openEdit = (rule: FlexibleWorkRule) => {
    setEditing(rule);
    setFormError("");
    setName(rule.name);
    setEarliestStart(toInputTime(rule.earliest_start));
    setLatestStart(toInputTime(rule.latest_start));
    setEarliestEnd(toInputTime(rule.earliest_end));
    setLatestEnd(toInputTime(rule.latest_end));
    setRequiredHours(String(Math.floor(rule.required_minutes / 60)));
    setRequiredMinutes(String(rule.required_minutes % 60));
    setHasCoreHours(Boolean(rule.core_start && rule.core_end));
    setCoreStart(toInputTime(rule.core_start) || "10:00");
    setCoreEnd(toInputTime(rule.core_end) || "15:00");
    setIsActive(rule.is_active);
    setShowEditor(true);
  };

  const saveRule = useCallback(async () => {
    if (!name.trim()) {
      setFormError("Rule name is required.");
      return;
    }

    const totalMinutes =
      Number(requiredHours || 0) * 60 + Number(requiredMinutes || 0);

    if (totalMinutes <= 0) {
      setFormError("Required working time must be greater than zero.");
      return;
    }

    setSaving(true);
    setFormError("");

    const payload: Partial<FlexibleWorkRule> = {
      name: name.trim(),
      earliest_start: earliestStart || null,
      latest_start: latestStart || null,
      earliest_end: earliestEnd || null,
      latest_end: latestEnd || null,
      required_minutes: totalMinutes,
      core_start: hasCoreHours ? coreStart : null,
      core_end: hasCoreHours ? coreEnd : null,
      is_active: isActive,
    };

    try {
      if (editing) {
        await schedulingApi.updateFlexibleWorkRule(editing.id, payload);
      } else {
        await schedulingApi.createFlexibleWorkRule(payload);
      }

      setShowEditor(false);
      reload();
    } catch (caught) {
      setFormError(getApiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, [
    name,
    requiredHours,
    requiredMinutes,
    earliestStart,
    latestStart,
    earliestEnd,
    latestEnd,
    hasCoreHours,
    coreStart,
    coreEnd,
    isActive,
    editing,
    reload,
  ]);

  const window = (from: string | null, to: string | null) => {
    const start = toInputTime(from);
    const end = toInputTime(to);

    return start || end ? `${start || EM_DASH} – ${end || EM_DASH}` : EM_DASH;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Flexible Work"
        description="Configure flexible working windows while defining required working time and optional core hours."
        actions={<Button onClick={openNew} leadingIcon={<Plus className="h-4 w-4" />}>New Rule</Button>}
      />

      {error && <ErrorState message={error} onRetry={reload} />}

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search flexible work rules..."
              className="w-full h-9 rounded-lg border border-line-strong pl-10 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>

          <SegmentedControl
            label="Filter by status"
            value={status}
            onChange={(next) => setStatus(next)}
            options={[{ value: ALL, label: "All" }, { value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }]}
          />
        </div>
      </section>

      {error ? null : filteredRules.length === 0 ? (
        <EmptyState
          title={loading ? "Loading rules..." : "No flexible work rules"}
          description={
            loading
              ? "Please wait."
              : "Create a rule to define a flexible working window."
          }
        />
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {filteredRules.map((rule) => (
            <article
              key={rule.id}
              className="rounded-xl border border-line bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-headline">
                    {rule.name}
                  </h2>

                  <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted">
                    <Clock3 className="h-3.5 w-3.5" />
                    Requires{" "}
                    {attendanceApi.formatMinutes(rule.required_minutes)} per day
                  </p>
                </div>

                <StatusBadge status={rule.is_active ? "ACTIVE" : "INACTIVE"} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-4 text-sm">
                <Detail
                  label="Start window"
                  value={window(rule.earliest_start, rule.latest_start)}
                />
                <Detail
                  label="End window"
                  value={window(rule.earliest_end, rule.latest_end)}
                />
                <Detail
                  label="Core hours"
                  value={
                    rule.core_start && rule.core_end
                      ? window(rule.core_start, rule.core_end)
                      : "None"
                  }
                />
                <Detail
                  label="Required"
                  value={attendanceApi.formatMinutes(rule.required_minutes)}
                />
              </dl>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => openEdit(rule)}
                  className={buttonClasses({ variant: "secondary" })}
                >
                  <Edit3 className="h-4 w-4" />
                  Edit
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {showEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-6 py-4">
              <h2 className="text-lg font-bold text-headline">
                {editing ? "Edit Flexible Work Rule" : "New Flexible Work Rule"}
              </h2>

              <button
                onClick={() => setShowEditor(false)}
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

              {/*
                The backend rule has no code or effective dates; scheduling
                effectivity is held on the work schedule that references it.
              */}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">
                  Rule Name
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Standard Flexible Work"
                  className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <TimeField
                  label="Earliest Start"
                  value={earliestStart}
                  onChange={setEarliestStart}
                />
                <TimeField
                  label="Latest Start"
                  value={latestStart}
                  onChange={setLatestStart}
                />
                <TimeField
                  label="Earliest End"
                  value={earliestEnd}
                  onChange={setEarliestEnd}
                />
                <TimeField
                  label="Latest End"
                  value={latestEnd}
                  onChange={setLatestEnd}
                />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-ink">
                  Required Working Time
                </legend>

                <div className="flex gap-3">
                  <label className="flex-1">
                    <span className="sr-only">Hours</span>
                    <input
                      type="number"
                      min="0"
                      value={requiredHours}
                      onChange={(event) => setRequiredHours(event.target.value)}
                      placeholder="Hours"
                      className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                    />
                  </label>

                  <label className="flex-1">
                    <span className="sr-only">Minutes</span>
                    <input
                      type="number"
                      min="0"
                      max="59"
                      value={requiredMinutes}
                      onChange={(event) =>
                        setRequiredMinutes(event.target.value)
                      }
                      placeholder="Minutes"
                      className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
                    />
                  </label>
                </div>
              </fieldset>

              <label className="flex items-center gap-3 rounded-lg border border-line p-3">
                <input
                  type="checkbox"
                  checked={hasCoreHours}
                  onChange={(event) => setHasCoreHours(event.target.checked)}
                  className="h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">
                    Core hours
                  </span>
                  <span className="block text-xs text-ink-muted">
                    Employees must be present during this window.
                  </span>
                </span>
              </label>

              {hasCoreHours && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TimeField
                    label="Core Start"
                    value={coreStart}
                    onChange={setCoreStart}
                  />
                  <TimeField
                    label="Core End"
                    value={coreEnd}
                    onChange={setCoreEnd}
                  />
                </div>
              )}

              <label className="flex items-center gap-3 rounded-lg border border-line p-3">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm font-medium text-ink">
                  Active
                </span>
              </label>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-3 border-t border-line bg-surface px-6 py-4">
              <button
                onClick={() => setShowEditor(false)}
                disabled={saving}
                className={buttonClasses({ variant: "secondary" })}
              >
                Cancel
              </button>

              <button
                onClick={saveRule}
                disabled={saving || !name.trim()}
                className={buttonClasses({ variant: "primary" })}
              >
                {saving ? "Saving..." : editing ? "Save Changes" : "Create Rule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 font-medium text-ink">{value}</dd>
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-9 rounded-lg border border-line-strong px-3 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}
