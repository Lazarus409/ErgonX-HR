"use client";

import { LockKeyhole, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import { ActionCard } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import type { ModuleAccent } from "@/lib/moduleTheme";
import { hasModule } from "@/types/institutions";

export interface ModuleLandingArea {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** Omit for areas open to every member who can reach the module. */
  permission?: string;
}

interface ModuleLandingProps {
  title: string;
  description: string;
  /** Backend module code; omit for non-module areas such as Settings. */
  module?: string;
  accent: ModuleAccent;
  icon?: LucideIcon;
  eyebrow?: string;
  areas: ModuleLandingArea[];
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Module entry page: a calm grid of the operational areas the active
 * membership may open. Visibility mirrors permissions and module enablement;
 * each destination still enforces its own gate.
 */
export default function ModuleLanding({ title, description, module, accent, icon, eyebrow, areas, actions, children }: ModuleLandingProps) {
  const { user, institution } = useAuth();
  const permissions = user?.permissions ?? [];
  const can = (permission?: string) => !permission || permissions.includes("*") || permissions.includes(permission);
  const enabled = !module || hasModule(institution?.enabledModules, module);
  const visibleAreas = enabled ? areas.filter((area) => can(area.permission)) : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow={eyebrow ?? `${title} workspace`} title={title} description={description} icon={icon} accent={accent} actions={actions} />
      {children}
      {visibleAreas.length ? (
        <section aria-label={`${title} areas`} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleAreas.map((area) => <ActionCard key={area.href} href={area.href} title={area.title} description={area.description} icon={area.icon} accent={accent} />)}
        </section>
      ) : (
        <EmptyState icon={LockKeyhole} accent={accent} title={`No ${title.toLowerCase()} areas are available`} description="An administrator can enable the module or assign the required permissions to your membership." />
      )}
    </div>
  );
}
