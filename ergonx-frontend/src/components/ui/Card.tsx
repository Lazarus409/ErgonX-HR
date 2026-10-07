"use client";

import Link from "next/link";
import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { ArrowRight, ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

import { cx } from "@/lib/cx";
import { moduleAccents, type ModuleAccent } from "@/lib/moduleTheme";

/* -------------------------------------------------------------------------- */
/* Surface / Card                                                              */
/* -------------------------------------------------------------------------- */

type Elevation = 0 | 1 | 2 | 3;
const elevations: Record<Elevation, string> = { 0: "", 1: "shadow-elevation-1", 2: "shadow-elevation-2", 3: "shadow-elevation-3" };

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  tone?: "default" | "muted" | "sunken" | "inverse";
  elevation?: Elevation;
  padding?: "none" | "sm" | "md" | "lg";
  bordered?: boolean;
  radius?: "md" | "lg" | "hero";
}

const tones = {
  default: "bg-surface text-ink",
  muted: "bg-surface-muted text-ink",
  sunken: "bg-surface-sunken text-ink",
  inverse: "bg-brand-navy text-white",
};
const paddings = { none: "", sm: "p-4", md: "p-5", lg: "p-6 sm:p-7" };
const radii = { md: "rounded-xl", lg: "rounded-2xl", hero: "rounded-3xl" };

export function Surface({ as: Tag = "div", tone = "default", elevation = 1, padding = "md", bordered = true, radius = "lg", className, ...rest }: SurfaceProps) {
  return <Tag className={cx(tones[tone], elevations[elevation], paddings[padding], radii[radius], bordered && tone !== "inverse" && "border border-line", className)} {...rest} />;
}

export interface CardProps extends Omit<SurfaceProps, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: LucideIcon;
  accent?: ModuleAccent;
  /** Thin module-coloured accent line along the top edge. */
  accentLine?: boolean;
}

export function Card({ title, description, actions, icon, accent, accentLine, children, className, as = "section", ...rest }: CardProps) {
  void accentLine;
  return (
    <Surface as={as} className={cx("relative min-w-0 overflow-hidden", className)} {...rest}>
      {/* The concept drops module-coloured top strips; `accentLine` is kept for API compatibility. */}
      {(title || actions) && <CardHeader title={title} description={description} actions={actions} icon={icon} accent={accent} />}
      {children}
    </Surface>
  );
}

