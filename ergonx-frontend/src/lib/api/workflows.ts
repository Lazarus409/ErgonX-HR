import { apiAction, apiDelete, apiGet, apiGetList, apiPatch, apiPost } from "./client";
import type { PaginatedData } from "@/types/api";
import type { ApprovalAction, ApprovalInbox, ApprovalRequest, ApprovalWorkflow, ApprovalWorkflowPayload, ApprovalWorkflowStep, ApprovalWorkflowStepPayload, InboxAction } from "@/types/workflows";

export function listApprovalWorkflows(): Promise<PaginatedData<ApprovalWorkflow>> { return apiGetList<ApprovalWorkflow>("/approval-workflows/", { ordering: "name" }); }
export function listApprovalRequests(): Promise<PaginatedData<ApprovalRequest>> { return apiGetList<ApprovalRequest>("/approval-requests/", { ordering: "-created_at" }); }
export function listApprovalActions(): Promise<PaginatedData<ApprovalAction>> { return apiGetList<ApprovalAction>("/approval-actions/", { ordering: "-acted_at" }); }
export function decideApprovalRequest(id: string, action: "approve" | "reject" | "return" | "cancel", comments: string): Promise<ApprovalRequest> { return apiAction<ApprovalRequest, { comments: string }>(`/approval-requests/${id}/${action}/`, { comments }); }

export function getApprovalInbox(): Promise<ApprovalInbox> { return apiGet<ApprovalInbox>("/approvals/inbox/"); }
/** Records a decision through the owning module's own endpoint, as named by the inbox. */
export function runInboxAction<T = unknown>(action: InboxAction, comment: string): Promise<T> { return apiAction<T>(action.path, action.comment_key ? { [action.comment_key]: comment } : {}); }

export function createApprovalWorkflow(payload: ApprovalWorkflowPayload): Promise<ApprovalWorkflow> { return apiPost<ApprovalWorkflow, ApprovalWorkflowPayload>("/approval-workflows/", payload); }
export function updateApprovalWorkflow(id: string, payload: Partial<ApprovalWorkflowPayload>): Promise<ApprovalWorkflow> { return apiPatch<ApprovalWorkflow, Partial<ApprovalWorkflowPayload>>(`/approval-workflows/${id}/`, payload); }
export function createApprovalWorkflowStep(payload: ApprovalWorkflowStepPayload): Promise<ApprovalWorkflowStep> { return apiPost<ApprovalWorkflowStep, ApprovalWorkflowStepPayload>("/approval-workflow-steps/", payload); }
export function updateApprovalWorkflowStep(id: string, payload: Partial<ApprovalWorkflowStepPayload>): Promise<ApprovalWorkflowStep> { return apiPatch<ApprovalWorkflowStep, Partial<ApprovalWorkflowStepPayload>>(`/approval-workflow-steps/${id}/`, payload); }
export function deleteApprovalWorkflowStep(id: string): Promise<void> { return apiDelete(`/approval-workflow-steps/${id}/`); }
