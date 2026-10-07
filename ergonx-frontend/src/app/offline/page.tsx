import Link from "next/link";
import { WifiOff } from "lucide-react";

import { AdaptiveLogo } from "@/components/brand/Logo";

export const dynamic = "force-static";

/** Generic fallback only; authenticated work and API responses are never cached. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-elevation-2">
        <AdaptiveLogo height={28} className="justify-center" />
        <span className="mx-auto mt-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-soft text-neutral-ink" aria-hidden="true"><WifiOff className="h-6 w-6" /></span>
        <h1 className="mt-5 text-heading font-semibold text-ink-strong">You are offline</h1>
        <p className="mt-2 text-support text-ink-muted">ErgonX does not cache institution records or authenticated actions. Reconnect to continue securely.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">Try again</Link>
      </section>
    </main>
  );
}
