"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/guards/AuthProvider";
import LoadingState from "@/components/ui/LoadingState";

/** Keeps authenticated application shells out of anonymous sessions. */
export default function AuthenticationGate({ children }: { children: React.ReactNode }) {
  const { bootstrap, isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
  }, [bootstrap, isAuthenticated, loading, pathname, router]);

  if (loading || !isAuthenticated) return <LoadingState variant="splash" />;
  return <>{children}</>;
}
