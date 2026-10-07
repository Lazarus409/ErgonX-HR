import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";

/** Approval work is an authenticated institutional workspace, not a standalone page. */
export default function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate anyPermissions={["approval_request.view"]}>{children}</ModuleAccessGate></AppShell>;
}
