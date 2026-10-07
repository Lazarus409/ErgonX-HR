import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";

/** Department Head workspace; the API limits every figure to the departments the user heads. */
export default function DepartmentLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate anyPermissions={["dashboard.department.view"]}>{children}</ModuleAccessGate></AppShell>;
}
