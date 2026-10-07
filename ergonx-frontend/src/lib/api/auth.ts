/**
 * Authentication service.
 *
 * Endpoints: `POST /auth/login/`, `POST /auth/refresh/`, `GET /auth/me/`.
 * The backend user model authenticates by email.
 */

import {
  apiGet,
  apiDelete,
  apiPatch,
  apiPost,
  apiPut,
  clearTenantContext,
  setAuthTokens,
  setInstitutionId,
} from "./client";

export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_platform_admin: boolean;
  /** Active user avatar image, scoped to the selected institution. */
  profile_image_id?: string | null;
  created_at: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  mfa_code?: string;
  /** "Keep me signed in": the BFF keeps the session for 7 days instead of until the browser closes. */
  remember?: boolean;
}

export interface LoginResult {
  user: AuthUser;
}

export type MFAMethod = "AUTHENTICATOR_APP" | "EMAIL_OTP";
export interface MFAStatus { enabled: boolean; pending: boolean; method?: MFAMethod | null; secret?: string; otpauth_uri?: string; email_code_sent?: boolean; email?: string; expires_at?: string; }

export interface AuthBootstrap {
  user: AuthUser;
  active_institution: {
    id: string;
    code: string;
    name: string;
    timezone: string;
    /** Active institution logo image, served by `imageContentUrl`. */
    logo_image_id?: string | null;
  };
  active_membership: {
    id: string;
    role_code: string;
    role_name: string;
    status: string;
    /** INSTITUTION, DEPARTMENT or SELF; absent from older backends. */
    data_scope?: "INSTITUTION" | "DEPARTMENT" | "SELF";
    /** Read-only roles (e.g. Auditor) may view but never change institution data. */
    read_only?: boolean;
  };
  effective_permissions: string[];
  enabled_modules: string[];
  onboarding_ready: boolean;
  onboarding_status: string;
  default_landing: string;
  available_dashboards: string[];
}

/** Signs in; the same-origin BFF persists the token pair as HttpOnly cookies. */
export async function login(
  credentials: LoginCredentials,
): Promise<LoginResult> {
  const result = await apiPost<LoginResult, LoginCredentials>(
    "/auth/login/",
    credentials,
  );

  setAuthTokens();

  return result;
}

export async function getCurrentUser(): Promise<AuthUser> {
  return apiGet<AuthUser>("/auth/me/");
}

export function getMFAStatus(): Promise<MFAStatus> { return apiGet<MFAStatus>("/auth/security/mfa/"); }
export function beginMFASetup(): Promise<MFAStatus> { return apiPost<MFAStatus, Record<string, never>>("/auth/security/mfa/", {}); }
export function confirmMFASetup(code: string): Promise<MFAStatus> { return apiPut<MFAStatus, { code: string }>("/auth/security/mfa/", { code }); }
/** Turning MFA off needs the current password (step-up), not just a session. */
export async function disableMFA(currentPassword: string): Promise<MFAStatus> { await apiDelete("/auth/security/mfa/", { data: { current_password: currentPassword } }); return { enabled: false, pending: false }; }
/** Without `code`, emails a verification code; with `code`, confirms it and switches to email OTP. */
export function setMFAMethod(method: MFAMethod, code?: string): Promise<MFAStatus> { return apiPatch<MFAStatus, { method: MFAMethod; code?: string }>("/auth/security/mfa/", code ? { method, code } : { method }); }

export interface AccountProfilePayload {
  email?: string;
  first_name?: string;
  last_name?: string;
}

export function getAccountProfile(): Promise<AccountProfilePayload> {
  return apiGet<AccountProfilePayload>("/auth/profile/");
}

export function updateAccountProfile(payload: AccountProfilePayload): Promise<AccountProfilePayload> {
  return apiPatch<AccountProfilePayload, AccountProfilePayload>("/auth/profile/", payload);
}

export function changePassword(payload: { current_password: string; new_password: string }): Promise<{ changed: boolean }> {
  return apiPost<{ changed: boolean }, { current_password: string; new_password: string }>("/auth/profile/password/", payload);
}

export function requestPasswordReset(email: string): Promise<{ requested: boolean }> {
  return apiPost<{ requested: boolean }, { email: string }>("/auth/password-reset/", { email });
}

