/**
 * Scheduling service.
 *
 * Scheduling is gated by the `ATTENDANCE` module and the `schedule.view` /
 * `schedule.manage` permissions.
 *
 * Endpoints: /shifts/, /shift-patterns/, /shift-pattern-days/,
 * /rotation-patterns/, /rotation-steps/, /flexible-work-rules/,
 * /work-schedules/, /schedule-assignments/.
 */

import { apiDelete, apiGet, apiGetList, apiPatch, apiPost } from "./client";
import type { ListParams, PaginatedData } from "@/types/api";
import type {
  FlexibleWorkRule,
  RotationPattern,
  RotationStep,
  ScheduleAssignment,
  ScheduleAssignmentPayload,
  Shift,
  ShiftPattern,
  ShiftPatternDay,
  WorkSchedule,
} from "@/types/attendance";

/* Shifts ------------------------------------------------------------------- */

export async function listShifts(
  params?: ListParams,
): Promise<PaginatedData<Shift>> {
  return apiGetList<Shift>("/shifts/", params);
}

export async function getShift(id: string): Promise<Shift> {
  return apiGet<Shift>(`/shifts/${id}/`);
}

export async function createShift(payload: Partial<Shift>): Promise<Shift> {
  return apiPost<Shift, Partial<Shift>>("/shifts/", payload);
}

export async function updateShift(
  id: string,
  payload: Partial<Shift>,
): Promise<Shift> {
  return apiPatch<Shift, Partial<Shift>>(`/shifts/${id}/`, payload);
}

export async function deleteShift(id: string): Promise<void> {
  return apiDelete(`/shifts/${id}/`);
}

/* Shift patterns ----------------------------------------------------------- */

export async function listShiftPatterns(
  params?: ListParams,
): Promise<PaginatedData<ShiftPattern>> {
  return apiGetList<ShiftPattern>("/shift-patterns/", params);
}

export async function getShiftPattern(id: string): Promise<ShiftPattern> {
  return apiGet<ShiftPattern>(`/shift-patterns/${id}/`);
}

export async function createShiftPattern(
  payload: Partial<ShiftPattern>,
): Promise<ShiftPattern> {
  return apiPost<ShiftPattern, Partial<ShiftPattern>>(
    "/shift-patterns/",
    payload,
  );
}

export async function updateShiftPattern(
  id: string,
  payload: Partial<ShiftPattern>,
): Promise<ShiftPattern> {
  return apiPatch<ShiftPattern, Partial<ShiftPattern>>(
    `/shift-patterns/${id}/`,
    payload,
  );
}

export async function deleteShiftPattern(id: string): Promise<void> {
  return apiDelete(`/shift-patterns/${id}/`);
}

export interface ShiftPatternDayParams extends ListParams {
  shift_pattern?: string;
  shift?: string;
  is_off_day?: boolean;
}

export async function listShiftPatternDays(
  params?: ShiftPatternDayParams,
): Promise<PaginatedData<ShiftPatternDay>> {
  return apiGetList<ShiftPatternDay>("/shift-pattern-days/", params);
}

export async function createShiftPatternDay(
  payload: Partial<ShiftPatternDay>,
): Promise<ShiftPatternDay> {
  return apiPost<ShiftPatternDay, Partial<ShiftPatternDay>>(
    "/shift-pattern-days/",
    payload,
  );
}

export async function updateShiftPatternDay(
  id: string,
  payload: Partial<ShiftPatternDay>,
): Promise<ShiftPatternDay> {
  return apiPatch<ShiftPatternDay, Partial<ShiftPatternDay>>(
    `/shift-pattern-days/${id}/`,
    payload,
  );
}

export async function deleteShiftPatternDay(id: string): Promise<void> {
  return apiDelete(`/shift-pattern-days/${id}/`);
}

/* Rotation patterns -------------------------------------------------------- */

export async function listRotationPatterns(
  params?: ListParams,
): Promise<PaginatedData<RotationPattern>> {
  return apiGetList<RotationPattern>("/rotation-patterns/", params);
}

export async function createRotationPattern(
  payload: Partial<RotationPattern>,
): Promise<RotationPattern> {
  return apiPost<RotationPattern, Partial<RotationPattern>>(
    "/rotation-patterns/",
    payload,
  );
}

