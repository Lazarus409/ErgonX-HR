/**
 * Central ErgonX API client.
 *
 * This is the single Axios instance for the whole frontend. It owns:
 *   - base URL resolution;
 *   - same-origin BFF session routing;
 *   - the X-Institution-ID tenant header;
 *   - unwrapping the shared response envelope;
 *   - normalising backend errors into `ApiRequestError`;
 *   - one-shot access-token refresh on 401.
 *
 * Pages and service modules must not create their own Axios instances.
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from "axios";

import type {
  ApiErrorCode,
  ApiResponse,
  FieldErrors,
  ListParams,
  PaginatedData,
} from "@/types/api";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the API root, always ending at `/api/v1`.
 *
 * The browser always uses the same-origin Next.js BFF. That proxy attaches
 * the HttpOnly access cookie server-side, so bearer tokens never enter JS.
 */
export function resolveApiBaseUrl(): string {
  return "/api/v1";
}

export const API_BASE_URL = resolveApiBaseUrl();

const REQUEST_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Token and tenant storage                                                   */
/* -------------------------------------------------------------------------- */

/** Non-HttpOnly hint cookie the BFF sets alongside the session; it expires with it. */
export const SESSION_HINT_COOKIE = "ergonx_session";
/** Present only for "Keep me signed in" sessions. */
export const REMEMBER_COOKIE = "ergonx_remember";
export const INSTITUTION_ID_KEY = "ergonx_institution_id";

/**
 * Access and refresh tokens are HttpOnly cookies owned by the same-origin BFF.
 * The browser stores only a non-sensitive session hint and institution UUID.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readStorage(key: string): string | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (!isBrowser()) {
    return;
  }

  try {
    if (value === null) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, value);
  } catch {
    /* Storage can be unavailable in private modes; requests still work. */
  }
}

export function getAccessToken(): string | null {
  return null;
}

export function getRefreshToken(): string | null {
  return null;
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function expireCookie(name: string): void {
  if (isBrowser()) document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
}

/**
 * Whether a server session probably exists. It reads the BFF's hint cookie, which
 * shares the session's lifetime: a browser-session sign-in ends when the browser closes.
 */
export function hasSessionHint(): boolean {
  return readCookie(SESSION_HINT_COOKIE) === "1";
}

/** True when the user chose "Keep me signed in" for this session. */
export function isRememberedSession(): boolean {
  return readCookie(REMEMBER_COOKIE) === "1";
}

export function setAuthTokens(...tokens: Array<string | null | undefined>): void {
  // Session credentials are owned by the HttpOnly BFF cookies, which also set the hint.
  void tokens;
}

export function clearAuthTokens(): void {
  expireCookie(SESSION_HINT_COOKIE);
  expireCookie(REMEMBER_COOKIE);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Backend primary keys are UUIDs. Development placeholder identifiers such as
 * `dev-user` are not, and sending them as filter values or tenant selectors
 * produces a validation or `tenant_mismatch` error.
 */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** The institution selector must be one of the user's own membership UUIDs. */
export function isInstitutionSelector(value: string | null): value is string {
  return isUuid(value);
}

export function getInstitutionId(): string | null {
  return readStorage(INSTITUTION_ID_KEY);
}

export function setInstitutionId(institutionId: string | null): void {
  writeStorage(INSTITUTION_ID_KEY, institutionId);
}

export function clearTenantContext(): void {
  clearAuthTokens();
  setInstitutionId(null);
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

export class ApiRequestError extends Error {
  readonly status: number | null;
  readonly code: ApiErrorCode | string;
  readonly fieldErrors: FieldErrors | null;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code?: ApiErrorCode | string;
      fieldErrors?: FieldErrors | null;
    } = {},
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status ?? null;
    this.code = options.code ?? "api_error";
    this.fieldErrors = options.fieldErrors ?? null;
  }

  get isPermissionDenied(): boolean {
    return this.code === "permission_denied" || this.status === 403;
  }

  get isModuleDisabled(): boolean {
    return this.code === "module_disabled";
  }

  get isTenantMismatch(): boolean {
    return this.code === "tenant_mismatch";
  }

  get isNotFound(): boolean {
    return this.code === "not_found" || this.status === 404;
  }

  get isValidationError(): boolean {
    return this.code === "validation_error" || this.status === 400;
  }

  get isUnauthenticated(): boolean {
    return (
      this.code === "authentication_required" ||
      this.code === "authentication_failed" ||
      this.status === 401
    );
  }

  /** First message for a given serializer field, if the backend supplied one. */
  fieldError(field: string): string | null {
    const value = this.fieldErrors?.[field];

    if (Array.isArray(value)) {
      return value.length > 0 ? String(value[0]) : null;
    }

    if (typeof value === "string") {
      return value;
    }

    return null;
  }
}

export function isApiRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError;
}