export function CardHeader({ title, description, actions, icon: Icon, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon; accent?: ModuleAccent; className?: string }) {
  // Concept card header: plain navy section icon, bold navy title, blue supporting line.
  return (
    <div className={cx("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <Icon className="mt-0.5 h-6 w-6 shrink-0 text-section-icon" strokeWidth={2} aria-hidden="true" />}
        <div className="min-w-0">
          {title && <h2 className="text-card-title font-bold text-headline">{title}</h2>}
          {description && <p className="mt-0.5 text-support text-heading-support">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function IconTile({ icon: Icon, accent = "brand", size = "md", className }: { icon: LucideIcon; accent?: ModuleAccent; size?: "sm" | "md" | "lg"; className?: string }) {
  const dims = { sm: "h-8 w-8 rounded-lg [&_svg]:h-4 [&_svg]:w-4", md: "h-10 w-10 rounded-lg [&_svg]:h-5 [&_svg]:w-5", lg: "h-12 w-12 rounded-xl [&_svg]:h-[22px] [&_svg]:w-[22px]" }[size];
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center", moduleAccents[accent].tile, dims, className)} aria-hidden="true">
      <Icon />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* MetricCard (KPI)                                                            */
/* -------------------------------------------------------------------------- */

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  accent?: ModuleAccent;
  trend?: { direction: "up" | "down" | "flat"; label: string; /** Whether "up" is good for this metric. */ positiveIsGood?: boolean };
  loading?: boolean;
  href?: string;
  size?: "md" | "sm";
  footer?: ReactNode;
  /** Compact visual under the value, e.g. a <Sparkline /> of the recent trend. */
  chart?: ReactNode;
  className?: string;
}

/** Plain text of a rendered value, used only to pick a type size. */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

export function MetricCard({ label, value, description, icon, accent = "brand", trend, loading, href, size = "md", footer, chart, className }: MetricCardProps) {
  const good = trend ? (trend.direction === "flat" ? null : (trend.direction === "up") === (trend.positiveIsGood ?? true)) : null;
  const TrendIcon = trend?.direction === "up" ? ArrowUpRight : trend?.direction === "down" ? ArrowDownRight : Minus;
  const Icon = icon;
  // Long formatted values (currency) step down a size instead of wrapping.
  const long = textOf(value).length > 9;
  // Concept KPI tile: soft circular icon on the left, bold label, large value.
  const body = (
    <>
      <div className="relative flex items-start gap-4">
        {Icon && (
          <span className={cx("inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full", moduleAccents[accent].tile)} aria-hidden="true">
            <Icon className="h-6 w-6" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-bold leading-5 text-headline">{label}</p>
          <div className="mt-2">
            {loading ? (
              <span className="skeleton block h-8 w-28 rounded-lg" aria-label="Loading" />
            ) : (
              <p className={cx("font-bold leading-tight tracking-tight text-ink-strong tabular-nums", long ? "whitespace-nowrap text-[1.1875rem] 2xl:text-[1.5rem]" : size === "md" ? "text-[1.75rem] 2xl:text-kpi" : "text-kpi-sm")}>{value}</p>
            )}
            {description && <p className="mt-1 text-support text-ink-muted">{description}</p>}
          </div>
        </div>
      </div>
      {chart && !loading && <div className="relative -mx-1 mt-3">{chart}</div>}
      {trend && !loading && (
        <p className={cx("relative mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold", good === null ? "bg-neutral-soft text-neutral-ink" : good ? "bg-success-soft text-success-ink" : "bg-danger-soft text-danger-ink")}>
          <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {trend.label}
        </p>
      )}
      {footer && <div className="relative mt-3 border-t border-line-soft pt-3 text-support text-ink-muted">{footer}</div>}
    </>
  );
  const classes = cx("relative block min-w-0 overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-elevation-1", href && "transition-[box-shadow,border-color] duration-200 ease-standard hover:border-line-strong hover:shadow-elevation-2", className);
  return href ? <Link href={href} className={classes}>{body}</Link> : <article className={classes}>{body}</article>;
}

/* -------------------------------------------------------------------------- */
/* Insight / Action / Attention / Summary / Profile cards                      */
/* -------------------------------------------------------------------------- */

/** An interpretive card: a short statement about the data plus supporting figure. */
export function InsightCard({ title, children, icon: Icon, accent = "brand", className }: { title: ReactNode; children: ReactNode; icon?: LucideIcon; accent?: ModuleAccent; className?: string }) {
  return (
    <article className={cx("relative overflow-hidden rounded-2xl border border-line p-5", moduleAccents[accent].soft, className)}>
      <div className="flex items-start gap-3">
        {Icon && <span className={cx("mt-0.5 inline-flex", moduleAccents[accent].text)}><Icon className="h-5 w-5" aria-hidden="true" /></span>}
        <div className="min-w-0">
          <h3 className="text-card-title font-bold text-ink-strong">{title}</h3>
          <div className="mt-1 text-support text-ink">{children}</div>
        </div>
      </div>
    </article>
  );
}

export function ActionCard({ href, title, description, icon, accent = "brand", cta = "Open", className }: { href: string; title: ReactNode; description?: ReactNode; icon?: LucideIcon; accent?: ModuleAccent; cta?: string; className?: string }) {
  return (
    <Link href={href} className={cx("group relative flex min-h-40 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-5 shadow-elevation-1 transition-[box-shadow,border-color] duration-200 ease-standard hover:border-line-strong hover:shadow-elevation-2", className)}>
      <span aria-hidden="true" className={cx("absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 transition-transform duration-300 ease-standard group-hover:scale-x-100", moduleAccents[accent].solid)} />
      <div className="flex items-start justify-between gap-4">
        {icon ? <IconTile icon={icon} accent={accent} /> : <span />}
        <ArrowRight className="h-5 w-5 text-ink-subtle transition-transform duration-200 group-hover:translate-x-1 group-hover:text-ink-strong" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-card-title font-bold text-ink-strong">{title}</h3>
      {description && <p className="mt-1 text-support text-ink-muted">{description}</p>}
      <span className={cx("mt-auto pt-4 text-support font-semibold", moduleAccents[accent].text)}>{cta}</span>
    </Link>
  );
}

const severityStyles = {
  critical: { bar: "bg-danger", chip: "bg-danger-soft text-danger-ink", label: "Critical" },
  high: { bar: "bg-danger", chip: "bg-danger-soft text-danger-ink", label: "High" },
  warning: { bar: "bg-warning", chip: "bg-warning-soft text-warning-ink", label: "Attention" },
  medium: { bar: "bg-warning", chip: "bg-warning-soft text-warning-ink", label: "Medium" },
  info: { bar: "bg-info", chip: "bg-info-soft text-info-ink", label: "Info" },
  low: { bar: "bg-info", chip: "bg-info-soft text-info-ink", label: "Low" },
} as const;

export function severityStyle(severity: string | null | undefined) {
  const key = (severity ?? "info").toLowerCase() as keyof typeof severityStyles;
  return severityStyles[key] ?? severityStyles.info;
}

/** A single attention item row: severity bar, title, description, optional link. */
export function AttentionItem({ title, description, severity, href, meta }: { title: ReactNode; description?: ReactNode; severity?: string; href?: string; meta?: ReactNode }) {
  const style = severityStyle(severity);
  const content = (
    <span className="flex items-stretch gap-3">
      <span aria-hidden="true" className={cx("w-1 shrink-0 rounded-full", style.bar)} />
      <span className="min-w-0 flex-1 py-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink-strong">{title}</span>
          <span className={cx("rounded-full px-2 py-0.5 text-caption font-semibold", style.chip)}>{style.label}</span>
        </span>
        {description && <span className="mt-0.5 block text-support text-ink-muted">{description}</span>}
        {meta && <span className="mt-1 block text-caption text-ink-subtle">{meta}</span>}
      </span>
      {href && <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink-strong" aria-hidden="true" />}
    </span>
  );
  return href ? <Link href={href} className="group block rounded-xl p-3 transition-colors hover:bg-surface-hover">{content}</Link> : <div className="rounded-xl p-3">{content}</div>;
}

/** Compact label/value summary list. */
export function SummaryList({ items, className }: { items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode }>; className?: string }) {
  return (
    <dl className={cx("divide-y divide-line-soft", className)}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="min-w-0 text-support text-ink-muted">
            {item.label}
            {item.hint && <span className="block text-caption text-ink-subtle">{item.hint}</span>}
          </dt>
          <dd className="shrink-0 text-sm font-semibold text-ink-strong tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SummaryCard({ title, description, items, icon, accent, actions, className }: { title: ReactNode; description?: ReactNode; items: Array<{ label: ReactNode; value: ReactNode; hint?: ReactNode }>; icon?: LucideIcon; accent?: ModuleAccent; actions?: ReactNode; className?: string }) {
  return (
    <Card title={title} description={description} icon={icon} accent={accent} actions={actions} className={className}>
      <SummaryList items={items} />
    </Card>
  );
}

export function Avatar({ name, src, size = "md", solid = false, className }: { name: string; src?: string | null; size?: "sm" | "md" | "lg"; /** Solid brand-blue initials disc (top bar identity). */ solid?: boolean; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  const dims = { sm: "h-8 w-8 text-caption", md: "h-10 w-10 text-support", lg: "h-14 w-14 text-body" }[size];
  // Deterministic hue from the name keeps avatars stable between renders.
  const palette = ["bg-mod-hr-soft text-mod-hr", "bg-mod-leave-soft text-mod-leave", "bg-mod-recruitment-soft text-mod-recruitment", "bg-mod-attendance-soft text-mod-attendance", "bg-mod-payroll-soft text-mod-payroll", "bg-mod-accounting-soft text-mod-accounting"];
  const tone = solid ? "bg-primary text-white" : palette[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold", dims, !src && tone, className)} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initials}
    </span>
  );
}

export function ProfileCard({ name, subtitle, meta, avatarSrc, actions, className }: { name: string; subtitle?: ReactNode; meta?: ReactNode; avatarSrc?: string | null; actions?: ReactNode; className?: string }) {
  return (
    <Surface className={cx("flex flex-col gap-4 sm:flex-row sm:items-center", className)}>
      <Avatar name={name} src={avatarSrc} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-heading font-semibold text-ink-strong">{name}</p>
        {subtitle && <p className="truncate text-support text-ink-muted">{subtitle}</p>}
        {meta && <div className="mt-2 flex flex-wrap gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </Surface>
  );
}

/** Section heading used between dashboard blocks. */
export function SectionHeading({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div>
        <h2 className="text-heading font-bold text-headline">{title}</h2>
        {description && <p className="mt-0.5 text-support text-heading-support">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export default Card;
