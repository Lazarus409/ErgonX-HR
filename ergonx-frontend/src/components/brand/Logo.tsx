import Image from "next/image";

import { cx } from "@/lib/cx";

/**
 * ErgonX logo system. Asset roles are fixed (see docs/frontend/branding.md):
 *   primary   — full-colour lockup for login, onboarding, splash, product moments
 *   reversed  — the same lockup with a white wordmark for navy/dark surfaces
 *   mark      — the X symbol (collapsed sidebar, compact brand, mobile nav)
 *   mono      — single-colour navy lockup for reports, payslips, print, legal
 *   mono-white— single-colour white lockup for dark formal surfaces
 * Geometry is never altered; only the supplied derivatives are used.
 */
export type LogoVariant = "primary" | "reversed" | "mark" | "mono" | "mono-white";

const assets: Record<LogoVariant, { src: string; width: number; height: number }> = {
  primary: { src: "/brand/ergonx-logo-primary.png", width: 1185, height: 347 },
  reversed: { src: "/brand/ergonx-logo-primary-reversed.png", width: 1185, height: 347 },
  mark: { src: "/brand/ergonx-mark.png", width: 250, height: 265 },
  mono: { src: "/brand/ergonx-logo-mono.png", width: 1185, height: 347 },
  "mono-white": { src: "/brand/ergonx-logo-mono-white.png", width: 1185, height: 347 },
};

export interface LogoProps {
  variant?: LogoVariant;
  /** Rendered height in pixels; width follows the asset's aspect ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
  /** Decorative logos (next to a visible product name) should pass "". */
  alt?: string;
}

export default function Logo({ variant = "primary", height = 32, className, priority, alt = "ErgonX" }: LogoProps) {
  const asset = assets[variant];
  const width = Math.round((asset.width / asset.height) * height);
  return (
    <Image
      src={asset.src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      className={cx("select-none object-contain", className)}
      style={{ width, height }}
      draggable={false}
    />
  );
}

/** Light/dark adaptive full logo: primary on light surfaces, reversed in dark mode. */
export function AdaptiveLogo({ height = 32, className, priority }: Omit<LogoProps, "variant">) {
  return (
    <span className={cx("inline-flex", className)}>
      <Logo variant="primary" height={height} priority={priority} className="dark:hidden" />
      <Logo variant="reversed" height={height} priority={priority} className="hidden dark:block" alt="" />
    </span>
  );
}
