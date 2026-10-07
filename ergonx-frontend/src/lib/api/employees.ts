/**
 * Core HR employee service (module `CORE_HR`).
 *
 * Endpoints:
 *   GET/POST            /employees/
 *   GET/PATCH/PUT/DELETE /employees/{id}/
 *   GET                 /employees/{id}/employment-history/
 *   GET/POST            /employments/
 *   GET/PATCH/PUT       /employments/{id}/
 *
 * `DELETE /employees/{id}/` is a soft delete: the backend sets the employee's
 * status to INACTIVE rather than removing the record.
 */

import {
  apiAction,
  apiDelete,
  apiDownload,
  apiGet,
  apiGetList,
  apiPatch,
  apiPost,
  apiPostMultipart,
  apiPut,
  ApiRequestError,
  fetchAllPages,
} from "./client";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { ListParams, PaginatedData } from "@/types/api";
import type {
  Employee,
  EmployeeFilters,
  EmployeeLifecycle,
  EmployeeOffboarding,
  EmployeeOnboarding,
  EmployeePayload,
  Employment,
  EmploymentPayload,
  EmergencyContact,
  EmergencyContactPayload,
  OffboardingStartPayload,
} from "@/types/hr";

export type EmployeeListParams = ListParams & EmployeeFilters;

export async function listEmployees(
  params?: EmployeeListParams,
): Promise<PaginatedData<Employee>> {
  return apiGetList<Employee>("/employees/", params);
}

export async function getEmployee(id: string): Promise<Employee> {
  return apiGet<Employee>(`/employees/${id}/`);
}

/** Returns the employee record linked to the signed-in account, if any. */
export async function getCurrentEmployee(): Promise<Employee | null> {
  try {
    return await apiGet<Employee>("/employees/me/");
  } catch (error) {
    if (error instanceof ApiRequestError && error.isNotFound) {
      return null;
    }
    throw error;
  }
}

export async function updateMyProfile(payload: Partial<EmployeePayload>): Promise<Employee> {
  return apiPatch<Employee, Partial<EmployeePayload>>("/employees/me/profile/", payload);
}

export async function listMyEmergencyContacts(): Promise<EmergencyContact[]> {
  return apiGet<EmergencyContact[]>("/employees/me/emergency-contacts/");
}

export async function createMyEmergencyContact(
  payload: Omit<EmergencyContactPayload, "employee">,
): Promise<EmergencyContact> {
  return apiPost<EmergencyContact, Omit<EmergencyContactPayload, "employee">>("/employees/me/emergency-contacts/", payload);
}

export async function deleteMyEmergencyContact(id: string): Promise<void> {
  return apiDelete(`/employees/me/emergency-contacts/${id}/`);
}

export interface SelfServiceDocument { id: string; original_filename: string; category: string; classification: string; content_type: string; size_bytes: number; uploaded_by: string | null; created_at: string; }
/** Categories an employee can file their own documents under; mirrors SELF_SERVICE_DOCUMENT_CATEGORIES. */
export const MY_DOCUMENT_CATEGORIES = ["Identification", "Certificate", "Qualification", "Medical", "Bank details", "Contract", "Other"] as const;
export async function listMyDocuments(): Promise<SelfServiceDocument[]> { return apiGet<SelfServiceDocument[]>("/employees/me/documents/"); }
export async function uploadMyDocument(file: File, category: string, onProgress?: (percent: number) => void): Promise<SelfServiceDocument> {
  const body = new FormData();
  body.append("uploaded_file", file);
  body.append("category", category);
  return apiPostMultipart<SelfServiceDocument>("/employees/me/documents/", body, onProgress);
}
export async function downloadMyDocument(id: string): Promise<Blob> { return apiDownload(`/employees/me/documents/${id}/`); }
export async function removeMyDocument(id: string): Promise<void> { return apiDelete(`/employees/me/documents/${id}/`); }

export async function createEmployee(
  payload: EmployeePayload,
): Promise<Employee> {
  return apiPost<Employee, EmployeePayload>("/employees/", payload);
}

