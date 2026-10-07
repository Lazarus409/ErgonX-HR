/**
 * Shared ErgonX API envelope types.
 *
 * Mirrors the backend contract in
 * `docs/integration/frontend_platform_contract.md`:
 *
 * {
 *   "success": true,
 *   "data": {},
 *   "message": "",
 *   "errors": null
 * }
 */

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  errors: unknown;
}

export interface PaginatedData<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type ApiListResponse<T> = ApiResponse<PaginatedData<T>>;

/**
 * Field-level errors keyed by serializer field name, as produced by the
 * shared DRF exception handler.
 */
export type FieldErrors = Record<string, unknown>;

export interface ApiError {
  success: false;
  data: null;
  message: string;
  code?: string;
  errors: FieldErrors | null;
}

/**
 * Stable top-level error codes emitted by `common/exceptions.py`.
 * Screens should branch on these rather than on HTTP status alone.
 */
export type ApiErrorCode =
  | "authentication_required"
  | "authentication_failed"
  | "permission_denied"
  | "module_disabled"
  | "tenant_mismatch"
  | "invalid_state_transition"
  | "record_immutable"
  | "period_closed"
  | "duplicate_operation"
  | "insufficient_leave_balance"
  | "policy_not_applicable"
  | "unbalanced_journal"
  | "validation_error"
  | "invalid_request"
  | "not_found"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "throttled"
  | "api_error"
  | "network_error";

/** Primitive values accepted as query-string parameters. */
export type QueryValue = string | number | boolean | null | undefined;

/**
 * Standard page-number list parameters.
 * Backend default page size is 25 and the maximum is 100.
 */
export interface ListParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  [key: string]: QueryValue;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function emptyPage<T>(): PaginatedData<T> {
  return { count: 0, next: null, previous: null, results: [] };
}
