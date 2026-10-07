"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { cx } from "@/lib/cx";

/**
 * History-aware back affordance. Same-origin in-app entry goes back through
 * history; a direct link, bookmark, or cross-site referrer returns to the
 * logical parent instead of unexpectedly navigating away from ErgonX.
 */
export default function BackNavigation({ fallback, label = "Back", className }: { fallback: string; label?: string; className?: string }) {
  const router = useRouter();
  const goBack = () => {
    const cameFromThisApp = document.referrer
      ? new URL(document.referrer).origin === window.location.origin
      : false;
    if (cameFromThisApp && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallback);
  };
  return (
    <button
      type="button"
      onClick={goBack}
      className={cx("group inline-flex h-8 items-center gap-1.5 rounded-lg pl-1.5 pr-2.5 text-support font-semibold text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-strong", className)}
    >
      <ArrowLeft className="h-4 w-4 transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Design-system name for the same component. */
export { BackNavigation as BackButton };
