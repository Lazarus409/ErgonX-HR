"use client";

import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import AppShell from "@/components/layout/AppShell";
import { INSTITUTION_WIDE, moduleWorkspacePermissions } from "@/components/navigation/navigation";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate module="REPORTS" anyPermissions={moduleWorkspacePermissions.REPORTS} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
