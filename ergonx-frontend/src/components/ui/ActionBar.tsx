import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * Form/detail action row. `sticky` pins it to the bottom of the viewport on
 * long forms so the primary action is always reachable.
 */
export default function ActionBar({ children, secondary, sticky = false, className }: { children: ReactNode; secondary?: ReactNode; sticky?: boolean; className?: string }) {
  return (
    <div
      className={cx(
        "flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between",
        sticky ? "sticky bottom-0 z-20 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6" : "border-t border-line-soft pt-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-support text-ink-muted">{secondary}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

export { ActionBar };
