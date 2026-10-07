"use client";

import { useState } from "react";

import Logo from "@/components/brand/Logo";
import { cx } from "@/lib/cx";

const MARK_SRC = "/brand/ergonx-mark.png";

/**
 * Sidebar brand transition (branding.md §Sidebar transition).
 *
 * Two layered assets share one fixed-size container so the header never
 * reflows. Collapsing, the reversed wordmark scales and fades toward the
 * symbol position while the X mark scales and fades in; expanding reverses
 * it. Each toggle plays one signature-gradient highlight across the X
 * (masked to the mark's shape) and never loops. Timing is 220 ms on the
 * standard curve; under prefers-reduced-motion the global rule makes the
 * swap instant and suppresses the highlight.
 */
export default function SidebarLogo({ collapsed }: { collapsed: boolean }) {
  // Count toggles (not the initial render) so the highlight plays once per change.
  const [previous, setPrevious] = useState(collapsed);
  const [toggles, setToggles] = useState(0);
  if (previous !== collapsed) {
    setPrevious(collapsed);
    setToggles((count) => count + 1);
  }

  return (
    <span className="relative block h-12 w-[156px]" aria-label="ErgonX" role="img">
      <span
        aria-hidden="true"
        className={cx(
          "absolute left-0 top-1/2 origin-left -translate-y-1/2 transition-[opacity,transform,filter] duration-220 ease-standard",
          collapsed ? "pointer-events-none scale-[0.72] opacity-0 blur-[1px]" : "scale-100 opacity-100 blur-0",
        )}
      >
        <Logo variant="reversed" height={40} alt="" priority />
      </span>
      <span
        aria-hidden="true"
        className={cx(
          "absolute left-0 top-1/2 -translate-y-1/2 transition-[opacity,transform] duration-220 ease-standard",
          collapsed ? "scale-100 opacity-100 delay-[40ms]" : "pointer-events-none scale-50 opacity-0",
        )}
      >
        <Logo variant="mark" height={34} alt="" priority />
        {toggles > 0 && (
          <span
            key={toggles}
            className="pointer-events-none absolute inset-0 animate-mark-highlight bg-[linear-gradient(110deg,transparent_30%,var(--accent-aqua)_45%,#ffffff_50%,var(--accent-violet)_55%,transparent_70%)] bg-[length:250%_100%] mix-blend-screen"
            style={{ WebkitMaskImage: `url(${MARK_SRC})`, maskImage: `url(${MARK_SRC})`, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }}
          />
        )}
      </span>
    </span>
  );
}
