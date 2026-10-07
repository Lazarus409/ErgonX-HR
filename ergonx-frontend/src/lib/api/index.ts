/**
 * ErgonX API layer entry point.
 *
 * Import the shared client helpers directly, or a namespaced service:
 *
 *   import { apiGet, ApiRequestError } from "@/lib/api";
 *   import { employeesApi } from "@/lib/api";
 *
 * Service modules are added here as each screen is migrated onto the real
 * backend. Modules for domains that are not yet connected are intentionally
 * absent rather than stubbed with unverified endpoints.
 */

export {
  API_BASE_URL,
  ApiRequestError,
  apiAction,
  apiDelete,
  apiDownload,
  apiGet,
  apiGetList,
  apiPatch,
  apiPost,
  apiPostMultipart,
  apiPut,
  buildParams,
  clearAuthTokens,
  clearTenantContext,
  default as apiClient,
  getAccessToken,
  getApiErrorMessage,
  getInstitutionId,
  getRefreshToken,
  hasSessionHint,
  fetchAllPages,
  isApiRequestError,
  isInstitutionSelector,
  isUuid,
  normalizePage,
  setAuthTokens,
  setInstitutionId,
} from "./client";

export * as attendanceApi from "./attendance";
export * as auditApi from "./audit";
export * as accountingApi from "./accounting";
export * as authApi from "./auth";
export { beginMFASetup, confirmMFASetup, disableMFA, getMFAStatus, setMFAMethod } from "./auth";
export * as dashboardsApi from "./dashboards";
export * as employeesApi from "./employees";
export * as institutionsApi from "./institutions";
export * as homeApi from "./home";
export * as leaveApi from "./leave";
export * as organizationApi from "./organization";
export * as payrollApi from "./payroll";
export * as platformApi from "./platform";
export * as reportsApi from "./reports";
export * as recruitmentApi from "./recruitment";
export * as schedulingApi from "./scheduling";
export * as searchApi from "./search";
export * as workflowsApi from "./workflows";
export * as expensesApi from "./expenses";
export * as operationsApi from "./operations";
export * as notificationsApi from "./notifications";
export * as imagesApi from "./images";
export * as reportLibraryApi from "./reportLibrary";
export * as documentChecklistApi from "./documentChecklist";
export * as trainingApi from "./training";
export * as performanceApi from "./performance";
