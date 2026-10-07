import ModuleAccessGate from "@/components/guards/ModuleAccessGate";
import AppShell from "@/components/layout/AppShell";
import { INSTITUTION_WIDE } from "@/components/navigation/navigation";

const TRAINING_PERMISSIONS = ["training.view", "training.manage"] as const;

export default function TrainingLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ModuleAccessGate module="HR" anyPermissions={TRAINING_PERMISSIONS} scopes={INSTITUTION_WIDE}>{children}</ModuleAccessGate></AppShell>;
}
