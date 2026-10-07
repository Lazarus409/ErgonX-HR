import { AuthBackdrop } from "@/components/brand/AuthShell";
import Logo, { AdaptiveLogo } from "@/components/brand/Logo";

/**
 * Restrained start-up treatment shown only while the session is genuinely
 * resolving (concept: Splash option 2 revised). The navy X tile breathes above
 * the full wordmark, framed by the brand ribbons, with a signature shimmer
 * under the status line. It never delays start-up: it disappears as soon as
 * the authenticated shell can render.
 */
export default function SplashScreen({ message = "Preparing your workspace…" }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[300] isolate flex flex-col items-center justify-center overflow-hidden bg-auth-canvas">
      <AuthBackdrop variant="mirrored" />
      <span className="relative flex h-28 w-28 items-center justify-center rounded-[28px] bg-brand-navy shadow-[0_18px_40px_-16px_rgb(11_27_61/0.55)] animate-splash-pulse">
        <Logo variant="mark" height={56} alt="" priority />
      </span>
      <span className="mt-7 block animate-wordmark-reveal" aria-hidden="true">
        <AdaptiveLogo height={64} />
      </span>
      <p className="mt-6 text-[1.0625rem] font-medium text-ink-muted">{message}</p>
      <div className="mt-6 h-1.5 w-64 overflow-hidden rounded-full bg-primary-soft" aria-hidden="true">
        <span className="block h-full w-full bg-[linear-gradient(90deg,transparent,var(--accent-aqua),var(--accent-blue),var(--accent-violet),transparent)] bg-[length:200%_100%] animate-shimmer" />
      </div>
    </div>
  );
}