export function confirmPasswordReset(payload: { uid: string; token: string; new_password: string }): Promise<{ reset: boolean }> {
  return apiPost<{ reset: boolean }, typeof payload>("/auth/password-reset/confirm/", payload);
}

/** Canonical post-login tenant, permission, module, and landing context. */
export async function getBootstrap(): Promise<AuthBootstrap> {
  return apiGet<AuthBootstrap>("/auth/bootstrap/");
}

export interface InvitationAccessPreview {
  role_code: string;
  role_name: string;
  modules: Array<{ code: string; name: string }>;
}

export interface InvitationDetails {
  email: string;
  institution_name: string;
  role_name: string;
  expires_at: string;
  existing_account: boolean;
  access_preview: InvitationAccessPreview;
}
export function getInvitation(token: string): Promise<InvitationDetails> { return apiGet<InvitationDetails>(`/auth/invitations/${token}/`); }
export function acceptInvitation(token: string, payload: { password: string; first_name?: string; last_name?: string }): Promise<{ accepted: boolean; existing_account: boolean; access_preview: InvitationAccessPreview }> { return apiPost<{ accepted: boolean; existing_account: boolean; access_preview: InvitationAccessPreview }, typeof payload>(`/auth/invitations/${token}/`, payload); }

export interface InstitutionAdminInvitationDetails {
  email: string;
  expires_at: string;
  /** Values from the access request this invitation came from, when there is one. */
  prefill?: Partial<Record<"institution_name" | "first_name" | "last_name" | "phone" | "country_code" | "employee_size" | "institution_type" | "website", string>>;
  institution_types?: Array<{ value: string; label: string }>;
}
export interface InstitutionAdminInvitationPayload {
  first_name: string;
  last_name: string;
  password: string;
  institution_name: string;
  institution_type: string;
  country_code: string;
  employee_size?: string;
  website?: string;
  phone?: string;
  /** Must be true: the Terms of Service and Privacy Policy are accepted. */
  accepted_terms: boolean;
  default_currency?: string;
  timezone?: string;
}

export function getInstitutionAdminInvitation(token: string): Promise<InstitutionAdminInvitationDetails> {
  return apiGet<InstitutionAdminInvitationDetails>(`/auth/institution-admin-invitations/${token}/`);
}

export interface InstitutionAdminInvitationAcceptance extends LoginResult {
  institution: { id: string; name: string; code: string };
}

/** Creates the organization; the BFF signs the new admin in, replacing any earlier session. */
export async function acceptInstitutionAdminInvitation(token: string, payload: InstitutionAdminInvitationPayload): Promise<InstitutionAdminInvitationAcceptance> {
  const result = await apiPost<InstitutionAdminInvitationAcceptance, InstitutionAdminInvitationPayload>(`/auth/institution-admin-invitations/${token}/`, payload);
  setAuthTokens();
  // A selector left over from an earlier session would point at an
  // institution this new admin does not belong to.
  setInstitutionId(result.institution?.id ?? null);
  return result;
}

export interface PlatformInstitutionAdminInvitation {
  id: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  expires_at: string;
  accepted_at: string | null;
  invited_by_email: string | null;
  /** The organization created by accepting this invitation. */
  institution_id: string | null;
  institution_name: string | null;
  created_at: string;
}

export interface CreatePlatformInstitutionAdminInvitation {
  email: string;
  expires_in_hours?: number;
}

export interface CreatedPlatformInstitutionAdminInvitation extends PlatformInstitutionAdminInvitation {
  acceptance_token: string;
  email_delivery_status: "SENT" | "FAILED" | "MANUAL_DELIVERY_REQUIRED";
}

export function listInstitutionAdminInvitations(): Promise<PlatformInstitutionAdminInvitation[]> {
  return apiGet<PlatformInstitutionAdminInvitation[]>("/auth/institution-admin-invitations/");
}

export function createInstitutionAdminInvitation(payload: CreatePlatformInstitutionAdminInvitation): Promise<CreatedPlatformInstitutionAdminInvitation> {
  return apiPost<CreatedPlatformInstitutionAdminInvitation, CreatePlatformInstitutionAdminInvitation>("/auth/institution-admin-invitations/", payload);
}

