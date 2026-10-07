import type { ReactNode } from "react";
import { Info, type LucideIcon } from "lucide-react";

import { cx } from "@/lib/cx";

/**
 * Soft blue scope panel from the dashboard concepts ("Based on your access",
 * "Organization-wide view"). It states what the page's data covers; it never
 * gates anything itself.
 */
export default function ScopeNote({ title, children, icon: Icon = Info, solidIcon = false, className }: { title: ReactNode; children?: ReactNode; icon?: LucideIcon; solidIcon?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-start gap-3.5 rounded-2xl border border-primary/15 bg-primary-soft/70 px-4 py-3.5", className)}>
      <span className={cx("flex shrink-0 items-center justify-center rounded-full", solidIcon ? "h-11 w-11 bg-primary text-white" : "h-8 w-8 text-primary")} aria-hidden="true">
        <Icon className={solidIcon ? "h-5 w-5" : "h-6 w-6"} strokeWidth={solidIcon ? 2 : 1.8} />
      </span>
      <div className="min-w-0">
        <p className={cx("font-bold text-headline", solidIcon ? "text-[1.0625rem]" : "text-sm")}>{title}</p>
        {children && <div className="mt-0.5 text-support text-ink-muted">{children}</div>}
      </div>
    </div>
  );
}
