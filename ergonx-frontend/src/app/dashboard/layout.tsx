"use client";

import { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell><ModuleAccessGate anyPermissions={["dashboard.executive.view"]}>{children}</ModuleAccessGate></AppShell>;
}
