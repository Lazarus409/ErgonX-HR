import {
  CalendarDays,
  ClipboardCheck,
  Contact,
  FileText,
  GitPullRequest,
  GraduationCap,
  FileBarChart,
  House,
  LayoutDashboard,
  Network,
  Settings,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";

export type ModuleCode =
  | "HR"
  | "LEAVE"
  | "ATTENDANCE"
  | "PAYROLL"
  | "ACCOUNTING"
  | "RECRUITMENT"
  | "REPORTS";

/** Whose records the member works with; mirrors `common/scoping.py`. */
export type DataScope = "INSTITUTION" | "DEPARTMENT" | "SELF";

export type NavigationChild = {
  label: string;
  href: string;
  permission?: string;
  module?: ModuleCode;
  /** Exposes a linked workspace when the member has any listed capability. */
  anyPermissions?: readonly string[];
};

export type NavigationItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  module?: ModuleCode;
  permission?: string;
  /** Any one of these effective permissions exposes a module entry point. */
  anyPermissions?: readonly string[];
  /** Data scopes the entry is for; omitted means every scope. */
  scopes?: readonly DataScope[];
  /** A personal-workspace destination, shown only with a self-service capability. */
  selfService?: boolean;
  children?: NavigationChild[];
};

/**
 * Permissions that make someone a *user of a module workspace*. Self-service
 * permissions (`leave.view`, `attendance.clock`, `payslip.view`, ...) are
 * deliberately absent: they belong to "My workspace", not to the module.
 * One source of truth for sidebar entries and direct-route gates.
 */
export const moduleWorkspacePermissions = {
  HR: ["dashboard.hr.view", "organization.view", "organization.create", "organization.update", "organization.delete", "employee.view", "employee.create", "employee.update", "employee.delete", "employment.view", "employment.create", "employment.update", "employment.delete"],
  LEAVE: ["dashboard.leave.view", "leave.approve", "leave.reject", "leave.configure", "leave.balance.manage"],
  ATTENDANCE: ["dashboard.attendance.view", "attendance.manage", "attendance.approve", "schedule.manage"],
  PAYROLL: ["dashboard.payroll.view", "payroll.view", "payroll.configure", "payroll.prepare", "payroll.approve", "payroll.finalize", "compensation.configure", "compensation.manage", "tax_relief.approve"],
  ACCOUNTING: ["dashboard.finance.view", "budget.view", "accounting.configure", "account.view", "account.create", "account.update", "journal.view", "journal.create", "journal.approve", "journal.post", "journal.reverse", "financial_report.view", "accounting_period.close", "accounting_period.reopen", "vendor.view", "vendor.create", "vendor.update", "vendor_bill.view", "vendor_bill.create", "vendor_bill.approve", "vendor_bill.post", "vendor_bill.void", "customer.view", "customer.create", "customer.update", "invoice.view", "invoice.create", "invoice.issue", "invoice.void", "bank_account.view", "bank_account.create", "bank_account.update", "payment.view", "payment.create", "payment.void", "receipt.view", "receipt.create", "receipt.void", "expense.view", "expense.create", "expense.approve", "expense.post", "payroll_accounting.view", "payroll_accounting.configure", "bank_reconciliation.view", "bank_reconciliation.manage", "vat_withholding_certificate.view", "vat_withholding_certificate.issue"],
  RECRUITMENT: ["job_posting.view", "job_posting.create", "job_posting.update", "candidate.view", "candidate.create", "candidate.update", "recruitment_stage.view", "recruitment_stage.manage", "interview.view", "interview.manage", "candidate_evaluation.create", "offer.view", "offer.create", "offer.manage"],
  REPORTS: ["report.view"],
} as const;

/** Module workspaces work across the whole institution. */
export const INSTITUTION_WIDE: readonly DataScope[] = ["INSTITUTION"];

/**
 * Record pages inside a workspace that also open for people who reach the
 * record another way (their own leave request, a department head's team
 * member). The API still limits which records load.
 */
export const sharedRecordRoutes: Array<{ pattern: RegExp; anyPermissions: readonly string[]; scopes?: readonly DataScope[] }> = [
  { pattern: /^\/leave\/requests\/[^/]+$/, anyPermissions: ["leave.view"] },
  { pattern: /^\/payroll\/payslips\/[^/]+$/, anyPermissions: ["payslip.view"] },
  { pattern: /^\/leave\/calendar$/, anyPermissions: ["leave.view"], scopes: ["DEPARTMENT"] },
  { pattern: /^\/hr\/employees\/(?!new$)[^/]+$/, anyPermissions: ["employee.view"], scopes: ["DEPARTMENT"] },
];

/** Permissions that unlock at least one Insights section (`apps/dashboards/insights.py`). */
export const INSIGHT_PERMISSIONS = ["dashboard.executive.view", "dashboard.hr.view", "dashboard.payroll.view", "dashboard.finance.view", "dashboard.leave.view", "dashboard.attendance.view", "candidate.view", "background_job.view"] as const;

// Anyone who can decide something in a module gets the cross-module approvals inbox.
export const APPROVAL_PERMISSIONS = ["approval_request.view", "leave.approve", "attendance.approve", "payroll.approve", "tax_relief.approve", "job_posting.approve", "offer.approve", "journal.approve", "vendor_bill.approve", "expense.approve", "budget.approve"];

