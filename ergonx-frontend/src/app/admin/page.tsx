"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import SignInForm from "@/components/auth/SignInForm";
import { useAuth } from "@/components/guards/AuthProvider";
import LoadingState from "@/components/ui/LoadingState";

/** Super Admin entrance: /admin signs in to the platform console. */
export default function AdminSignInPage() {
  const { loading, isPlatformAdmin } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && isPlatformAdmin) router.replace("/platform");
  }, [loading, isPlatformAdmin, router]);
  if (loading || isPlatformAdmin) return <LoadingState variant="splash" />;
  return <SignInForm variant="platform" />;
}
