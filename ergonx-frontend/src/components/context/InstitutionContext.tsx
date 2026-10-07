"use client";

import { createContext, useContext, useMemo } from "react";

import { useAuth } from "@/components/guards/AuthProvider";
import { hasModule as moduleEnabled } from "@/types/institutions";
import type { SessionInstitution } from "@/types/auth";

/**
 * Tenant context for screens.
 *
 * Derives from the session held by `AuthProvider`, so it follows the
 * development bypass institution until a real login replaces it. The tenant
 * selector actually sent to the backend (`X-Institution-ID`) is owned by the
 * API client, not by this context.
 */
interface InstitutionContextValue {
  institution: SessionInstitution | null;
  activeInstitution: SessionInstitution | null;
  institutionId: string | null;
  enabledModules: string[];
  /** Accepts both `HR` and the backend code `CORE_HR`. */
  hasModule: (module: string) => boolean;
}

const InstitutionContext = createContext<InstitutionContextValue>({
  institution: null,
  activeInstitution: null,
  institutionId: null,
  enabledModules: [],
  hasModule: () => false,
});

export default function InstitutionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { institution } = useAuth();

  const value = useMemo<InstitutionContextValue>(() => {
    const enabledModules = institution?.enabledModules ?? [];

    return {
      institution,
      activeInstitution: institution,
      institutionId: institution?.id ?? null,
      enabledModules,
      hasModule: (module: string) => moduleEnabled(enabledModules, module),
    };
  }, [institution]);

  return (
    <InstitutionContext.Provider value={value}>
      {children}
    </InstitutionContext.Provider>
  );
}

export function useInstitution() {
  return useContext(InstitutionContext);
}
