"use client";

import type { ReactNode } from "react";

import { IconTile } from "@/components/ui/Card";
import { cx } from "@/lib/cx";
import type { ModuleAccent } from "@/lib/moduleTheme";
import { moduleAccents } from "@/lib/moduleTheme";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

interface KPIStatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  /** Legacy element icon (kept for existing callers). */
  icon?: ReactNode;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  href?: string;
  accent?: ModuleAccent;
}

/**
 * Legacy KPI API retained for existing routes; renders the Design System v2
 * metric-card treatment. New code should use `MetricCard` from ui/Card.
 */
export default function KPIStatCard({ title, value, subtitle, icon, trend, trendDirection = "neutral", href, accent = "brand" }: KPIStatCardProps) {
  const TrendIcon = trendDirection === "up" ? ArrowUpRight : trendDirection === "down" ? ArrowDownRight : Minus;
  const body = (
    <>
      <span aria-hidden="true" className={cx("pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-60 blur-2xl", moduleAccents[accent].soft)} />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-support font-medium text-ink-muted">{title}</p>
        {icon && <span className={cx("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg [&_svg]:h-[18px] [&_svg]:w-[18px]", moduleAccents[accent].tile)} aria-hidden="true">{icon}</span>}
      </div>
      <p className="relative mt-3 text-kpi-sm font-semibold tracking-tight text-ink-strong tabular-nums xl:text-kpi">{value}</p>
      {subtitle && <p className="relative mt-1 text-support text-ink-muted">{subtitle}</p>}
      {trend && (
        <p className={cx("relative mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold", trendDirection === "up" ? "bg-success-soft text-success-ink" : trendDirection === "down" ? "bg-danger-soft text-danger-ink" : "bg-neutral-soft text-neutral-ink")}>
          <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {trend}
        </p>
      )}
    </>
  );
  const classes = cx("relative block min-w-0 overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-elevation-1", href && "transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-elevation-2");
  return href ? <Link href={href} className={classes}>{body}</Link> : <article className={classes}>{body}</article>;
}

export { IconTile };
