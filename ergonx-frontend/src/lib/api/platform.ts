/**
 * Super Admin (platform) console endpoints: organizations directory,
 * overview metrics and the platform audit feed. Platform administrators only.
 */

import { apiGet, apiGetList, apiPost } from "./client";
import type { PaginatedData } from "@/types/api";

export type OnboardingStatus = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "READY";
export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "INACTIVE";

export interface PlatformInstitution {
  id: string;
  name: string;
  code: string;
  institution_type: string;
  country_code: string;
  email: string;
  is_active: boolean;
  suspended_at: string | null;
  created_at: string;
  member_count: number;
  employee_count: number;
  last_sign_in_at: string | null;
  onboarding_status: OnboardingStatus;
  primary_admin: { name: string; email: string } | null;
}

export interface PlatformAuditEvent {
  id: string;
  created_at: string;
  action: string;
  actor_email: string | null;
  institution: { id: string; name: string } | null;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
}

export interface PlatformInstitutionDetail extends PlatformInstitution {
  phone: string;
  address: string;
  timezone: string;
  default_currency: string;
  suspension_reason: string;
  modules: Array<{ code: string; name: string; enabled: boolean }>;
  administrators: Array<{ name: string; email: string; status: MembershipStatus; last_login: string | null; mfa_enabled: boolean }>;
  members_by_status: Record<MembershipStatus, number>;
  origin_invitation: { id: string; email: string; created_at: string; accepted_at: string | null; invited_by_email: string | null } | null;
  recent_events: PlatformAuditEvent[];
}

export interface PlatformOverview {
  /** Whether approving an access request emails the invitation link. */
  email_delivery_enabled: boolean;
  institutions: { total: number; active: number; suspended: number; new_last_30_days: number };
  users: { total: number; signed_in_last_30_days: number };
  employees: { total: number };
  onboarding: Record<OnboardingStatus, number>;
  pipeline: { pending_requests: number; pending_invitations: number; invitations_expiring_48h: number };
  growth: { months: string[]; institutions: number[]; access_requests: number[] };
  recent_institutions: PlatformInstitution[];
}

export function getOverview(): Promise<PlatformOverview> {
  return apiGet<PlatformOverview>("/platform/overview/");
}

export function listInstitutions(params: { page?: number; q?: string; status?: "active" | "suspended" | "" } = {}): Promise<PaginatedData<PlatformInstitution>> {
  return apiGetList<PlatformInstitution>("/platform/institutions/", { page: params.page, q: params.q || undefined, status: params.status || undefined });
}

export function getInstitution(id: string): Promise<PlatformInstitutionDetail> {
  return apiGet<PlatformInstitutionDetail>(`/platform/institutions/${id}/`);
}

export function suspendInstitution(id: string, reason: string): Promise<PlatformInstitutionDetail> {
  return apiPost<PlatformInstitutionDetail, { reason: string }>(`/platform/institutions/${id}/suspend/`, { reason });
}

export function reactivateInstitution(id: string): Promise<PlatformInstitutionDetail> {
  return apiPost<PlatformInstitutionDetail>(`/platform/institutions/${id}/reactivate/`, {});
}

export function listAuditEvents(params: { page?: number; q?: string; action?: string; institution?: string } = {}): Promise<PaginatedData<PlatformAuditEvent>> {
  return apiGetList<PlatformAuditEvent>("/platform/audit/", {
    page: params.page,
    q: params.q || undefined,
    action: params.action || undefined,
    institution: params.institution || undefined,
  });
}

const ACTION_LABELS: Record<string, string> = {
  "platform.institution.created": "Organization created",
  "platform.institution.suspended": "Organization suspended",
  "platform.institution.reactivated": "Organization reactivated",
  "platform.invitation.created": "Invitation created",
  "platform.invitation.revoked": "Invitation revoked",
  "platform.invitation.reissued": "Invitation re-issued",
  "platform.access_request.approved": "Access request approved",
  "platform.access_request.declined": "Access request declined",
};

export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/^platform\./, "").replace(/[._]/g, " ");
}
