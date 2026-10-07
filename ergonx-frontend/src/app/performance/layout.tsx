import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import AppShell from "@/components/layout/AppShell";
import { INSTITUTION_WIDE } from "@/components/navigation/navigation";

const PERFORMANCE_PERMISSIONS = ["performance.view", "performance.manage"] as const;

export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate module="HR" anyPermissions={PERFORMANCE_PERMISSIONS} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
