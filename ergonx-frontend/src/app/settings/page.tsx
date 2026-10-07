"use client";

import { Bell, Building2, BriefcaseBusiness, CalendarDays, Clock3, GitPullRequest, KeyRound, type LucideIcon, Puzzle, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";

import { useAuth } from "@/components/guards/AuthProvider";
import { ActionCard } from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import { INSTITUTION_WIDE, type DataScope } from "@/components/navigation/navigation";
import { hasModule } from "@/types/institutions";

export const settingsAreas: Array<{ title: string; description: string; href: string; icon: LucideIcon; permission?: string; anyPermissions?: string[]; module?: string; scopes?: readonly DataScope[] }> = [
  { title: "Profile", description: "Update supported personal contact details and review employment identity.", href: "/me/profile", icon: UserRound, anyPermissions: ["leave.request", "attendance.clock", "payslip.view", "tax_relief.claim"] },
  { title: "Personal Preferences", description: "Manage supported workspace preferences.", href: "/settings/profile", icon: SlidersHorizontal, permission: "settings.profile.manage_self" },
  { title: "Security", description: "Change your password using your current account credentials.", href: "/settings/security", icon: KeyRound, permission: "home.view" },
  // Every role holds institution.view (the app needs the institution's name and locale),
  // so this Institution Admin area is keyed on the manage permission instead.
  { title: "Institution Settings", description: "Manage the institution's identity, logo and operational locale.", href: "/settings/institution", icon: Building2, permission: "settings.institution.manage" },
  { title: "Modules", description: "Review enabled ERP modules and configuration status.", href: "/settings/modules", icon: Puzzle, permission: "settings.modules.manage" },
  { title: "Roles & Permissions", description: "Manage institution roles and assigned permissions.", href: "/settings/roles", icon: ShieldCheck, permission: "settings.roles.manage" },
  { title: "Approval Workflows", description: "Review approval definitions used by operational processes.", href: "/settings/approval-workflows", icon: GitPullRequest, permission: "approval_workflow.view" },
  { title: "Notifications", description: "Review in-app notification history for your active institution.", href: "/notifications", icon: Bell, permission: "home.view" },
  { title: "Organization", description: "Review the institution's department / functional area, position, grade, and location catalogues.", href: "/hr/departments", icon: BriefcaseBusiness, permission: "organization.view", module: "HR", scopes: INSTITUTION_WIDE },
  { title: "Recruitment", description: "Manage the ordered recruitment stages used by the institution pipeline.", href: "/recruitment/stages", icon: BriefcaseBusiness, permission: "recruitment_stage.view", module: "RECRUITMENT" },
  { title: "Leave", description: "Manage the institution's leave types and effective leave policies.", href: "/leave/policies", icon: CalendarDays, permission: "leave.configure", module: "LEAVE" },
  { title: "Attendance", description: "Manage authorized work schedules, shift patterns, rotations, and assignments.", href: "/attendance/schedules", icon: Clock3, permission: "schedule.manage", module: "ATTENDANCE" },
];

/** `scopes` limits an area to data scopes; Organization links into the HR workspace, which department heads cannot open. */
export function canUseSettingsArea(area: (typeof settingsAreas)[number], permissions: string[], enabledModules: string[] | undefined, scope: DataScope = "INSTITUTION"): boolean {
  if (area.scopes && !area.scopes.includes(scope)) return false;
  const authorized = permissions.includes("*") || (area.permission ? permissions.includes(area.permission) : Boolean(area.anyPermissions?.some((permission) => permissions.includes(permission))));
  return authorized && (!area.module || hasModule(enabledModules, area.module));
}

export default function SettingsPage() {
  const { user, institution } = useAuth();
  const visibleAreas = settingsAreas.filter((area) => canUseSettingsArea(area, user?.permissions ?? [], institution?.enabledModules, user?.dataScope));
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Administration" title="Settings" description="Only settings authorized by your active institution membership are shown." icon={SlidersHorizontal} accent="settings" />
      {visibleAreas.length ? (
        <section aria-label="Settings areas" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleAreas.map((area) => <ActionCard key={area.href} href={area.href} title={area.title} description={area.description} icon={area.icon} accent="settings" />)}
        </section>
      ) : (
        <EmptyState icon={SlidersHorizontal} accent="settings" title="No settings are available" description="Your current role does not grant a settings area in this institution." />
      )}
    </div>
  );
}
