/**
 * Institution / tenant context service.
 *
 * Endpoints: `GET /institutions/current/`, `GET /institutions/memberships/`.
 *
 * The backend resolves the tenant from the user's own active memberships. A
 * client-supplied `X-Institution-ID` only ever selects among those; it never
 * grants access.
 */

import { apiGet, apiGetList, apiPatch, apiPost, apiPut, setInstitutionId } from "./client";
import type {
  CurrentInstitutionContext,
  InstitutionMembership,
  InstitutionInvitation,
  InstitutionModule,
  InstitutionOnboarding,
  InstitutionRole,
  InstitutionSetting,
  RoleDataScope,
  PermissionDefinition,
  UserPreference,
} from "@/types/institutions";
import type { PaginatedData } from "@/types/api";

export async function getCurrentInstitution(): Promise<CurrentInstitutionContext> {
  return apiGet<CurrentInstitutionContext>("/institutions/current/");
}

export interface LocaleCatalogues {
  countries: Array<{ code: string; name: string; default_currency?: string }>;
  currencies: Array<{ code: string; name: string; symbol: string }>;
  timezones: Array<{ id: string; name: string }>;
}

/** ISO/IANA reference values owned by the backend, not handwritten UI lists. */
export function getLocaleCatalogues(): Promise<LocaleCatalogues> {
  return apiGet<LocaleCatalogues>("/institutions/locale-catalogues/");
}

export interface InstitutionProfilePayload {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  country_code?: string;
  default_currency?: string;
  timezone?: string;
  institution_type?: string;
  logo?: string | null;
}

/** Updates the tenant profile that is evaluated by institution onboarding. */
export function updateCurrentInstitution(
  payload: InstitutionProfilePayload,
): Promise<CurrentInstitutionContext> {
  return apiPatch<CurrentInstitutionContext, InstitutionProfilePayload>(
    "/institutions/current/",
    payload,
  );
}

/** Unpaginated list of every membership held by the signed-in user. */
export async function getMyMemberships(): Promise<InstitutionMembership[]> {
  const memberships = await apiGet<InstitutionMembership[]>(
    "/institutions/memberships/",
  );

  return Array.isArray(memberships) ? memberships : [];
}

export function activeMemberships(
  memberships: readonly InstitutionMembership[],
): InstitutionMembership[] {
  return memberships.filter((membership) => membership.status === "ACTIVE");
}

/**
 * Mirrors the backend's selection rule: a primary active membership wins,
 * otherwise a single active membership is implicit. When several remain, the
 * user must choose and `X-Institution-ID` becomes mandatory.
 */
export function resolveDefaultMembership(
  memberships: readonly InstitutionMembership[],
): InstitutionMembership | null {
  const active = activeMemberships(memberships);

  const primary = active.find((membership) => membership.is_primary);

  if (primary) {
    return primary;
  }

  return active.length === 1 ? active[0] : null;
}

export function requiresInstitutionSelection(
  memberships: readonly InstitutionMembership[],
): boolean {
  return resolveDefaultMembership(memberships) === null;
}

/** Persists the tenant selector sent on every subsequent request. */
export function selectInstitution(institutionId: string | null): void {
  setInstitutionId(institutionId);
}

export function listMyPreferences(): Promise<UserPreference[]> {
  return apiGet<UserPreference[]>("/institutions/preferences/");
}

export function savePreference(preference_key: string, value_json: Record<string, unknown>): Promise<UserPreference> {
  return apiPut<UserPreference, { preference_key: string; value_json: Record<string, unknown> }>("/institutions/preferences/", { preference_key, value_json });
}

export function listInstitutionSettings(): Promise<InstitutionSetting[]> {
  return apiGet<InstitutionSetting[]>("/institutions/settings/");
}

export function saveInstitutionSetting(
  key: string,
  value: unknown,
): Promise<InstitutionSetting> {
  return apiPut<InstitutionSetting, { key: string; value: unknown }>(
    "/institutions/settings/",
    { key, value },
  );
}

export function listInstitutionModules(): Promise<PaginatedData<InstitutionModule>> {
  return apiGetList<InstitutionModule>("/institutions/modules/", { ordering: "module_code" });
}

export function updateInstitutionModule(id: string, is_enabled: boolean): Promise<InstitutionModule> {
  return apiPatch<InstitutionModule, { is_enabled: boolean }>(`/institutions/modules/${id}/`, { is_enabled });
}

export function getInstitutionOnboarding(): Promise<InstitutionOnboarding> {
  return apiGet<InstitutionOnboarding>("/institutions/onboarding/");
}

