import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";

/** Import, export, and job-monitoring screens share the authenticated application frame. */
export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate allPermissions={["import_job.view", "export_job.view", "background_job.view"]}>{children}</ModuleAccessGate></AppShell>;
}
