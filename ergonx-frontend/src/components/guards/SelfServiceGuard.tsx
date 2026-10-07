"use client";

import type { ReactNode } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import AccessDenied from "@/components/ui/AccessDenied";
import LoadingState from "@/components/ui/LoadingState";

export default function SelfServiceGuard({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();

  if (loading) {
    return <LoadingState />;
  }

  const permissions = user?.permissions ?? [];
  const eligible = permissions.includes("*") || [
    "leave.request", "attendance.clock", "payslip.view", "tax_relief.claim",
  ].some((permission) => permissions.includes(permission));

  if (!eligible) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