export const navigation: NavigationItem[] = [
  { label: "Home", href: "/", icon: House, permission: "home.view" },
  {
    label: "My Department / Functional Area",
    href: "/department",
    icon: Network,
    permission: "dashboard.department.view",
    scopes: ["DEPARTMENT"],
    children: [
      { label: "Overview", href: "/department", permission: "dashboard.department.view" },
      { label: "Leave approvals", href: "/department/approvals", permission: "leave.approve", module: "LEAVE" },
      { label: "Team leave calendar", href: "/leave/calendar", permission: "leave.view", module: "LEAVE" },
    ],
  },
  {
    label: "Human Resources",
    href: "/hr",
    icon: Users,
    // Every HR workspace sits in this one menu; each child keeps its own gate.
    anyPermissions: [
      "dashboard.executive.view",
      ...moduleWorkspacePermissions.HR,
      ...moduleWorkspacePermissions.RECRUITMENT,
      ...moduleWorkspacePermissions.LEAVE,
      ...moduleWorkspacePermissions.ATTENDANCE,
      "document_requirement.view",
      "training.view",
      "training.manage",
      "performance.view",
      "performance.manage",
    ],
    scopes: INSTITUTION_WIDE,
    children: [
      { label: "Executive Dashboard", href: "/dashboard", permission: "dashboard.executive.view" },
      { label: "HR Dashboard", href: "/hr/dashboard", module: "HR", permission: "dashboard.hr.view" },
      { label: "Employees", href: "/hr/employees", module: "HR", permission: "employee.view" },
      { label: "Organization", href: "/hr/organization", module: "HR", anyPermissions: ["organization.view", "organization.create", "organization.update"] },
      { label: "Recruitment", href: "/recruitment", module: "RECRUITMENT", anyPermissions: moduleWorkspacePermissions.RECRUITMENT },
      { label: "Leave", href: "/leave", module: "LEAVE", anyPermissions: moduleWorkspacePermissions.LEAVE },
      { label: "Attendance", href: "/attendance", module: "ATTENDANCE", anyPermissions: moduleWorkspacePermissions.ATTENDANCE },
      { label: "Document Checklist", href: "/hr/documents", module: "HR", permission: "document_requirement.view" },
      { label: "Training", href: "/training", module: "HR", anyPermissions: ["training.view", "training.manage"] },
      { label: "Performance", href: "/performance", module: "HR", anyPermissions: ["performance.view", "performance.manage"] },
    ],
  },
  {
    label: "Reports & Analytics",
    href: "/reports",
    icon: FileBarChart,
    module: "REPORTS",
    anyPermissions: moduleWorkspacePermissions.REPORTS,
    scopes: INSTITUTION_WIDE,
  },
  { label: "Approvals", href: "/approvals", icon: GitPullRequest, anyPermissions: APPROVAL_PERMISSIONS },
  { label: "Audit Trail", href: "/audit", icon: ShieldCheck, permission: "audit.view" },
  { label: "Users & Access", href: "/settings/users", icon: Users, permission: "settings.users.manage" },
  // Everyone keeps Settings for their own security and notifications; the page filters its cards.
  { label: "Settings", href: "/settings", icon: Settings, permission: "home.view" },
];

/** Shared visibility rule for sidebar entries, landing cards and route gates. */
export function canAccess(
  item: { module?: string; permission?: string; anyPermissions?: readonly string[]; scopes?: readonly DataScope[] },
  context: { can: (permission: string) => boolean; moduleEnabled: (module: string) => boolean; scope: DataScope },
): boolean {
  if (item.scopes && !item.scopes.includes(context.scope)) return false;
  if (item.module && !context.moduleEnabled(item.module)) return false;
  if (item.permission && !context.can(item.permission)) return false;
  if (item.anyPermissions?.length && !item.anyPermissions.some(context.can)) return false;
  return true;
}

export const selfServiceNavigation: NavigationItem[] = [
  {
    label: "Employee Home",
    href: "/me",
    icon: House,
    permission: "home.view",
    selfService: true,
  },
  {
    label: "My Profile",
    href: "/me/profile",
    icon: Users,
    permission: "home.view",
    selfService: true,
  },
  {
    label: "My Leave",
    href: "/me/leave",
    icon: CalendarDays,
    module: "LEAVE",
    permission: "leave.request",
    selfService: true,
  },
  {
    label: "My Attendance",
    href: "/me/attendance",
    icon: ClipboardCheck,
    module: "ATTENDANCE",
    permission: "attendance.view",
    selfService: true,
  },
  {
    label: "My Performance",
    href: "/me/performance",
    icon: Target,
    permission: "home.view",
    selfService: true,
  },
  {
    label: "My Training",
    href: "/me/training",
    icon: GraduationCap,
    permission: "home.view",
    selfService: true,
  },
  {
    label: "Emergency Contacts",
    href: "/me/emergency-contacts",
    icon: Contact,
    permission: "home.view",
    selfService: true,
  },
  {
    label: "My Documents",
    href: "/me/documents",
    icon: FileText,
    permission: "home.view",
    selfService: true,
  },
];
