"use client";

import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import { INSTITUTION_WIDE, moduleWorkspacePermissions } from "@/components/navigation/navigation";

export default function PayrollLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell><ModuleAccessGate module="PAYROLL" anyPermissions={moduleWorkspacePermissions.PAYROLL} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