export function validateInstitutionOnboarding(): Promise<InstitutionOnboarding> {
  return apiPost<InstitutionOnboarding>("/institutions/onboarding/");
}

export function skipInstitutionOnboardingStep(stepCode: string): Promise<InstitutionOnboarding> {
  return apiPost<InstitutionOnboarding>(`/institutions/onboarding/${stepCode}/skip/`);
}

export function resumeInstitutionOnboardingStep(stepCode: string): Promise<InstitutionOnboarding> {
  return apiPost<InstitutionOnboarding>(`/institutions/onboarding/${stepCode}/resume/`);
}

/** Institution-scoped role catalogue, restricted to roles administrators. */
export function listInstitutionRoles(): Promise<PaginatedData<InstitutionRole>> {
  return apiGetList<InstitutionRole>("/institutions/roles/", { ordering: "name" });
}

/** Global permission catalogue available for institution custom roles. */
export function listPermissionCatalog(): Promise<PermissionDefinition[]> {
  return apiGet<PermissionDefinition[]>("/institutions/permissions/");
}

/** Memberships in the selected institution, restricted to access administrators. */
export function listInstitutionMemberships(): Promise<PaginatedData<InstitutionMembership>> {
  return apiGetList<InstitutionMembership>("/institutions/members/", {
    ordering: "-joined_at",
  });
}

export interface CustomRolePayload {
  code: string;
  name: string;
  description?: string;
  permission_codes: string[];
  data_scope?: RoleDataScope;
  is_read_only?: boolean;
}

export interface CustomRoleUpdatePayload {
  name?: string;
  description?: string;
  permission_codes?: string[];
  is_active?: boolean;
  data_scope?: RoleDataScope;
  is_read_only?: boolean;
}

export function createInstitutionRole(payload: CustomRolePayload): Promise<InstitutionRole> {
  return apiPost<InstitutionRole, CustomRolePayload>("/institutions/roles/", payload);
}

export function updateInstitutionRole(id: string, payload: CustomRoleUpdatePayload): Promise<InstitutionRole> {
  return apiPatch<InstitutionRole, CustomRoleUpdatePayload>(`/institutions/roles/${id}/`, payload);
}

export interface MembershipUpdatePayload {
  role_id?: string;
  status?: string;
  is_primary?: boolean;
}

export interface MembershipInvitePayload {
  email: string;
  role_id: string;
  is_primary?: boolean;
}

export function inviteInstitutionMember(payload: MembershipInvitePayload): Promise<InstitutionMembership> {
  return apiPost<InstitutionMembership, MembershipInvitePayload>("/institutions/members/", payload);
}

export function createInvitationLink(payload: { email: string; role_id: string; expires_in_hours?: number }): Promise<{ id: string; email: string; expires_at: string; acceptance_token: string }> {
  return apiPost("/institutions/members/invite-link/", payload);
}

export interface InstitutionInvitationPayload {
  email: string;
  role_id: string;
  expires_in_hours?: number;
}

export interface InvitationActionResult {
  invitation: InstitutionInvitation;
  acceptance_token: string;
}

/** Invitation records never expose their token; a token is only returned when newly created or reissued. */
export function listInstitutionInvitations(): Promise<PaginatedData<InstitutionInvitation>> {
  return apiGetList<InstitutionInvitation>("/institutions/invitations/", { ordering: "-created_at" });
}

export function createInstitutionInvitation(payload: InstitutionInvitationPayload): Promise<InvitationActionResult> {
  return apiPost<InvitationActionResult, InstitutionInvitationPayload>("/institutions/invitations/", payload);
}

export function revokeInstitutionInvitation(id: string): Promise<InstitutionInvitation> {
  return apiPost<InstitutionInvitation>(`/institutions/invitations/${id}/revoke/`);
}

export function resendInstitutionInvitation(id: string): Promise<InvitationActionResult> {
  return apiPost<InvitationActionResult>(`/institutions/invitations/${id}/resend/`);
}

export function updateInstitutionMembership(id: string, payload: MembershipUpdatePayload): Promise<InstitutionMembership> {
  return apiPatch<InstitutionMembership, MembershipUpdatePayload>(`/institutions/members/${id}/`, payload);
}

/** Permission codes granted by the membership's role. */
export function permissionsFor(
  membership: InstitutionMembership | null | undefined,
): string[] {
  return membership?.role?.permissions ?? [];
}

/** Ask the institution's user managers for access to a restricted page (in-app notification + audit). */
export function requestAccess(payload: { area: string; permission?: string; path?: string; note?: string }): Promise<{ sent_to: number; already_requested: boolean }> {
  return apiPost<{ sent_to: number; already_requested: boolean }, typeof payload>("/access-requests/", payload);
}
