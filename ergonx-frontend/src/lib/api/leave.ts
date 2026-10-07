/**
 * Leave service (module `LEAVE`).
 *
 * Endpoints:
 *   /leave-types/           configuration
 *   /leave-policies/        configuration
 *   /leave-balances/        + /accrue/, /carry-forward/
 *   /leave-requests/        + /calendar/, /submit/, /approve/, /reject/, /cancel/
 *   /leave-approvals/       read-only approval trail
 *
 * `/leave-requests/` accepts GET, POST and PATCH (drafts only, by the
 * requester). Status is read-only and is changed exclusively through the
 * action endpoints below. Approved balances are consumed and restored by the
 * backend.
 */

import { apiAction, apiDelete, apiGet, apiGetList, apiPatch, apiPost } from "./client";
import type { ListParams, PaginatedData } from "@/types/api";
import type {
  LeaveApproval,
  LeaveBalance,
  LeaveDelegateCandidate,
  LeaveRequestComment,
  LeaveReviewContext,
  LeavePolicy,
  LeavePolicyPayload,
  LeaveRequest,
  LeaveRequestFilters,
  LeaveRequestPayload,
  LeaveType,
} from "@/types/leave";

/* Leave types -------------------------------------------------------------- */

export async function listLeaveTypes(
  params?: ListParams,
): Promise<PaginatedData<LeaveType>> {
  return apiGetList<LeaveType>("/leave-types/", params);
}

export async function getLeaveType(id: string): Promise<LeaveType> {
  return apiGet<LeaveType>(`/leave-types/${id}/`);
}

export async function createLeaveType(
  payload: Partial<LeaveType>,
): Promise<LeaveType> {
  return apiPost<LeaveType, Partial<LeaveType>>("/leave-types/", payload);
}

export async function updateLeaveType(
  id: string,
  payload: Partial<LeaveType>,
): Promise<LeaveType> {
  return apiPatch<LeaveType, Partial<LeaveType>>(`/leave-types/${id}/`, payload);
}

export async function deleteLeaveType(id: string): Promise<void> {
  return apiDelete(`/leave-types/${id}/`);
}

/* Policies ----------------------------------------------------------------- */

export async function listLeavePolicies(
  params?: ListParams,
): Promise<PaginatedData<LeavePolicy>> {
  return apiGetList<LeavePolicy>("/leave-policies/", params);
}

export async function getLeavePolicy(id: string): Promise<LeavePolicy> {
  return apiGet<LeavePolicy>(`/leave-policies/${id}/`);
}

export async function createLeavePolicy(
  payload: LeavePolicyPayload,
): Promise<LeavePolicy> {
  return apiPost<LeavePolicy, LeavePolicyPayload>("/leave-policies/", payload);
}

export async function updateLeavePolicy(
  id: string,
  payload: Partial<LeavePolicyPayload>,
): Promise<LeavePolicy> {
  return apiPatch<LeavePolicy, Partial<LeavePolicyPayload>>(
    `/leave-policies/${id}/`,
    payload,
  );
}

export async function deleteLeavePolicy(id: string): Promise<void> {
  return apiDelete(`/leave-policies/${id}/`);
}

/* Balances ----------------------------------------------------------------- */

export interface LeaveBalanceFilters extends ListParams {
  employee?: string;
  leave_type?: string;
  year?: number;
}

export async function listLeaveBalances(
  params?: LeaveBalanceFilters,
): Promise<PaginatedData<LeaveBalance>> {
  return apiGetList<LeaveBalance>("/leave-balances/", params);
}

export async function accrueLeaveBalance(
  id: string,
  payload: { amount?: string | number; as_of_date?: string } = {},
): Promise<LeaveBalance> {
  return apiAction<LeaveBalance>(`/leave-balances/${id}/accrue/`, payload);
}

export async function carryForwardLeaveBalance(
  id: string,
  payload: { target_year?: number } = {},
): Promise<LeaveBalance> {
  return apiAction<LeaveBalance>(
    `/leave-balances/${id}/carry-forward/`,
    payload,
  );
}

