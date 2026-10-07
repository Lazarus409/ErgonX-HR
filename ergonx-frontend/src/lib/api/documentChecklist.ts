/**
 * Employee document checklist (ErgonX HR): required documents, per-employee
 * status and organization-wide compliance. Mirrors `apps/documents/checklist.py`.
 */

import { apiDelete, apiGet, apiGetList, apiPatch, apiPost } from "./client";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { ListParams, PaginatedData } from "@/types/api";

export type ChecklistStatus = "ON_FILE" | "EXPIRING" | "EXPIRED" | "WAIVED" | "MISSING";

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  ON_FILE: "On file",
  EXPIRING: "Expiring soon",
  EXPIRED: "Expired",
  WAIVED: "Waived",
  MISSING: "Missing",
};

export const CHECKLIST_STATUS_TONES: Record<ChecklistStatus, "success" | "warning" | "danger" | "neutral" | "info"> = {
  ON_FILE: "success",
  EXPIRING: "warning",
  EXPIRED: "danger",
  WAIVED: "info",
  MISSING: "danger",
};

export interface DocumentRequirement {
  id: string;
  name: string;
  description: string;
  document_category: string;
  employment_types: string[];
  validity_months: number | null;
  is_mandatory: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DocumentRequirementPayload = Pick<DocumentRequirement, "name" | "description" | "document_category" | "employment_types" | "validity_months" | "is_mandatory" | "sort_order">;

export interface ChecklistItem {
  requirement_id: string;
  requirement: string;
  document_category: string;
  is_mandatory: boolean;
  validity_months: number | null;
  status: ChecklistStatus;
  document: { id: string; original_filename: string; uploaded_at: string } | null;
  expires_on: string | null;
  waiver: { id: string; reason: string; waived_by: string; waived_at: string } | null;
}

export interface ChecklistSummary {
  required: number;
  satisfied: number;
  missing: number;
  expired: number;
  expiring: number;
  complete: boolean;
  compliance_rate: number;
}

export interface EmployeeChecklist {
  employee_id: string;
  employee: string;
  summary: ChecklistSummary;
  items: ChecklistItem[];
}

export interface RequirementCompliance extends Record<ChecklistStatus, number> {
  requirement_id: string;
  requirement: string;
  document_category: string;
  is_mandatory: boolean;
  validity_months: number | null;
  applicable: number;
}

export interface EmployeeCompliance extends ChecklistSummary {
  employee_id: string;
  employee_number: string;
  employee: string;
  outstanding: string[];
}

export interface ComplianceOverview {
  as_of: string;
  employees: number;
  complete_employees: number;
  compliance_rate: number;
  requirements: RequirementCompliance[];
  employees_detail: EmployeeCompliance[];
}

export function listRequirements(params?: ListParams): Promise<PaginatedData<DocumentRequirement>> {
  return apiGetList<DocumentRequirement>("/document-requirements/", { page_size: MAX_PAGE_SIZE, ...params });
}
export function createRequirement(payload: DocumentRequirementPayload): Promise<DocumentRequirement> {
  return apiPost<DocumentRequirement, DocumentRequirementPayload>("/document-requirements/", payload);
}
export function updateRequirement(id: string, payload: Partial<DocumentRequirementPayload>): Promise<DocumentRequirement> {
  return apiPatch<DocumentRequirement, Partial<DocumentRequirementPayload>>(`/document-requirements/${id}/`, payload);
}
/** Deactivates the requirement; history and waivers are kept. */
export function deactivateRequirement(id: string): Promise<void> {
  return apiDelete(`/document-requirements/${id}/`);
}
export function getCompliance(params?: { department?: string }): Promise<ComplianceOverview> {
  return apiGet<ComplianceOverview>("/document-requirements/compliance/", { params });
}
export function getEmployeeChecklist(employeeId: string): Promise<EmployeeChecklist> {
  return apiGet<EmployeeChecklist>(`/employees/${employeeId}/document-checklist/`);
}
export function getMyChecklist(): Promise<EmployeeChecklist> {
  return apiGet<EmployeeChecklist>("/employees/me/document-checklist/");
}
export function waiveRequirement(payload: { requirement: string; employee: string; reason: string }): Promise<{ id: string }> {
  return apiPost<{ id: string }, typeof payload>("/document-requirement-waivers/", payload);
}
export function removeWaiver(id: string): Promise<void> {
  return apiDelete(`/document-requirement-waivers/${id}/`);
}
