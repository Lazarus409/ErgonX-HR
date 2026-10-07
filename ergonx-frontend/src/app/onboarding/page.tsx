"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  CalendarDays,
  Landmark,
  Layers3,
  RefreshCw,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/components/guards/AuthProvider";
import HomeHero from "@/components/home/HomeHero";
import Alert from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/Card";
import ErrorState from "@/components/ui/ErrorState";
import LoadingState from "@/components/ui/LoadingState";
import StatusBadge from "@/components/ui/StatusBadge";
import { getApiErrorMessage, institutionsApi } from "@/lib/api";
import { useApiResource } from "@/lib/useApiResource";
import { MODULE_LABELS, type InstitutionOnboardingStep, type ModuleCode } from "@/types/institutions";
import { cx } from "@/lib/cx";

type StepAction = { href: string; label: string };

type StepPresentation = {
  title: string;
  description: string;
  icon: LucideIcon;
  action?: StepAction;
};

const stepPresentation: Record<string, StepPresentation> = {
  INSTITUTION_PROFILE: { title: "Institution profile", description: "Add your organization contact details, country, and time zone.", icon: Building2, action: { href: "/onboarding/profile", label: "Complete profile" } },
  MODULE_SELECTION: { title: "Choose your modules", description: "Enable the ErgonX modules your organization will use.", icon: Layers3, action: { href: "/settings/modules", label: "Choose modules" } },
  ORGANIZATION_SETUP: { title: "Organization structure", description: "Create a department / functional area, position, grade, and location for Core HR.", icon: Landmark, action: { href: "/onboarding/organization", label: "Create structure" } },
  HR_CONFIGURATION: { title: "Core HR readiness", description: "Review your starter organization structure before validation.", icon: BadgeCheck, action: { href: "/onboarding/organization", label: "Review structure" } },
  PAYROLL_CONFIGURATION: { title: "Payroll configuration", description: "Set up payroll preferences when Payroll is enabled.", icon: CreditCard, action: { href: "/payroll/configuration", label: "Configure payroll" } },
  SCHEDULING_CONFIGURATION: { title: "Scheduling configuration", description: "Create an active work schedule for Attendance.", icon: CalendarDays, action: { href: "/attendance/schedules", label: "Configure schedules" } },
  ACCOUNTING_CONFIGURATION: { title: "Accounting configuration", description: "Review accounting setup when Accounting is enabled.", icon: Landmark, action: { href: "/accounting", label: "Open accounting" } },
  PAYROLL_GL_MAPPING: { title: "Payroll-to-GL mapping", description: "Map payroll components to accounting accounts.", icon: Landmark, action: { href: "/accounting/chart-of-accounts", label: "Configure mapping" } },
  RECRUITMENT_CONFIGURATION: { title: "Recruitment configuration", description: "Review recruitment setup when Recruitment is enabled.", icon: UsersRound, action: { href: "/recruitment", label: "Open recruitment" } },
  USERS_AND_ROLES: { title: "Invite your setup owners", description: "Invite administrators without changing existing member access.", icon: UsersRound, action: { href: "/onboarding/users", label: "Invite administrators" } },
  VALIDATION: { title: "Validate your setup", description: "Run the server checks to confirm your institution is ready.", icon: ClipboardCheck },
};

const institutionAdminSteps = new Set([
  "INSTITUTION_PROFILE",
  "MODULE_SELECTION",
  "USERS_AND_ROLES",
]);

function formatStep(value: string): string {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
}

function isFinished(status: string): boolean {
  return status === "COMPLETED" || status === "SKIPPED";
}

