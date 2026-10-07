import type { ReactNode } from "react";

import { AdaptiveLogo } from "@/components/brand/Logo";
import { cx } from "@/lib/cx";

/**
 * Public / authentication frame (Phase 2 Stitch S001/S002).
 *
 * A soft aurora canvas. Without `intro` the task sits in a centred 440px card
 * with the logo inside it (sign-in, password reset, invitations); `width="lg"`
 * widens the card for longer forms. Passing `intro` switches to the split
 * layout: brand, heading and help on the left, the task in a card on the right.
 */
export default function AuthShell({ children, width = "md", intro }: { children: ReactNode; width?: "md" | "lg"; intro?: ReactNode }) {
  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-auth-canvas">
      <AuthAurora />
      {intro ? (
        <div className="mx-auto grid min-h-screen w-full max-w-[1280px] items-start gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-center lg:gap-14 lg:px-12 xl:gap-16">
          <div className="animate-slide-up lg:sticky lg:top-16 lg:self-start lg:pt-24">
            <AdaptiveLogo height={44} priority />
            <div className="mt-8 lg:mt-10">{intro}</div>
          </div>
          <div className={cx(authCard, "min-w-0 animate-slide-up p-6 sm:p-10")}>
            {children}
          </div>
        </div>
      ) : (
        <div className="flex min-h-screen flex-col items-center px-4 py-8 sm:px-6">
          <div className="flex w-full flex-1 items-center justify-center py-6">
            <div className={cx(authCard, "w-full animate-slide-up p-8 sm:p-10", width === "md" ? "max-w-[440px]" : "max-w-2xl")}>
              <AdaptiveLogo height={36} priority />
              <div className="mt-8">{children}</div>
            </div>
          </div>
          <p className="text-caption text-ink-subtle">© {new Date().getFullYear()} ErgonX</p>
        </div>
      )}
    </main>
  );
}

const authCard = "rounded-2xl border border-line-soft bg-surface/95 shadow-[0_20px_25px_-5px_rgb(15_23_42/0.08),0_8px_10px_-6px_rgb(15_23_42/0.04)] backdrop-blur-md";

/** Stitch entry-screen aurora: two soft blue glows and a faint contour line. */
export function AuthAurora() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden dark:opacity-40">
      <div className="absolute -right-[18%] -top-[25%] h-[85vh] w-[70vw] rounded-full bg-[radial-gradient(closest-side,rgb(96_165_250/0.55),rgb(56_189_248/0.25)_55%,transparent)] blur-2xl" />
      <div className="absolute -bottom-[30%] -left-[15%] h-[70vh] w-[55vw] rounded-full bg-[radial-gradient(closest-side,rgb(147_197_253/0.35),transparent)] blur-2xl" />
      <svg className="absolute right-[8%] top-0 h-full w-[45%] opacity-60" viewBox="0 0 600 1000" preserveAspectRatio="none" fill="none">
        <path d="M120 -20 C 420 220 520 520 300 1020" stroke="rgb(96 165 250 / 0.45)" strokeWidth="1.5" strokeDasharray="6 8" />
        <path d="M40 -20 C 300 260 380 560 160 1020" stroke="rgb(255 255 255 / 0.7)" strokeWidth="1" />
      </svg>
    </div>
  );
}

/**
 * The concept's soft, translucent X ribbons. `right` sweeps across the right
 * of the page behind the sign-in form; `wide` frames a wider split layout;
 * `mirrored` places a ribbon on each side (splash).
 */
export function AuthBackdrop({ variant = "right" }: { variant?: "right" | "wide" | "mirrored" }) {
  const ribbons = (id: string) => (
    <>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#8ff0ff" stopOpacity="0.15" />
          <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.75" />
          <stop offset="75%" stopColor="#2f6bff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#7cf2ff" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="1" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#8b7cff" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <circle cx="560" cy="560" r="360" fill={`url(#${id}-glow)`} />
      {/* Left arc of the X */}
      <path d="M20 -60 C 380 110 610 330 570 540 C 530 760 330 900 170 1080 L 380 1080 C 520 900 700 760 720 540 C 740 320 520 100 200 -60 Z" fill={`url(#${id}-a)`} opacity="0.55" filter={`url(#${id}-soft)`} />
      <path d="M200 -60 C 520 100 740 320 720 540 C 700 760 520 900 380 1080" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2" fill="none" />
      {/* Right arc of the X */}
      <path d="M900 40 C 640 190 560 380 600 560 C 640 740 760 880 900 980 L 900 800 C 800 730 730 640 720 550 C 710 440 780 300 900 220 Z" fill={`url(#${id}-b)`} opacity="0.6" filter={`url(#${id}-soft)`} />
      <path d="M900 220 C 780 300 710 440 720 550 C 730 640 800 730 900 800" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="2" fill="none" />
      {/* Soft lower sweep */}
      <path d="M260 1080 C 420 900 640 820 900 760 L 900 1080 Z" fill={`url(#${id}-b)`} opacity="0.18" />
    </>
  );

  if (variant === "mirrored") {
    return (
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-80 dark:opacity-40">
        <svg className="absolute -left-[22rem] top-1/2 h-[120%] -translate-y-1/2 -scale-x-100" viewBox="0 0 900 1020" preserveAspectRatio="xMidYMid slice">{ribbons("bd-l")}</svg>
        <svg className="absolute -right-[22rem] top-1/2 h-[120%] -translate-y-1/2" viewBox="0 0 900 1020" preserveAspectRatio="xMidYMid slice">{ribbons("bd-r")}</svg>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={cx("pointer-events-none absolute inset-0 -z-10 overflow-hidden dark:opacity-45", variant === "wide" && "opacity-60")}>
      <svg
        className={cx("absolute top-0 h-full", variant === "right" ? "right-0 w-[150%] opacity-40 sm:opacity-60 lg:w-[62%] lg:opacity-100" : "-right-[10%] w-[90%]")}
        viewBox="0 0 900 1020"
        preserveAspectRatio="xMinYMid slice"
      >
        {ribbons(`bd-${variant}`)}
      </svg>
    </div>
  );
}

/** Form header used inside AuthShell. */
export function AuthHeading({ eyebrow, title, description }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-7">
      {eyebrow && <p className="mb-2 text-caption font-semibold uppercase tracking-[0.08em] text-primary-ink">{eyebrow}</p>}
      <h1 className="text-2xl font-bold leading-snug tracking-tight text-ink-strong sm:text-[1.75rem]">{title}</h1>
      {description && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p>}
    </div>
  );
}
