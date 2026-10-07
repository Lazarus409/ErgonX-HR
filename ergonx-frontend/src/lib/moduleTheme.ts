/**
 * Module accent system (Design System v2).
 *
 * Module colour is expressed through icon tiles, soft tints, accent lines,
 * chart series and selected states — never by painting a whole page. Class
 * strings are literal so Tailwind can detect them.
 */

export type ModuleAccent =
  | "hr"
  | "recruitment"
  | "leave"
  | "attendance"
  | "payroll"
  | "accounting"
  | "reports"
  | "audit"
  | "settings"
  | "brand";

export interface ModuleAccentClasses {
  /** Solid accent colour as text (icons, figures). */
  text: string;
  /** Soft tinted background (icon tiles, subtle section tints). */
  soft: string;
  /** Icon tile: soft background + accent icon colour. */
  tile: string;
  /** Solid background (accent bars, dots). */
  solid: string;
  /** Accent border (selected states, accent lines). */
  border: string;
  /** CSS variable holding the accent colour (charts, inline styles). */
  cssVar: string;
}

export const moduleAccents: Record<ModuleAccent, ModuleAccentClasses> = {
  hr: { text: "text-mod-hr", soft: "bg-mod-hr-soft", tile: "bg-mod-hr-soft text-mod-hr", solid: "bg-mod-hr", border: "border-mod-hr", cssVar: "var(--mod-hr)" },
  recruitment: { text: "text-mod-recruitment", soft: "bg-mod-recruitment-soft", tile: "bg-mod-recruitment-soft text-mod-recruitment", solid: "bg-mod-recruitment", border: "border-mod-recruitment", cssVar: "var(--mod-recruitment)" },
  leave: { text: "text-mod-leave", soft: "bg-mod-leave-soft", tile: "bg-mod-leave-soft text-mod-leave", solid: "bg-mod-leave", border: "border-mod-leave", cssVar: "var(--mod-leave)" },
  attendance: { text: "text-mod-attendance", soft: "bg-mod-attendance-soft", tile: "bg-mod-attendance-soft text-mod-attendance", solid: "bg-mod-attendance", border: "border-mod-attendance", cssVar: "var(--mod-attendance)" },
  payroll: { text: "text-mod-payroll", soft: "bg-mod-payroll-soft", tile: "bg-mod-payroll-soft text-mod-payroll", solid: "bg-mod-payroll", border: "border-mod-payroll", cssVar: "var(--mod-payroll)" },
  accounting: { text: "text-mod-accounting", soft: "bg-mod-accounting-soft", tile: "bg-mod-accounting-soft text-mod-accounting", solid: "bg-mod-accounting", border: "border-mod-accounting", cssVar: "var(--mod-accounting)" },
  reports: { text: "text-mod-reports", soft: "bg-mod-reports-soft", tile: "bg-mod-reports-soft text-mod-reports", solid: "bg-mod-reports", border: "border-mod-reports", cssVar: "var(--mod-reports)" },
  audit: { text: "text-mod-audit", soft: "bg-mod-audit-soft", tile: "bg-mod-audit-soft text-mod-audit", solid: "bg-mod-audit", border: "border-mod-audit", cssVar: "var(--mod-audit)" },
  settings: { text: "text-mod-settings", soft: "bg-mod-settings-soft", tile: "bg-mod-settings-soft text-mod-settings", solid: "bg-mod-settings", border: "border-mod-settings", cssVar: "var(--mod-settings)" },
  brand: { text: "text-primary", soft: "bg-primary-soft", tile: "bg-primary-soft text-primary", solid: "bg-primary", border: "border-primary", cssVar: "var(--primary)" },
};

/** Maps a route prefix onto its module accent (used by the shell and headers). */
export function accentForPath(pathname: string): ModuleAccent {
  if (pathname.startsWith("/recruitment")) return "recruitment";
  if (pathname.startsWith("/leave") || pathname.startsWith("/me/leave")) return "leave";
  if (pathname.startsWith("/attendance") || pathname.startsWith("/me/attendance")) return "attendance";
  if (pathname.startsWith("/payroll") || pathname.startsWith("/me/payslips")) return "payroll";
  if (pathname.startsWith("/accounting")) return "accounting";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/audit") || pathname.startsWith("/settings/audit")) return "audit";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/hr")) return "hr";
  return "brand";
}

const accentLabels: Record<ModuleAccent, string | null> = {
  hr: "Human Resources",
  recruitment: "Recruitment",
  leave: "Leave",
  attendance: "Attendance",
  payroll: "Payroll",
  accounting: "Accounting",
  reports: "Reports & Analytics",
  audit: "Audit",
  settings: "Settings",
  brand: null,
};

/** Human label for the module that owns a route, or null for cross-module pages. */
export function moduleLabelForPath(pathname: string): string | null {
  if (pathname.startsWith("/me")) return "My workspace";
  return accentLabels[accentForPath(pathname)];
}