export default function OnboardingPage() {
  const router = useRouter();
  const load = useCallback(() => institutionsApi.getInstitutionOnboarding(), []);
  const { data, loading, error, reload } = useApiResource(load);
  const { institution, refreshSession, user } = useAuth();
  const [validating, setValidating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const canManageOnboarding = user?.permissions.includes("*") || user?.permissions.includes("onboarding.manage");
  const isInstitutionSetupOwner = user?.permissions.includes("*") || [
    "settings.institution.manage", "settings.modules.manage", "settings.users.manage",
  ].every((permission) => user?.permissions.includes(permission));

  const validate = async () => {
    setValidating(true);
    setActionError(null);
    try {
      const onboarding = await institutionsApi.validateInstitutionOnboarding();
      await refreshSession();
      if (onboarding.status === "READY") {
        router.replace("/");
        return;
      }
      reload();
    } catch (caught) {
      setActionError(getApiErrorMessage(caught));
    } finally {
      setValidating(false);
    }
  };

  const visibleSteps = useMemo(
    () => data?.steps.filter((step) => !isInstitutionSetupOwner || institutionAdminSteps.has(step.code)) ?? [],
    [data, isInstitutionSetupOwner],
  );

  const setupSummary = useMemo(() => {
    if (!data) return { complete: 0, required: 0 };
    const required = visibleSteps.filter((step) => step.status !== "SKIPPED");
    return {
      complete: required.filter((step) => step.status === "COMPLETED").length,
      required: required.length,
    };
  }, [data, visibleSteps]);

  if (loading) return <LoadingState variant="dashboard" label="Loading setup" />;
  if (error || !data) return <div className="mx-auto max-w-6xl"><ErrorState message={error ?? "You may not have permission to view institution onboarding."} onRetry={reload} /></div>;

  const blockers = (data.validation_summary.blockers ?? []).filter((blocker) =>
    !isInstitutionSetupOwner || institutionAdminSteps.has(blocker.step),
  );
  const percent = setupSummary.required ? Math.round((setupSummary.complete / setupSummary.required) * 100) : 100;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <HomeHero
        eyebrow="Guided setup"
        title={`Set up ${institution?.name ?? "your institution"}.`}
        subtitle="Complete the essentials to prepare your organization. Each step is verified by the server."
        aside={
          <div className="rounded-2xl border border-primary/15 bg-primary-soft/70 p-5">
            <p className="text-caption font-semibold text-primary-ink">Setup progress</p>
            <p className="mt-1 text-display font-bold text-headline tabular-nums">{percent}<span className="text-heading text-ink-muted">%</span></p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Setup progress">
              <div className="bg-signature h-full rounded-full transition-[width] duration-500 ease-standard" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 text-caption text-ink-muted">{setupSummary.complete} of {setupSummary.required} required items complete</p>
            {canManageOnboarding && (
              <Button variant="secondary" size="sm" className="mt-4" loading={validating} loadingLabel="Validating…" leadingIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void validate()}>Validate setup</Button>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={data.status} />
          <span className="inline-flex items-center gap-2 text-support text-ink-muted"><ClipboardCheck className="h-4 w-4 text-primary-ink" aria-hidden="true" />Current focus: <span className="font-semibold text-ink-strong">{isInstitutionSetupOwner ? "Institution profile, module selection, and setup owners" : formatStep(data.current_step)}</span></span>
        </div>
      </HomeHero>

      {actionError && <ErrorState variant="inline" title="Setup validation failed" message={actionError} onRetry={reload} />}
      {blockers.length > 0 && (
        <Alert tone="warning" title="Attention needed before setup can be completed">
          <p>Resolve these server-identified requirements, then validate again.</p>
          <ul className="mt-3 space-y-1.5">
            {blockers.map((blocker) => <li key={`${blocker.step}-${blocker.code}`} className="rounded-lg bg-surface/70 px-3 py-2"><span className="font-semibold text-ink-strong">{stepPresentation[blocker.step]?.title ?? formatStep(blocker.step)}:</span> {blocker.message}</li>)}
          </ul>
        </Alert>
      )}
      {data.status === "READY" && <Alert tone="success" title="Your institution is ready">All enabled-module setup requirements have passed server validation.</Alert>}

      <section aria-labelledby="checklist-heading" className="space-y-4">
        <SectionHeading
          title={<span id="checklist-heading">{isInstitutionSetupOwner ? "Prepare your organization" : "Complete your setup"}</span>}
          description={isInstitutionSetupOwner ? "Role owners complete their own authorized configuration after you invite them." : "Complete the setup items assigned to your permissions."}
          actions={<span className="text-support text-ink-muted">{visibleSteps.length} setup steps</span>}
        />
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleSteps.map((step, index) => <SetupStepCard key={step.code} index={index + 1} step={step} validating={validating} canValidate={Boolean(canManageOnboarding)} onValidate={validate} />)}
        </ol>
      </section>
    </div>
  );
}

function SetupStepCard({ index, step, validating, canValidate, onValidate }: { index: number; step: InstitutionOnboardingStep; validating: boolean; canValidate: boolean; onValidate: () => Promise<void> }) {
  const presentation = stepPresentation[step.code] ?? { title: formatStep(step.code), description: "Complete this setup requirement.", icon: ClipboardCheck };
  const Icon = presentation.icon;
  const complete = isFinished(step.status);
  const needsAttention = step.status === "BLOCKED";
  const linkClass = "inline-flex items-center gap-1.5 text-support font-semibold text-primary-ink hover:underline";

  return (
    <li className={cx("relative flex min-h-48 flex-col overflow-hidden rounded-2xl border p-5 transition-shadow", needsAttention ? "border-danger/30 bg-danger-soft/40" : complete ? "border-line bg-surface-muted/50" : "border-line bg-surface shadow-elevation-1 hover:shadow-elevation-2")}>
      <span aria-hidden="true" className={cx("absolute inset-x-0 top-0 h-[3px]", needsAttention ? "bg-danger" : complete ? "bg-success" : "bg-primary")} />
      <div className="flex items-start justify-between gap-3">
        <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", needsAttention ? "bg-danger-soft text-danger" : complete ? "bg-success-soft text-success" : "bg-primary-soft text-primary")} aria-hidden="true"><Icon className="h-5 w-5" /></span>
        <StatusBadge status={step.status} size="sm" />
      </div>
      <p className="mt-4 text-caption font-semibold text-ink-subtle">Step {index}</p>
      <h3 className="text-card-title font-bold text-ink-strong">{presentation.title}</h3>
      <p className="mt-1 text-support text-ink-muted">{presentation.description}</p>
      {step.blocker_message && <p className="mt-2 text-support font-medium text-danger-ink">{step.blocker_message}</p>}
      {step.required_module && <p className="mt-2 text-caption text-ink-subtle">Required for {MODULE_LABELS[step.required_module as ModuleCode] ?? formatStep(step.required_module)}</p>}
      <div className="mt-auto pt-5">
        {step.code === "VALIDATION" && !complete && canValidate ? (
          <button type="button" disabled={validating} onClick={() => void onValidate()} className={cx(linkClass, "disabled:opacity-60")}>{validating ? "Validating…" : "Validate setup"} <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
        ) : presentation.action ? (
          <Link href={presentation.action.href} className={linkClass}>{complete ? "Manage" : presentation.action.label} <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
        ) : (
          <span className={cx("inline-flex items-center gap-1.5 text-support font-semibold", step.status === "SKIPPED" ? "text-ink-subtle" : "text-success-ink")}>{step.status === "SKIPPED" ? "Skipped" : complete ? "Completed" : "View only"}{complete && step.status !== "SKIPPED" && <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}</span>
        )}
      </div>
    </li>
  );
}
