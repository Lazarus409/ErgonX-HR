import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";

/** Documents retain the global navigation while endpoint permissions remain authoritative. */
export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate anyPermissions={["document.view"]}>{children}</ModuleAccessGate></AppShell>;
}