/* Requests ----------------------------------------------------------------- */

export type LeaveRequestListParams = ListParams & LeaveRequestFilters;

export async function listLeaveRequests(
  params?: LeaveRequestListParams,
): Promise<PaginatedData<LeaveRequest>> {
  return apiGetList<LeaveRequest>("/leave-requests/", params);
}

export async function getLeaveRequest(id: string): Promise<LeaveRequest> {
  return apiGet<LeaveRequest>(`/leave-requests/${id}/`);
}

/** Creates a DRAFT request. Submit it separately to start approval. */
export async function createLeaveRequest(
  payload: LeaveRequestPayload,
): Promise<LeaveRequest> {
  return apiPost<LeaveRequest, LeaveRequestPayload>(
    "/leave-requests/",
    payload,
  );
}

/**
 * Calendar projection: PENDING and APPROVED requests overlapping the range.
 * Dates are `YYYY-MM-DD`.
 */
export async function getLeaveCalendar(
  params: ListParams & { date_from?: string; date_to?: string },
): Promise<PaginatedData<LeaveRequest>> {
  return apiGetList<LeaveRequest>("/leave-requests/calendar/", params);
}

/* Workflow transitions ----------------------------------------------------- */

export async function submitLeaveRequest(id: string): Promise<LeaveRequest> {
  return apiAction<LeaveRequest>(`/leave-requests/${id}/submit/`);
}

export async function approveLeaveRequest(
  id: string,
  comment = "",
): Promise<LeaveRequest> {
  return apiAction<LeaveRequest>(`/leave-requests/${id}/approve/`, { comment });
}

export async function rejectLeaveRequest(
  id: string,
  comment = "",
): Promise<LeaveRequest> {
  return apiAction<LeaveRequest>(`/leave-requests/${id}/reject/`, { comment });
}

export async function cancelLeaveRequest(id: string): Promise<LeaveRequest> {
  return apiAction<LeaveRequest>(`/leave-requests/${id}/cancel/`);
}

/** Returns a pending request to the employee as an editable draft. */
export async function requestLeaveChanges(id: string, comment: string): Promise<LeaveRequest> {
  return apiAction<LeaveRequest>(`/leave-requests/${id}/request-changes/`, { comment });
}

/** Hands the active approval step to another leave approver. */
export async function delegateLeaveRequest(id: string, delegate: string, comment = ""): Promise<LeaveRequest> {
  return apiAction<LeaveRequest>(`/leave-requests/${id}/delegate/`, { delegate, comment });
}

export async function listLeaveDelegates(id: string): Promise<LeaveDelegateCandidate[]> {
  return apiGet<LeaveDelegateCandidate[]>(`/leave-requests/${id}/delegates/`);
}

/** Edits a draft request (new, or returned for changes). */
export async function updateLeaveRequest(id: string, payload: Partial<LeaveRequestPayload>): Promise<LeaveRequest> {
  return apiPatch<LeaveRequest, Partial<LeaveRequestPayload>>(`/leave-requests/${id}/`, payload);
}

export async function getLeaveReview(id: string): Promise<LeaveReviewContext> {
  return apiGet<LeaveReviewContext>(`/leave-requests/${id}/review/`);
}

export async function listLeaveComments(id: string): Promise<LeaveRequestComment[]> {
  return apiGet<LeaveRequestComment[]>(`/leave-requests/${id}/comments/`);
}

export async function addLeaveComment(id: string, body: string): Promise<LeaveRequestComment> {
  return apiPost<LeaveRequestComment, { body: string }>(`/leave-requests/${id}/comments/`, { body });
}

/* Approvals ---------------------------------------------------------------- */

export async function listLeaveApprovals(
  params?: ListParams & {
    leave_request?: string;
    approver?: string;
    status?: string;
  },
): Promise<PaginatedData<LeaveApproval>> {
  return apiGetList<LeaveApproval>("/leave-approvals/", params);
}
