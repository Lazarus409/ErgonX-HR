/**
 * Leave types.
 *
 * Mirrors `apps/leave/serializers.py` and `apps/leave/models.py`.
 * Decimal fields arrive as strings to preserve precision.
 */

export type LeaveRequestStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const LEAVE_REQUEST_STATUSES: LeaveRequestStatus[] = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

export type LeaveApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "SKIPPED";

export type AccrualMethod = "NONE" | "ANNUAL" | "MONTHLY" | "DAILY";

export const ACCRUAL_METHODS: AccrualMethod[] = [
  "NONE",
  "ANNUAL",
  "MONTHLY",
  "DAILY",
];

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  description: string;
  is_paid: boolean;
  requires_approval: boolean;
  requires_attachment: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeavePolicy {
  id: string;
  leave_type: string;
  name: string;
  annual_entitlement: string;
  accrual_method: AccrualMethod | string;
  accrual_rate: string;
  max_carry_forward: string;
  min_service_days: number;
  max_consecutive_days: string | null;
  allow_negative_balance: boolean;
  requires_document: boolean;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  eligible_department_ids: string[];
  eligible_grade_ids: string[];
  eligible_location_ids: string[];
  /**
   * Write-only in practice. These two serializer fields have no matching
   * model attribute, so DRF skips them when rendering a response: they can be
   * sent on create/update but are absent from reads and will not round-trip
   * into an edit form.
   */
  eligible_employment_types?: string[];
  eligible_genders?: string[];
  created_at: string;
  updated_at: string;
}

export interface LeavePolicyPayload {
  leave_type: string;
  name: string;
  annual_entitlement: string | number;
  accrual_method: AccrualMethod | string;
  accrual_rate: string | number;
  max_carry_forward: string | number;
  min_service_days: number;
  max_consecutive_days?: string | number | null;
  allow_negative_balance: boolean;
  requires_document: boolean;
  effective_from: string;
  effective_to?: string | null;
  is_active?: boolean;
  eligible_department_ids?: string[];
  eligible_grade_ids?: string[];
  eligible_location_ids?: string[];
  eligible_employment_types?: string[];
  eligible_genders?: string[];
}

export interface LeaveBalance {
  id: string;
  employee: string;
  leave_type: string;
  year: number;
  opening_balance: string;
  accrued: string;
  used: string;
  adjusted: string;
  /** Derived by the backend: opening + accrued + adjusted - used. */
  available: string;
  created_at: string;
  updated_at: string;
}

export interface LeaveRequest {
  id: string;
  /** Stable human reference (LR-XXXXXXXX), matching universal search. */
  reference?: string;
  /** Set when a reviewer returned the request to the employee for changes. */
  changes_requested_at?: string | null;
  changes_requested_note?: string;
  employee: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  requested_days: string;
  reason: string;
  attachment: string | null;
  /** Read-only; changed through the submit/approve/reject/cancel actions. */
  status: LeaveRequestStatus | string;
  submitted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeaveRequestPayload {
  employee: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  requested_days: string | number;
  reason?: string;
  attachment?: string | null;
}

export interface LeaveApproval {
  id: string;
  leave_request: string;
  approver: string | null;
  approver_name?: string;
  delegated_from?: string | null;
  sequence: number;
  status: LeaveApprovalStatus | string;
  comment: string;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Filters supported by `GET /leave-requests/`. */
export interface LeaveRequestFilters {
  employee?: string;
  leave_type?: string;
  status?: LeaveRequestStatus | string;
  start_date?: string;
  end_date?: string;
}

export interface LeaveRequestComment {
  id: string;
  leave_request: string;
  author: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface LeavePolicyCheck {
  code: string;
  label: string;
  /** "not_evaluated" when a rule could not be checked (never treated as compliant). */
  status: "pass" | "warn" | "fail" | "not_evaluated" | string;
  detail: string;
}

export interface LeaveTeamAbsence {
  id: string;
  employee_id: string;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
  overlaps: boolean;
}

/** GET /leave-requests/{id}/review/ */
export interface LeaveReviewContext {
  reference: string;
  is_requester: boolean;
  employee_name: string;
  employee_number: string;
  department: string | null;
  position: string | null;
  employment_type: string | null;
  balance: { year: number; entitlement: string; used: string; available: string } | null;
  policy_checks: LeavePolicyCheck[];
  team_on_leave: LeaveTeamAbsence[];
  queue: { previous_id: string | null; next_id: string | null; position: number | null; total: number };
  can_decide: boolean;
  can_delegate: boolean;
}

export interface LeaveDelegateCandidate {
  id: string;
  name: string;
  role: string;
}