const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  400: "The submitted data could not be accepted.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to perform this action.",
  404: "The requested record could not be found.",
  405: "That operation is not supported for this record.",
  409: "This action conflicts with the current record state.",
  429: "Too many requests. Please try again shortly.",
};

function normalizeError(error: unknown): ApiRequestError {
  if (isApiRequestError(error)) {
    return error;
  }

  if (!axios.isAxiosError(error)) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong. Please try again.";

    return new ApiRequestError(message);
  }

  const axiosError = error as AxiosError<Partial<ApiResponse<unknown>> & {
    code?: string;
    detail?: string;
    message?: string;
    errors?: FieldErrors | null;
  }>;

  const status = axiosError.response?.status ?? null;

  if (status === null) {
    return new ApiRequestError(
      "The server could not be reached. Check your connection and try again.",
      { code: "network_error" },
    );
  }

  const payload = axiosError.response?.data;

  const message =
    (typeof payload?.message === "string" && payload.message) ||
    (typeof payload?.detail === "string" && payload.detail) ||
    STATUS_FALLBACK_MESSAGES[status] ||
    (status >= 500
      ? "The server encountered an error. Please try again."
      : "The request could not be completed.");

  return new ApiRequestError(message, {
    status,
    code: payload?.code ?? "api_error",
    fieldErrors: (payload?.errors as FieldErrors | null) ?? null,
  });
}

/** User-facing message for any thrown value. */
export function getApiErrorMessage(error: unknown): string {
  return normalizeError(error).message;
}

/* -------------------------------------------------------------------------- */
/* Axios instance                                                             */
/* -------------------------------------------------------------------------- */

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const institutionId = getInstitutionId();

  if (isInstitutionSelector(institutionId)) {
    config.headers.set("X-Institution-ID", institutionId);
  }

  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/** In-flight refresh, shared so concurrent 401s trigger a single call. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!hasSessionHint()) {
    return false;
  }

  try {
    // Deliberately a bare axios call: the instance interceptors must not
    // recurse into refresh handling.
    await axios.post(
      `${API_BASE_URL}/auth/refresh/`,
      {},
      { headers: { "Content-Type": "application/json" }, timeout: REQUEST_TIMEOUT_MS, withCredentials: true },
    );
    setAuthTokens();
    return true;
  } catch {
    clearAuthTokens();
    return false;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;

    const shouldAttemptRefresh =
      error.response?.status === 401 &&
      config !== undefined &&
      config._retried !== true &&
      hasSessionHint();

    if (!shouldAttemptRefresh || !config) {
      return Promise.reject(error);
    }

    config._retried = true;

    refreshInFlight = refreshInFlight ?? refreshAccessToken();

    let refreshed = false;

    try {
      refreshed = await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }

    if (!refreshed) {
      // Tokens are cleared, but no hard navigation happens here. Routing is
      // the auth provider's concern, which keeps the development auth bypass
      // working when no real session exists.
      return Promise.reject(error);
    }

    return apiClient(config);
  },
);

/* -------------------------------------------------------------------------- */
/* Request helpers                                                            */
/* -------------------------------------------------------------------------- */

function unwrap<T>(payload: ApiResponse<T> | T): T {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
  ) {
    return (payload as ApiResponse<T>).data;
  }

  return payload as T;
}

