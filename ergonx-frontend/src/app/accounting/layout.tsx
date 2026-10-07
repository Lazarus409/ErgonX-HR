"use client";

import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import { INSTITUTION_WIDE, moduleWorkspacePermissions } from "@/components/navigation/navigation";

export default function AccountingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell><ModuleAccessGate module="ACCOUNTING" anyPermissions={moduleWorkspacePermissions.ACCOUNTING} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
