import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import AppShell from "@/components/layout/AppShell";
import { INSTITUTION_WIDE, moduleWorkspacePermissions } from "@/components/navigation/navigation";

export default function RecruitmentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate module="RECRUITMENT" anyPermissions={moduleWorkspacePermissions.RECRUITMENT} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
