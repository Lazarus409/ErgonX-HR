/**
 * Training records (ErgonX HR): course catalogue, enrolments and certificates.
 * Mirrors `apps/training`.
 */

import { apiAction, apiDelete, apiGet, apiGetList, apiPatch, apiPost } from "./client";
import { MAX_PAGE_SIZE } from "@/types/api";
import type { ListParams, PaginatedData } from "@/types/api";

export type CourseCategory = "SAFETY" | "TECHNICAL" | "COMPLIANCE" | "LEADERSHIP" | "INDUCTION" | "SOFT_SKILLS" | "OTHER";
export type DeliveryMode = "CLASSROOM" | "ONLINE" | "ON_THE_JOB" | "BLENDED";
export type EnrollmentStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "NOT_PASSED" | "CANCELLED";
export type CertificateStatus = "VALID" | "EXPIRING" | "EXPIRED";

export const COURSE_CATEGORY_LABELS: Record<CourseCategory, string> = {
  SAFETY: "Health, safety & environment",
  TECHNICAL: "Technical skills",
  COMPLIANCE: "Compliance & regulatory",
  LEADERSHIP: "Leadership & management",
  INDUCTION: "Induction & onboarding",
  SOFT_SKILLS: "Professional skills",
  OTHER: "Other",
};
export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = { CLASSROOM: "Classroom", ONLINE: "Online", ON_THE_JOB: "On the job", BLENDED: "Blended" };
export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = { PLANNED: "Planned", IN_PROGRESS: "In progress", COMPLETED: "Completed", NOT_PASSED: "Not passed", CANCELLED: "Cancelled" };
export const ENROLLMENT_STATUS_TONES: Record<EnrollmentStatus, "info" | "warning" | "success" | "danger" | "neutral"> = { PLANNED: "info", IN_PROGRESS: "warning", COMPLETED: "success", NOT_PASSED: "danger", CANCELLED: "neutral" };
export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = { VALID: "Valid", EXPIRING: "Expiring soon", EXPIRED: "Expired" };
export const CERTIFICATE_STATUS_TONES: Record<CertificateStatus, "success" | "warning" | "danger"> = { VALID: "success", EXPIRING: "warning", EXPIRED: "danger" };

export interface TrainingCourse {
  id: string;
  code: string;
  title: string;
  description: string;
  category: CourseCategory;
  delivery_mode: DeliveryMode;
  provider: string;
  duration_hours: string | null;
  certificate_validity_months: number | null;
  is_mandatory: boolean;
  is_active: boolean;
  enrolled?: number;
  created_at: string;
  updated_at: string;
}

export type TrainingCoursePayload = Pick<TrainingCourse, "code" | "title" | "description" | "category" | "delivery_mode" | "provider" | "duration_hours" | "certificate_validity_months" | "is_mandatory">;

export interface TrainingEnrollment {
  id: string;
  course: string;
  course_title: string;
  course_code: string;
  course_category: CourseCategory;
  employee: string;
  employee_name: string;
  employee_number: string;
  status: EnrollmentStatus;
  planned_start: string | null;
  planned_end: string | null;
  completed_on: string | null;
  score: string | null;
  certificate_number: string;
  certificate_expires_on: string | null;
  certificate_status: CertificateStatus | null;
  certificate_document: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Certification {
  enrollment_id: string;
  employee_id: string;
  employee: string;
  employee_number: string;
  course_id: string;
  course: string;
  certificate_number: string;
  completed_on: string;
  expires_on: string;
  status: CertificateStatus;
}

export interface TrainingOverview {
  active_courses: number;
  planned: number;
  in_progress: number;
  completed_this_year: number;
  certificates_valid: number;
  certificates_expiring: number;
  certificates_expired: number;
  attention: Certification[];
}

export function listCourses(params?: ListParams): Promise<PaginatedData<TrainingCourse>> {
  return apiGetList<TrainingCourse>("/training-courses/", { page_size: MAX_PAGE_SIZE, ordering: "title", ...params });
}
export function createCourse(payload: TrainingCoursePayload): Promise<TrainingCourse> {
  return apiPost<TrainingCourse, TrainingCoursePayload>("/training-courses/", payload);
}
export function updateCourse(id: string, payload: Partial<TrainingCoursePayload>): Promise<TrainingCourse> {
  return apiPatch<TrainingCourse, Partial<TrainingCoursePayload>>(`/training-courses/${id}/`, payload);
}
/** Deactivates the course; enrolment history is kept. */
export function deactivateCourse(id: string): Promise<void> {
  return apiDelete(`/training-courses/${id}/`);
}

export function listEnrollments(params?: ListParams): Promise<PaginatedData<TrainingEnrollment>> {
  return apiGetList<TrainingEnrollment>("/training-enrollments/", { page_size: MAX_PAGE_SIZE, ...params });
}
export interface EnrollPayload { course: string; employees: string[]; planned_start?: string | null; planned_end?: string | null; notes?: string }
export function enroll(payload: EnrollPayload): Promise<{ created: TrainingEnrollment[]; skipped: Array<{ employee_id: string; employee: string }> }> {
  return apiPost<{ created: TrainingEnrollment[]; skipped: Array<{ employee_id: string; employee: string }> }, EnrollPayload>("/training-enrollments/", payload);
}
export function startEnrollment(id: string): Promise<TrainingEnrollment> {
  return apiAction<TrainingEnrollment>(`/training-enrollments/${id}/start/`);
}
export interface CompletePayload { passed: boolean; completed_on?: string; score?: string | null; certificate_number?: string; certificate_expires_on?: string | null }
export function completeEnrollment(id: string, payload: CompletePayload): Promise<TrainingEnrollment> {
  return apiPost<TrainingEnrollment, CompletePayload>(`/training-enrollments/${id}/complete/`, payload);
}
export function cancelEnrollment(id: string, reason = ""): Promise<TrainingEnrollment> {
  return apiPost<TrainingEnrollment, { reason: string }>(`/training-enrollments/${id}/cancel/`, { reason });
}
export function getOverview(): Promise<TrainingOverview> {
  return apiGet<TrainingOverview>("/training-enrollments/overview/");
}
export function getMyTraining(): Promise<{ enrollments: TrainingEnrollment[]; certifications: Certification[] }> {
  return apiGet<{ enrollments: TrainingEnrollment[]; certifications: Certification[] }>("/training/my/");
}
