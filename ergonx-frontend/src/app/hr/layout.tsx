"use client";

import { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import { INSTITUTION_WIDE, moduleWorkspacePermissions } from "@/components/navigation/navigation";

export default function HRLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell><ModuleAccessGate module="HR" anyPermissions={moduleWorkspacePermissions.HR} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
