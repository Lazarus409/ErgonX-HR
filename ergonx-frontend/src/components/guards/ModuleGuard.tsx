"use client";

import { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { hasModule } from "@/types/institutions";

export default function ModuleGuard({
  children,
  module,
}: {
  children: ReactNode;
  module: string;
}) {
  const { institution, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!institution) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <h2 className="text-lg font-bold text-headline">
            Institution Context Required
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            No active institution context is available.
          </p>
        </div>
      </div>
    );
  }

  // Accepts both the UI label "HR" and the backend module code "CORE_HR".
  if (!hasModule(institution.enabledModules, module)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <h2 className="text-lg font-bold text-headline">
            Module Disabled
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            This module is not enabled for this institution.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
