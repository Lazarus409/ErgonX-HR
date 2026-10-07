/**
 * Session-shaped types used by the app shell and guards.
 *
 * These are the browser's view of the signed-in user. The raw API shapes live
 * in `@/types/institutions` and `@/lib/api/auth`.
 */

export type UserRole =
  | "INSTITUTION_ADMIN"
  | "HR_ADMIN"
  | "DIRECTOR"
  | "EMPLOYEE"
  | "ACCOUNTANT"
  | "FINANCE_MANAGER"
  | "AUDITOR";

export interface SessionInstitution {
  id: string;
  name: string;
  code: string;
  /** Uploaded institution logo (image asset id), when one exists. */
  logoImageId?: string | null;
  /** IANA time zone of the institution. */
  timezone?: string;
  /**
   * Enabled backend module codes (`CORE_HR`, `LEAVE`, ...). The development
   * bypass uses the short label `HR`; compare with `hasModule` from
   * `@/types/institutions` rather than a direct `includes`.
   */
  enabledModules: string[];
}

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole | string;
  institutionId: string;
  /** Permission codes, or `["*"]` for the development bypass user. */
  permissions: string[];
  /** Whose records this membership works with (see `common/scoping.py`). */
  dataScope?: "INSTITUTION" | "DEPARTMENT" | "SELF";
  /** Read-only role: the UI shows no create, edit or approve controls. */
  readOnly?: boolean;
  isPlatformAdmin?: boolean;
  /** Uploaded profile image for the active institution. */
  profileImageId?: string | null;
  institution?: SessionInstitution;
}

export interface AuthState {
  user: SessionUser | null;
  institution: SessionInstitution | null;
  isAuthenticated: boolean;
  loading: boolean;
}

export interface SessionBootstrap {
  onboardingReady: boolean;
  onboardingStatus: string;
  defaultLanding: string;
  availableDashboards: string[];
  roleCode?: string;
}

/** Retained for existing imports. */
export type Institution = SessionInstitution;
export type User = SessionUser;
