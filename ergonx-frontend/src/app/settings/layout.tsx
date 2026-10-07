"use client";

import { useAuth } from "@/components/guards/AuthProvider";
import AccessDenied from "@/components/ui/AccessDenied";
import LoadingState from "@/components/ui/LoadingState";
import AppShell from "@/components/layout/AppShell";
import { canUseSettingsArea, settingsAreas } from "./page";
import { usePathname } from "next/navigation";
import BackNavigation from "@/components/ui/BackNavigation";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, institution, loading } = useAuth();
  const pathname = usePathname();

  if (loading) return <LoadingState />;
  const canAccessASettingsArea = Boolean(user?.permissions.includes("*") || user?.permissions.some((permission) => settingsAreas.some((area) => area.permission === permission || area.anyPermissions?.includes(permission))));

  if (!canAccessASettingsArea) return <AccessDenied />;

  // A settings page reached by URL is held to the same rule as its card on /settings.
  const area = settingsAreas.find((candidate) => candidate.href.startsWith("/settings/") && (pathname === candidate.href || pathname.startsWith(`${candidate.href}/`)));
  if (area && !canUseSettingsArea(area, user?.permissions ?? [], institution?.enabledModules, user?.dataScope)) {
    return <AppShell><BackNavigation fallback="/settings" label="Back to Settings" /><AccessDenied area={area.title} permission={area.permission} /></AppShell>;
  }

  return <AppShell>{pathname !== "/settings" && <BackNavigation fallback="/settings" label="Back to Settings" />}{children}</AppShell>;
}