export async function updateRotationPattern(
  id: string,
  payload: Partial<RotationPattern>,
): Promise<RotationPattern> {
  return apiPatch<RotationPattern, Partial<RotationPattern>>(
    `/rotation-patterns/${id}/`,
    payload,
  );
}

export async function deleteRotationPattern(id: string): Promise<void> {
  return apiDelete(`/rotation-patterns/${id}/`);
}

export interface RotationStepParams extends ListParams {
  rotation_pattern?: string;
  shift_pattern?: string;
  shift?: string;
}

export async function listRotationSteps(
  params?: RotationStepParams,
): Promise<PaginatedData<RotationStep>> {
  return apiGetList<RotationStep>("/rotation-steps/", params);
}

export async function createRotationStep(
  payload: Partial<RotationStep>,
): Promise<RotationStep> {
  return apiPost<RotationStep, Partial<RotationStep>>(
    "/rotation-steps/",
    payload,
  );
}

export async function updateRotationStep(
  id: string,
  payload: Partial<RotationStep>,
): Promise<RotationStep> {
  return apiPatch<RotationStep, Partial<RotationStep>>(
    `/rotation-steps/${id}/`,
    payload,
  );
}

export async function deleteRotationStep(id: string): Promise<void> {
  return apiDelete(`/rotation-steps/${id}/`);
}

/* Flexible work rules ------------------------------------------------------ */

export async function listFlexibleWorkRules(
  params?: ListParams,
): Promise<PaginatedData<FlexibleWorkRule>> {
  return apiGetList<FlexibleWorkRule>("/flexible-work-rules/", params);
}

export async function createFlexibleWorkRule(
  payload: Partial<FlexibleWorkRule>,
): Promise<FlexibleWorkRule> {
  return apiPost<FlexibleWorkRule, Partial<FlexibleWorkRule>>(
    "/flexible-work-rules/",
    payload,
  );
}

export async function updateFlexibleWorkRule(
  id: string,
  payload: Partial<FlexibleWorkRule>,
): Promise<FlexibleWorkRule> {
  return apiPatch<FlexibleWorkRule, Partial<FlexibleWorkRule>>(
    `/flexible-work-rules/${id}/`,
    payload,
  );
}

export async function deleteFlexibleWorkRule(id: string): Promise<void> {
  return apiDelete(`/flexible-work-rules/${id}/`);
}

/* Work schedules ----------------------------------------------------------- */

export interface WorkScheduleParams extends ListParams {
  schedule_type?: string;
  is_active?: boolean;
}

export async function listWorkSchedules(
  params?: WorkScheduleParams,
): Promise<PaginatedData<WorkSchedule>> {
  return apiGetList<WorkSchedule>("/work-schedules/", params);
}

export async function getWorkSchedule(id: string): Promise<WorkSchedule> {
  return apiGet<WorkSchedule>(`/work-schedules/${id}/`);
}

export async function createWorkSchedule(
  payload: Partial<WorkSchedule>,
): Promise<WorkSchedule> {
  return apiPost<WorkSchedule, Partial<WorkSchedule>>(
    "/work-schedules/",
    payload,
  );
}

export async function updateWorkSchedule(
  id: string,
  payload: Partial<WorkSchedule>,
): Promise<WorkSchedule> {
  return apiPatch<WorkSchedule, Partial<WorkSchedule>>(
    `/work-schedules/${id}/`,
    payload,
  );
}

export async function deleteWorkSchedule(id: string): Promise<void> {
  return apiDelete(`/work-schedules/${id}/`);
}

/* Schedule assignments ----------------------------------------------------- */

export interface ScheduleAssignmentParams extends ListParams {
  employee?: string;
  work_schedule?: string;
  is_current?: boolean;
}

export async function listScheduleAssignments(
  params?: ScheduleAssignmentParams,
): Promise<PaginatedData<ScheduleAssignment>> {
  return apiGetList<ScheduleAssignment>("/schedule-assignments/", params);
}

/**
 * Assignments are append-only: the endpoint accepts GET and POST only.
 * Creating a current assignment closes the previous effective-dated record
 * through the backend service rather than overwriting it.
 */
export async function createScheduleAssignment(
  payload: ScheduleAssignmentPayload,
): Promise<ScheduleAssignment> {
  return apiPost<ScheduleAssignment, ScheduleAssignmentPayload>(
    "/schedule-assignments/",
    payload,
  );
}
