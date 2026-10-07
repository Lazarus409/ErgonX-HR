import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import AppShell from "@/components/layout/AppShell";
import { INSTITUTION_WIDE, moduleWorkspacePermissions } from "@/components/navigation/navigation";

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate module="ATTENDANCE" anyPermissions={moduleWorkspacePermissions.ATTENDANCE} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