/**
 * Accepts either a paginated page object or a bare array, since a few
 * backend endpoints return unpaginated lists.
 */
export function normalizePage<T>(value: PaginatedData<T> | T[] | null): PaginatedData<T> {
  if (Array.isArray(value)) {
    return { count: value.length, next: null, previous: null, results: value };
  }

  if (value && Array.isArray(value.results)) {
    return value;
  }

  return { count: 0, next: null, previous: null, results: [] };
}

/** Drops null/undefined/empty params so filters are omitted rather than sent blank. */
export function buildParams(params?: ListParams): Record<string, string | number | boolean> {
  const cleaned: Record<string, string | number | boolean> = {};

  if (!params) {
    return cleaned;
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
}

export async function apiGet<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const response = await apiClient.get<ApiResponse<T>>(url, config);
    return unwrap<T>(response.data);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function apiGetList<T>(
  url: string,
  params?: ListParams,
  config?: AxiosRequestConfig,
): Promise<PaginatedData<T>> {
  const payload = await apiGet<PaginatedData<T> | T[]>(url, {
    ...config,
    params: { ...buildParams(params), ...(config?.params ?? {}) },
  });

  return normalizePage<T>(payload);
}

export async function apiPost<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const response = await apiClient.post<ApiResponse<T>>(url, body, config);
    return unwrap<T>(response.data);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function apiPostMultipart<T>(
  url: string,
  body: FormData,
  onUploadProgress?: (progress: number) => void,
): Promise<T> {
  try {
    const response = await apiClient.post<ApiResponse<T>>(url, body, {
      // The instance default is JSON, which makes axios serialize FormData to a
      // JSON object and drop the file. This header keeps it multipart; the
      // browser then adds the boundary itself.
      headers: { "Content-Type": "multipart/form-data" },
      timeout: UPLOAD_TIMEOUT_MS,
      onUploadProgress: (event) => {
        if (event.total) onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
      },
    });
    return unwrap<T>(response.data);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function apiPut<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const response = await apiClient.put<ApiResponse<T>>(url, body, config);
    return unwrap<T>(response.data);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function apiPatch<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<T> {
  try {
    const response = await apiClient.patch<ApiResponse<T>>(url, body, config);
    return unwrap<T>(response.data);
  } catch (error) {
    throw normalizeError(error);
  }
}

export async function apiDelete(
  url: string,
  config?: AxiosRequestConfig,
): Promise<void> {
  try {
    await apiClient.delete(url, config);
  } catch (error) {
    throw normalizeError(error);
  }
}

/**
 * Workflow transitions. Backend action endpoints are authoritative; status
 * fields must never be PATCHed directly.
 */
export async function apiAction<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<T> {
  return apiPost<T, B>(url, body, config);
}

export interface AllPagesResult<T> {
  items: T[];
  /** True when `maxPages` was reached before the last page. */
  truncated: boolean;
}

/**
 * Reads up to `maxPages` pages of a list endpoint.
 *
 * Used to build client-side lookup indexes for endpoints that expose no
 * server-side filter for what a screen needs. The cap keeps a screen from
 * issuing an unbounded number of requests against a large tenant.
 */
export async function fetchAllPages<T>(
  load: (page: number) => Promise<PaginatedData<T>>,
  maxPages = 5,
): Promise<AllPagesResult<T>> {
  const items: T[] = [];

  let page = 1;

  for (;;) {
    const result = await load(page);

    items.push(...result.results);

    if (!result.next) {
      return { items, truncated: false };
    }

    if (page >= maxPages) {
      return { items, truncated: true };
    }

    page += 1;
  }
}

/** CSV report exports are returned outside the envelope, as a file body. */
export async function apiDownload(
  url: string,
  params?: ListParams,
): Promise<Blob> {
  try {
    const response = await apiClient.get(url, {
      params: buildParams(params),
      responseType: "blob",
    });

    return response.data as Blob;
  } catch (error) {
    throw normalizeError(error);
  }
}

export default apiClient;
