import {
  Ban,
  CircleDashed,
  Clock3,
  Lock,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/Badge";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Canonical workflow/status chip: tinted pill, status dot and label (Stitch).
 * The label always carries the meaning, so it never depends on colour alone.
 */
const statusConfig: Record<string, { label: string; tone: BadgeTone; icon?: LucideIcon }> = {
  ACTIVE: { label: "Active", tone: "success" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  SUSPENDED: { label: "Suspended", tone: "warning", icon: TriangleAlert },
  TERMINATED: { label: "Terminated", tone: "danger", icon: Ban },
  PENDING: { label: "Pending", tone: "warning" },
  SUBMITTED: { label: "Submitted", tone: "warning" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  PENDING_REVIEW: { label: "Pending review", tone: "warning" },
  RETURNED: { label: "Changes requested", tone: "violet" },
  ADJUSTMENT_PENDING: { label: "Adjustment pending", tone: "warning" },
  NOT_STARTED: { label: "Not started", tone: "neutral", icon: CircleDashed },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  SKIPPED: { label: "Not required", tone: "neutral", icon: CircleDashed },
  BLOCKED: { label: "Needs attention", tone: "danger", icon: TriangleAlert },
  READY: { label: "Ready", tone: "success" },
  DRAFT: { label: "Draft", tone: "neutral", icon: CircleDashed },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "danger", icon: Ban },
  FINALIZED: { label: "Finalized", tone: "success", icon: Lock },
  POSTED: { label: "Posted", tone: "brand" },
  CLOSED: { label: "Closed", tone: "neutral", icon: Lock },
  OPEN: { label: "Open", tone: "info" },
  SENT: { label: "Sent", tone: "info" },
  ON_HOLD: { label: "On hold", tone: "violet" },
  GENERATED: { label: "Generated", tone: "success" },
  ON_TRACK: { label: "On track", tone: "success" },
  AT_RISK: { label: "At risk", tone: "warning" },
  OVER_BUDGET: { label: "Over budget", tone: "danger" },
  NO_ALLOCATION: { label: "No allocation", tone: "neutral" },
  NEEDS_REVIEW: { label: "Needs review", tone: "warning" },
  RECONCILED: { label: "Reconciled", tone: "success" },
  NOT_SENT: { label: "Not sent", tone: "neutral", icon: CircleDashed },
  NOT_SCHEDULED: { label: "Not scheduled", tone: "neutral", icon: CircleDashed },
  EXTENDED: { label: "Sent", tone: "info" },
  PAID: { label: "Paid", tone: "success" },
  PARTIALLY_PAID: { label: "Partially paid", tone: "info" },
  PART_PAID: { label: "Part paid", tone: "info" },
  ISSUED: { label: "Issued", tone: "info" },
  OVERDUE: { label: "Overdue", tone: "danger", icon: TriangleAlert },
  SCHEDULED: { label: "Scheduled", tone: "violet", icon: Clock3 },
  VOID: { label: "Void", tone: "danger", icon: Ban },
  VOIDED: { label: "Voided", tone: "danger", icon: Ban },
  REVERSED: { label: "Reversed", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  HIRED: { label: "Hired", tone: "success" },
  PUBLISHED: { label: "Published", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  PRESENT: { label: "Present", tone: "success" },
  LATE: { label: "Late", tone: "warning", icon: TriangleAlert },
  ABSENT: { label: "Absent", tone: "danger" },
  ON_LEAVE: { label: "On leave", tone: "info" },
  HOLIDAY: { label: "Holiday", tone: "violet" },
  OFF_DAY: { label: "Off day", tone: "neutral" },
  REMOTE: { label: "Remote", tone: "info" },
  UNMATCHED: { label: "Unmatched", tone: "warning", icon: TriangleAlert },
  MATCHED: { label: "Matched", tone: "success" },
  EXCEPTION: { label: "Exception", tone: "danger", icon: TriangleAlert },
};

function humanize(value: string): string {
  const words = value.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  const normalizedStatus = (status ?? "").toUpperCase();
  const config = statusConfig[normalizedStatus] ?? { label: humanize(status ?? ""), tone: "neutral" as BadgeTone };
  return (
    <Badge tone={config.tone} icon={config.icon} dot size={size} className={className}>
      {config.label}
    </Badge>
  );
}
