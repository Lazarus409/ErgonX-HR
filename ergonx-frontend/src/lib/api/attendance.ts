/**
 * Attendance service (module `ATTENDANCE`).
 *
 * Endpoints:
 *   /attendance-records/            GET only for the collection
 *   /attendance-records/calendar/   GET, derived attendance projection
 *   /attendance-records/clock-in/   POST
 *   /attendance-records/{id}/clock-out/ POST
 *   /attendance-records/classify/   POST
 *   /attendance-adjustments/        GET, POST + /approve/, /reject/
 *   /overtime-records/              GET only + /approve/, /reject/
 *
 * Attendance records cannot be created or edited directly: `POST
 * /attendance-records/` is rejected in favour of the clock-in action, and
 * overtime is generated from attendance rather than posted. Both serializers
 * are fully read-only.
 */

import { apiAction, apiGet, apiGetList, apiPost } from "./client";
import type { ListParams, PaginatedData } from "@/types/api";
import type {
  AdjustmentReviewContext,
  AttendanceAdjustment,
  AttendanceAdjustmentPayload,
  AttendanceRecord,
  AttendanceSource,
  OvertimeRecord,
} from "@/types/attendance";

/**
 * `employee`, `attendance_date`, `status` and `source` are exact-match
 * filters. `date_from` / `date_to` are range parameters handled directly by
 * the viewset.
 */
export interface AttendanceRecordParams extends ListParams {
  employee?: string;
  attendance_date?: string;
  status?: string;
  source?: string;
  date_from?: string;
  date_to?: string;
}

export async function listAttendanceRecords(
  params?: AttendanceRecordParams,
): Promise<PaginatedData<AttendanceRecord>> {
  return apiGetList<AttendanceRecord>("/attendance-records/", params);
}

export async function getAttendanceRecord(
  id: string,
): Promise<AttendanceRecord> {
  return apiGet<AttendanceRecord>(`/attendance-records/${id}/`);
}

/**
 * Calendar rows carry the derived status and minute fields; there is no
 * separate attendance-alert resource.
 */
export async function getAttendanceCalendar(
  params?: AttendanceRecordParams,
): Promise<PaginatedData<AttendanceRecord>> {
  return apiGetList<AttendanceRecord>("/attendance-records/calendar/", params);
}

/**
 * Resolves the employee's effective schedule and classifies lateness. The
 * backend refuses a clock-in during approved leave.
 */
export async function clockIn(payload: {
  employee: string;
  at?: string;
  source?: AttendanceSource | string;
}): Promise<AttendanceRecord> {
  return apiPost<AttendanceRecord>("/attendance-records/clock-in/", payload);
}

export async function clockOut(
  id: string,
  payload: { at?: string } = {},
): Promise<AttendanceRecord> {
  return apiAction<AttendanceRecord>(
    `/attendance-records/${id}/clock-out/`,
    payload,
  );
}

/** Recomputes status and minute fields for one employee and date. */
export async function classifyAttendance(payload: {
  employee: string;
  attendance_date: string;
}): Promise<AttendanceRecord> {
  return apiPost<AttendanceRecord>("/attendance-records/classify/", payload);
}

/* Adjustments -------------------------------------------------------------- */

export interface AdjustmentParams extends ListParams {
  attendance_record?: string;
  requested_by?: string;
  status?: string;
}

export async function listAttendanceAdjustments(
  params?: AdjustmentParams,
): Promise<PaginatedData<AttendanceAdjustment>> {
  return apiGetList<AttendanceAdjustment>("/attendance-adjustments/", params);
}

/** `old_values` is snapshotted by the backend, not supplied by the client. */
export async function createAttendanceAdjustment(
  payload: AttendanceAdjustmentPayload,
): Promise<AttendanceAdjustment> {
  return apiPost<AttendanceAdjustment, AttendanceAdjustmentPayload>(
    "/attendance-adjustments/",
    payload,
  );
}

export async function approveAdjustment(
  id: string,
  comment = "",
): Promise<AttendanceAdjustment> {
  return apiAction<AttendanceAdjustment>(
    `/attendance-adjustments/${id}/approve/`,
    { comment },
  );
}

export async function rejectAdjustment(
  id: string,
  comment = "",
): Promise<AttendanceAdjustment> {
  return apiAction<AttendanceAdjustment>(
    `/attendance-adjustments/${id}/reject/`,
    { comment },
  );
}

export async function getAttendanceAdjustment(id: string): Promise<AttendanceAdjustment> {
  return apiGet<AttendanceAdjustment>(`/attendance-adjustments/${id}/`);
}

export async function getAdjustmentReview(id: string): Promise<AdjustmentReviewContext> {
  return apiGet<AdjustmentReviewContext>(`/attendance-adjustments/${id}/review/`);
}

/** Returns a pending adjustment to the requester with a note. */
export async function requestAdjustmentChanges(id: string, comment: string): Promise<AttendanceAdjustment> {
  return apiAction<AttendanceAdjustment>(`/attendance-adjustments/${id}/request-changes/`, { comment });
}

/** Requester edits a returned adjustment and sends it back for review. */
export async function resubmitAdjustment(
  id: string,
  payload: { reason?: string; proposed_values?: Record<string, unknown>; evidence?: string | null },
): Promise<AttendanceAdjustment> {
  return apiAction<AttendanceAdjustment>(`/attendance-adjustments/${id}/resubmit/`, payload);
}

export async function delegateAdjustment(id: string, delegate: string, comment = ""): Promise<AttendanceAdjustment> {
  return apiAction<AttendanceAdjustment>(`/attendance-adjustments/${id}/delegate/`, { delegate, comment });
}

export async function listAdjustmentDelegates(id: string): Promise<Array<{ id: string; name: string; role: string }>> {
  return apiGet<Array<{ id: string; name: string; role: string }>>(`/attendance-adjustments/${id}/delegates/`);
}

/* Overtime ----------------------------------------------------------------- */

export interface OvertimeParams extends ListParams {
  employee?: string;
  status?: string;
}

export async function listOvertimeRecords(
  params?: OvertimeParams,
): Promise<PaginatedData<OvertimeRecord>> {
  return apiGetList<OvertimeRecord>("/overtime-records/", params);
}

/**
 * Approving may cap the minutes credited. The backend enforces
 * `approved_minutes <= calculated_minutes`. Only approved overtime is
 * consumed by Payroll.
 */
export async function approveOvertime(
  id: string,
  approvedMinutes?: number,
): Promise<OvertimeRecord> {
  return apiAction<OvertimeRecord>(
    `/overtime-records/${id}/approve/`,
    approvedMinutes === undefined
      ? {}
      : { approved_minutes: approvedMinutes },
  );
}

export async function rejectOvertime(id: string): Promise<OvertimeRecord> {
  return apiAction<OvertimeRecord>(`/overtime-records/${id}/reject/`);
}

/** Formats a minute count as `7h 30m`. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) {
    return "—";
  }

  if (minutes === 0) {
    return "0m";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${remainder}m`;
  }

  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}
