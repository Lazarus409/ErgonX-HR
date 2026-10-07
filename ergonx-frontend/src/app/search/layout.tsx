import AppShell from "@/components/layout/AppShell";
import ModuleAccessGate from "@/components/guards/ModuleAccessGate";

/** Global search results live inside the authenticated workspace shell. */
export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate anyPermissions={["search.use"]}>{children}</ModuleAccessGate></AppShell>;
}
