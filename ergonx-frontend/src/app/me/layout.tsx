import type { ReactNode } from "react";

import SelfServiceGuard from "@/components/guards/SelfServiceGuard";
import AuthenticationGate from "@/components/guards/AuthenticationGate";
import AppShell from "@/components/layout/AppShell";

export default function EmployeeSelfServiceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthenticationGate>
      <SelfServiceGuard>
        <AppShell>{children}</AppShell>
      </SelfServiceGuard>
    </AuthenticationGate>
  );
}