export async function updateEmployee(
  id: string,
  payload: Partial<EmployeePayload>,
): Promise<Employee> {
  return apiPatch<Employee, Partial<EmployeePayload>>(
    `/employees/${id}/`,
    payload,
  );
}

export async function replaceEmployee(
  id: string,
  payload: EmployeePayload,
): Promise<Employee> {
  return apiPut<Employee, EmployeePayload>(`/employees/${id}/`, payload);
}

/** Soft-deletes the employee (status becomes INACTIVE). */
export async function deactivateEmployee(id: string): Promise<void> {
  return apiDelete(`/employees/${id}/`);
}

export interface EmployeeSelfServiceInvitation {
  id: string;
  email: string;
  expires_at: string;
  acceptance_token: string;
  email_delivery_status: "sent" | "failed" | "not_configured";
}

/** Sends an employee-bound, single-use Self-Service account invitation. */
export async function inviteEmployeeToSelfService(
  id: string,
  payload: { expires_in_hours?: number } = {},
): Promise<EmployeeSelfServiceInvitation> {
  return apiPost<EmployeeSelfServiceInvitation, { expires_in_hours?: number }>(
    `/employees/${id}/invite-self-service/`,
    payload,
  );
}

/** Creates a Self-Service invitation for a person who is not yet an employee record. */
export async function inviteNewEmployeeToSelfService(
  email: string,
  payload: { expires_in_hours?: number } = {},
): Promise<EmployeeSelfServiceInvitation> {
  return apiPost<EmployeeSelfServiceInvitation, { email: string; expires_in_hours?: number }>(
    "/employees/invite-self-service/",
    { email, ...payload },
  );
}

/* Emergency contacts ------------------------------------------------------ */

/** Lists contacts for one employee through the canonical tenant-scoped API. */
export async function listEmergencyContacts(
  employeeId: string,
): Promise<PaginatedData<EmergencyContact>> {
  return apiGetList<EmergencyContact>("/emergency-contacts/", {
    employee: employeeId,
    page_size: MAX_PAGE_SIZE,
  });
}

export async function createEmergencyContact(
  payload: EmergencyContactPayload,
): Promise<EmergencyContact> {
  return apiPost<EmergencyContact, EmergencyContactPayload>(
    "/emergency-contacts/",
    payload,
  );
}

export async function updateEmergencyContact(
  id: string,
  payload: Partial<EmergencyContactPayload>,
): Promise<EmergencyContact> {
  return apiPatch<EmergencyContact, Partial<EmergencyContactPayload>>(
    `/emergency-contacts/${id}/`,
    payload,
  );
}

export async function deleteEmergencyContact(id: string): Promise<void> {
  return apiDelete(`/emergency-contacts/${id}/`);
}

/* Employee lifecycle ------------------------------------------------------ */

export async function getEmployeeLifecycle(id: string): Promise<EmployeeLifecycle> {
  return apiGet<EmployeeLifecycle>(`/employees/${id}/lifecycle/`);
}

export async function startEmployeeOnboarding(id: string): Promise<EmployeeOnboarding> {
  return apiAction<EmployeeOnboarding>(`/employees/${id}/onboarding/start/`);
}

export async function completeEmployeeOnboarding(id: string): Promise<EmployeeOnboarding> {
  return apiAction<EmployeeOnboarding>(`/employees/${id}/onboarding/complete/`);
}

export async function startEmployeeOffboarding(
  id: string,
  payload: OffboardingStartPayload = {},
): Promise<EmployeeOffboarding> {
  return apiAction<EmployeeOffboarding, OffboardingStartPayload>(
    `/employees/${id}/offboarding/start/`,
    payload,
  );
}

export async function completeEmployeeOffboarding(id: string): Promise<EmployeeOffboarding> {
  return apiAction<EmployeeOffboarding>(`/employees/${id}/offboarding/complete/`);
}

