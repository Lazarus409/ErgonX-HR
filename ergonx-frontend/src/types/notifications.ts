/** Category a notification belongs to; derived by the API from its type and record. */
export type NotificationModule = "APPROVALS" | "HR" | "LEAVE" | "ATTENDANCE" | "PAYROLL" | "RECRUITMENT" | "ACCOUNTING" | "REPORTS" | "SECURITY" | "SYSTEM";

export const NOTIFICATION_MODULE_LABELS: Record<NotificationModule, string> = {
  APPROVALS: "Approvals",
  HR: "HR",
  LEAVE: "Leave",
  ATTENDANCE: "Attendance",
  PAYROLL: "Payroll",
  RECRUITMENT: "Recruitment",
  ACCOUNTING: "Accounting",
  REPORTS: "Reports",
  SECURITY: "Security",
  SYSTEM: "System",
};

export type NotificationBulkAction = "mark_read" | "archive" | "unarchive";

export interface AppNotification {
  id: string;
  notification_type: string;
  module?: NotificationModule;
  title: string;
  message: string;
  status: string;
  is_read: boolean;
  is_archived?: boolean;
  created_at: string;
  read_at: string | null;
  archived_at?: string | null;
  metadata: Record<string, unknown>;
  /** Allow-listed internal route; the target page re-checks access when opened. */
  route_hint?: string | null;
}

export interface NotificationPreferences {
  /** Modules that also arrive by email. In-app notifications cannot be muted. */
  email_modules: NotificationModule[];
  /** False when the institution turned notification email off or email is not configured. */
  email_available: boolean;
}
