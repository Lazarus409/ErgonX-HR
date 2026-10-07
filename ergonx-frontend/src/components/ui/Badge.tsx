import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cx } from "@/lib/cx";
import { moduleAccents, type ModuleAccent } from "@/lib/moduleTheme";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral" | "brand" | "violet";

// Phase 2 (Stitch): light tint container, saturated label, 6px status dot.
export const badgeTones: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
  info: "bg-info-soft text-info-ink",
  neutral: "bg-neutral-soft text-neutral-ink",
  brand: "bg-primary-soft text-primary-ink",
  violet: "bg-mod-recruitment-soft text-mod-recruitment",
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Module-accent badge; overrides `tone`. */
  accent?: ModuleAccent;
  icon?: LucideIcon;
  /** Leading status dot, shown when there is no icon. */
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
  title?: string;
}

export function Badge({ children, tone = "neutral", accent, icon: Icon, dot = false, size = "md", className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full font-semibold",
        size === "md" ? "h-[1.375rem] px-2.5 text-caption" : "h-5 px-2 text-[0.6875rem]",
        accent ? cx(moduleAccents[accent].soft, moduleAccents[accent].text) : badgeTones[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export default Badge;
