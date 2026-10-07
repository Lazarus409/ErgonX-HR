"use client";

import type { ReactNode } from "react";

import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import { INSIGHT_PERMISSIONS } from "@/components/navigation/navigation";

/** Institution-wide members with any insight-bearing permission; the API limits what each section shows. */
export default function InsightsLayout({ children }: { children: ReactNode }) {
  return <AppShell><ModuleAccessGate anyPermissions={INSIGHT_PERMISSIONS} scopes={["INSTITUTION"]}>{children}</ModuleAccessGate></AppShell>;
}