export function revokeInstitutionAdminInvitation(id: string): Promise<{ invitation: PlatformInstitutionAdminInvitation }> {
  return apiPost(`/auth/institution-admin-invitations/${id}/revoke/`, {});
}

/** Issues a fresh link to the same email; a still-pending original is revoked. */
export function reissueInstitutionAdminInvitation(id: string, expiresInHours: number): Promise<{ invitation: Pick<CreatedPlatformInstitutionAdminInvitation, "id" | "email" | "expires_at" | "acceptance_token" | "email_delivery_status"> }> {
  return apiPost(`/auth/institution-admin-invitations/${id}/reissue/`, { expires_in_hours: expiresInHours });
}

export type OrganizationSize = "1-50" | "51-200" | "201-1000" | "1000+";

/** Public Get Started request asking the Super Admin for an organization invitation. */
export interface InstitutionAccessRequestPayload {
  institution_name: string;
  contact_name: string;
  job_title?: string;
  email: string;
  phone?: string;
  country_code: string;
  organization_size?: OrganizationSize | "";
  institution_type?: string;
  /** The organization's real website (``website`` below is the bot honeypot). */
  website_url?: string;
  /** Required by the Get Started form; the API records when it was accepted. */
  accepted_terms?: boolean;
  message?: string;
  /** Honeypot: must stay empty. */
  website?: string;
}

export interface InstitutionAccessRequest {
  id: string;
  institution_name: string;
  contact_name: string;
  job_title: string;
  email: string;
  phone: string;
  country_code: string;
  organization_size: OrganizationSize | "";
  message: string;
  status: "PENDING" | "INVITED" | "DECLINED";
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  decline_reason: string;
  invitation: string | null;
  has_account: boolean;
  created_at: string;
}

export function submitInstitutionAccessRequest(payload: InstitutionAccessRequestPayload): Promise<{ received: boolean }> {
  return apiPost<{ received: boolean }, InstitutionAccessRequestPayload>("/auth/institution-access-requests/", payload);
}

export function listInstitutionAccessRequests(): Promise<InstitutionAccessRequest[]> {
  return apiGet<InstitutionAccessRequest[]>("/auth/institution-access-requests/");
}

export function approveInstitutionAccessRequest(id: string, expiresInHours: number): Promise<{ request: InstitutionAccessRequest; invitation: CreatedPlatformInstitutionAdminInvitation }> {
  return apiPost(`/auth/institution-access-requests/${id}/approve/`, { expires_in_hours: expiresInHours });
}

export function declineInstitutionAccessRequest(id: string, reason: string): Promise<{ request: InstitutionAccessRequest }> {
  return apiPost(`/auth/institution-access-requests/${id}/decline/`, { reason });
}

/** Clears tokens and the selected institution. Purely client-side. */
export function logout(): void {
  void apiPost<{ logged_out: boolean }>("/auth/logout/").catch(() => {
    // Local state is cleared even if the browser is already offline.
  });
  clearTenantContext();
}

export function displayName(user: AuthUser | null | undefined): string {
  if (!user) {
    return "";
  }

  const name = `${user.first_name} ${user.last_name}`.trim();

  return name || user.email;
}

/** A signed-in browser or device (Security Center). */
export interface UserSessionRow { id: string; ip_address: string | null; user_agent: string; created_at: string; last_seen_at: string; current: boolean; }
export function listSessions(): Promise<{ sessions: UserSessionRow[] }> { return apiGet<{ sessions: UserSessionRow[] }>("/auth/sessions/"); }
export function revokeSession(id: string): Promise<{ revoked: number; current: boolean }> { return apiPost<{ revoked: number; current: boolean }, Record<string, never>>(`/auth/sessions/${id}/revoke/`, {}); }
export function revokeOtherSessions(): Promise<{ revoked: number }> { return apiPost<{ revoked: number }, Record<string, never>>("/auth/sessions/revoke-others/", {}); }

/** One of the signed-in user's own sign-ins or security changes. */
export interface SignInActivityEvent { id: string; action: string; created_at: string; ip_address: string | null; user_agent: string; detail: string; }
export function listSignInActivity(): Promise<{ events: SignInActivityEvent[] }> { return apiGet<{ events: SignInActivityEvent[] }>("/auth/security/activity/"); }
