"use client";

import { useCallback, useState } from "react";
import { BarChart3, Banknote, CalendarDays, Calculator, CheckCircle2, Info, Layers3, Lock, Plane, UserRoundPlus, UsersRound, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import PageHeader from "@/components/ui/PageHeader";
import { getApiErrorMessage, institutionsApi } from "@/lib/api";
import { cx } from "@/lib/cx";
import { moduleAccents, type ModuleAccent } from "@/lib/moduleTheme";
import { useApiResource } from "@/lib/useApiResource";
import type { InstitutionModule } from "@/types/institutions";

const moduleDetails: Record<string, { name: string; description: string; icon: LucideIcon; accent: ModuleAccent }> = {
  CORE_HR: { name: "Core HR", description: "Employee records, organization structure and people data.", icon: UsersRound, accent: "hr" },
  RECRUITMENT: { name: "Recruitment", description: "Open roles, candidates, interviews and offers.", icon: UserRoundPlus, accent: "recruitment" },
  LEAVE: { name: "Leave", description: "Leave policies, balances, requests and approvals.", icon: Plane, accent: "leave" },
  ATTENDANCE: { name: "Attendance", description: "Schedules, shifts, time capture and work patterns.", icon: CalendarDays, accent: "attendance" },
  PAYROLL: { name: "Payroll", description: "Pay runs, payslips, components and statutory setup.", icon: Banknote, accent: "payroll" },
  ACCOUNTING: { name: "Accounting", description: "Financial records, journals, payables and receivables.", icon: Calculator, accent: "accounting" },
  REPORTS: { name: "Reports & Analytics", description: "Operational reports and organization insights.", icon: BarChart3, accent: "reports" },
};

const nameOf = (code: string) => moduleDetails[code]?.name ?? code.replaceAll("_", " ");
function configurationLabel(status: string) { return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase()); }

/** Settings › Modules (Stitch S041): enablement with dependency rules enforced by the API. */
export default function ModuleSettingsPage() {
  const load = useCallback(() => institutionsApi.listInstitutionModules(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const [updating, setUpdating] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<InstitutionModule | null>(null);

  const setEnabled = async (module: InstitutionModule, enabled: boolean) => {
    setUpdating(module.id);
    setActionError(null);
    try {
      await institutionsApi.updateInstitutionModule(module.id, enabled);
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setUpdating(null);
      setConfirmDisable(null);
    }
  };

  if (loading) return <LoadingState variant="dashboard" />;
  if (error || !data) return <ErrorState message={error ?? "You may not have permission to manage modules."} onRetry={reload} />;
  const modules = data.results;
  const enabledCodes = new Set(modules.filter((module) => module.is_enabled).map((module) => module.module_code));
  const enabledCount = enabledCodes.size;

  return (
    <div className="space-y-6">
      <PageHeader title="Modules" description="Choose the modules your institution uses. Turning a module off hides it and blocks its API; its records are kept." icon={Layers3} accent="settings" />
      {actionError && <ErrorState variant="inline" title="Module could not be updated" message={actionError} />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="space-y-3" aria-label="Institution modules">
          {modules.map((module) => {
            const detail = moduleDetails[module.module_code] ?? { name: nameOf(module.module_code), description: "ErgonX workspace capability.", icon: CheckCircle2, accent: "settings" as ModuleAccent };
            const foundation = module.can_disable === false;
            const blockedBy = (module.depends_on ?? []).filter((code) => !enabledCodes.has(code));
            const activeDependants = (module.required_by ?? []).filter((code) => enabledCodes.has(code));
            return (
              <article key={module.id} className={cx("flex flex-wrap items-center gap-4 rounded-xl border bg-surface p-4 shadow-elevation-1", module.is_enabled ? "border-line" : "border-dashed border-line-strong")}>
                <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", moduleAccents[detail.accent].tile, !module.is_enabled && "opacity-60")} aria-hidden="true"><detail.icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-card-title font-semibold text-ink-strong">{detail.name}</h2>
                  <p className="text-support text-ink-muted">{detail.description}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={module.is_enabled ? "brand" : "neutral"} dot size="sm">{module.is_enabled ? "Enabled" : "Disabled"}</Badge>
                  {foundation
                    ? <Badge tone="neutral" size="sm" icon={Lock}>Foundation module</Badge>
                    : (module.depends_on ?? []).map((code) => <Badge key={code} tone={enabledCodes.has(code) ? "neutral" : "warning"} size="sm">Depends on {nameOf(code)}</Badge>)}
                  <Badge size="sm" tone={module.configuration_status === "READY" ? "success" : module.configuration_status === "IN_PROGRESS" ? "warning" : "neutral"}>Setup: {configurationLabel(module.configuration_status)}</Badge>
                </div>
                <div className="w-28 shrink-0 text-right">
                  {foundation ? (
                    <span className="text-caption text-ink-muted">Always on</span>
                  ) : module.is_enabled ? (
                    <Button size="sm" variant="secondary" loading={updating === module.id} loadingLabel="Updating…" disabled={activeDependants.length > 0} title={activeDependants.length ? `Disable ${activeDependants.map(nameOf).join(", ")} first` : undefined} onClick={() => setConfirmDisable(module)}>Disable</Button>
                  ) : (
                    <Button size="sm" loading={updating === module.id} loadingLabel="Updating…" disabled={blockedBy.length > 0} title={blockedBy.length ? `Enable ${blockedBy.map(nameOf).join(", ")} first` : undefined} onClick={() => void setEnabled(module, true)}>Enable</Button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
            <p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">Active modules</p>
            <p className="mt-1 text-kpi-sm font-bold text-ink-strong">{enabledCount} <span className="text-support font-medium text-ink-muted">of {modules.length}</span></p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-valuemin={0} aria-valuemax={modules.length} aria-valuenow={enabledCount} aria-label="Enabled modules">
              <div className="h-full rounded-full bg-primary" style={{ width: `${modules.length ? (enabledCount / modules.length) * 100 : 0}%` }} />
            </div>
          </section>
          <section className="rounded-xl border border-line bg-surface p-5 shadow-elevation-1">
            <h2 className="flex items-center gap-2 text-card-title font-semibold text-ink-strong"><Info className="h-5 w-5 text-primary" aria-hidden="true" />About modules</h2>
            <ul className="mt-3 list-disc space-y-2 pl-4 text-support text-ink-muted">
              <li>Core HR is the foundation: the people records every other module uses. It cannot be turned off.</li>
              <li>Leave, Attendance and Recruitment need Core HR.</li>
              <li>A disabled module disappears from navigation and its API refuses requests, whatever a role&apos;s permissions say.</li>
              <li>Disabling never deletes data; enabling the module again brings everything back.</li>
            </ul>
          </section>
        </aside>
      </div>
      <ConfirmDialog
        open={confirmDisable !== null}
        title={`Disable ${confirmDisable ? nameOf(confirmDisable.module_code) : "module"}?`}
        description="Members lose access to its pages and API immediately. Its records are kept and return when you enable it again."
        confirmLabel="Disable module"
        tone="warning"
        loading={confirmDisable !== null && updating === confirmDisable.id}
        onConfirm={() => { if (confirmDisable) void setEnabled(confirmDisable, false); }}
        onCancel={() => setConfirmDisable(null)}
      />
    </div>
  );
}
