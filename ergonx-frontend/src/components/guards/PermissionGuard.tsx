"use client";

import { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import LoadingState from "../ui/LoadingState";

interface PermissionGuardProps {
  children: ReactNode;
  permission?: string;
  permissions?: string[];
  requireAll?: boolean;
}

export default function PermissionGuard({
  children,
  permission,
  permissions = [],
  requireAll = false,
}: PermissionGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingState />;
  }

  if (!user) {
    return null;
  }

  const required = [
    ...(permission ? [permission] : []),
    ...permissions,
  ];

  if (required.length === 0) {
    return <>{children}</>;
  }

  const userPermissions = user.permissions || [];

  // The development bypass user holds the "*" wildcard. Real institution
  // roles return explicit permission codes such as "employee.view".
  const hasWildcard = userPermissions.includes("*");

  const granted = (item: string) =>
    hasWildcard || userPermissions.includes(item);

  const allowed = requireAll
    ? required.every(granted)
    : required.some(granted);

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <h2 className="text-lg font-bold text-headline">
            Access Denied
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            You do not have permission to access this section.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