export interface RehireEmployeePayload {
  department_id: string;
  position_id: string;
  grade_id: string;
  location_id: string;
  employment_type: string;
  staff_category?: string;
  start_date: string;
}

export async function rehireEmployee(
  id: string,
  payload: RehireEmployeePayload,
): Promise<{ employee: Employee; employment: Employment; onboarding: EmployeeOnboarding }> {
  return apiAction<{ employee: Employee; employment: Employment; onboarding: EmployeeOnboarding }, RehireEmployeePayload>(
    `/employees/${id}/rehire/`,
    payload,
  );
}

/* Employment --------------------------------------------------------------- */

/**
 * Effective-dated employment history for one employee, newest first as
 * ordered by the backend selector. Requires `employment.view`.
 */
export async function listEmploymentHistory(
  employeeId: string,
  params?: ListParams,
): Promise<PaginatedData<Employment>> {
  return apiGetList<Employment>(
    `/employees/${employeeId}/employment-history/`,
    params,
  );
}

export async function listEmployments(
  params?: ListParams,
): Promise<PaginatedData<Employment>> {
  return apiGetList<Employment>("/employments/", params);
}

/**
 * Creating an employment with `is_current` runs the backend's
 * `change_current_employment` service, which closes the previous record
 * instead of overwriting it. History is never mutated in the browser.
 */
export async function createEmployment(
  payload: EmploymentPayload,
): Promise<Employment> {
  return apiPost<Employment, EmploymentPayload>("/employments/", payload);
}

export async function getEmployment(id: string): Promise<Employment> {
  return apiGet<Employment>(`/employments/${id}/`);
}

export async function updateEmployment(
  id: string,
  payload: Partial<EmploymentPayload>,
): Promise<Employment> {
  return apiPatch<Employment, Partial<EmploymentPayload>>(
    `/employments/${id}/`,
    payload,
  );
}

/** Pages read when building the lookup indexes below. */
const MAX_INDEX_PAGES = 5;

export interface CurrentEmploymentIndex {
  /** Employee id -> their current employment record. */
  byEmployee: Map<string, Employment>;
  /** True when the cap was hit and some employees may be unresolved. */
  truncated: boolean;
}

/**
 * Builds a lookup of current employment per employee, used to show
 * department, position, grade and location alongside employee records.
 *
 * Employee records themselves carry no assignment fields; those live on
 * `Employment`. The employments endpoint exposes no `is_current` filter, so
 * the current record is selected client-side.
 */
export async function loadCurrentEmploymentIndex(): Promise<CurrentEmploymentIndex> {
  const { items, truncated } = await fetchAllPages<Employment>(
    (page) =>
      listEmployments({
        page,
        page_size: MAX_PAGE_SIZE,
        ordering: "-start_date",
      }),
    MAX_INDEX_PAGES,
  );

  const byEmployee = new Map<string, Employment>();

  for (const employment of items) {
    if (employment.is_current && !byEmployee.has(employment.employee)) {
      byEmployee.set(employment.employee, employment);
    }
  }

  return { byEmployee, truncated };
}

export interface EmployeeIndex {
  byId: Map<string, Employee>;
  truncated: boolean;
}

/**
 * Employee id -> employee, for screens that receive employee references as
 * bare UUIDs (leave requests, attendance, payroll records) and need names.
 */
export async function loadEmployeeIndex(): Promise<EmployeeIndex> {
  const { items, truncated } = await fetchAllPages<Employee>(
    (page) =>
      listEmployees({
        page,
        page_size: MAX_PAGE_SIZE,
        ordering: "employee_number",
      }),
    MAX_INDEX_PAGES,
  );

  return {
    byId: new Map(items.map((employee) => [employee.id, employee])),
    truncated,
  };
}

export function employeeDisplayName(employee: Employee): string {
  const composed = [
    employee.first_name,
    employee.middle_name,
    employee.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return employee.full_name || composed || employee.employee_number;
}

export function employeeInitials(employee: Employee): string {
  const name = employeeDisplayName(employee);

  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
