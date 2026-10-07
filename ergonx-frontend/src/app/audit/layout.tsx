"use client";

import { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";

/** Canonical audit trail: read-only, gated by `audit.view` like the Settings route. */
export default function AuditLayout({ children }: { children: ReactNode }) {
  return <AppShell><ModuleAccessGate anyPermissions={["audit.view"]}>{children}</ModuleAccessGate></AppShell>;
}
