/**
 * Attendance and scheduling types.
 *
 * Mirrors `apps/attendance/serializers.py` and
 * `apps/scheduling/serializers.py`. Scheduling belongs to the `ATTENDANCE`
 * module.
 */

export type AttendanceStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "OFF_DAY"
  | "REMOTE";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "ON_LEAVE",
  "HOLIDAY",
  "OFF_DAY",
  "REMOTE",
];

export type AttendanceSource =
  | "WEB"
  | "PWA"
  | "MANUAL"
  | "IMPORT"
  | "DEVICE"
  | "API";

export const ATTENDANCE_SOURCES: AttendanceSource[] = [
  "WEB",
  "PWA",
  "MANUAL",
  "IMPORT",
  "DEVICE",
  "API",
];

export type AdjustmentStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED";

export type OvertimeStatus = "PENDING" | "APPROVED" | "REJECTED";

/** Entirely read-only; created and mutated through the clock actions. */
export interface AttendanceRecord {
  id: string;
  employee: string;
  schedule_assignment: string | null;
  attendance_date: string;
  check_in: string | null;
  check_out: string | null;
  worked_minutes: number;
  late_minutes: number;
  early_departure_minutes: number;
  overtime_minutes: number;
  status: AttendanceStatus | string;
  source: AttendanceSource | string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceAdjustment {
  id: string;
  /** ADJ-XXXXXXXX */
  reference?: string;
  attendance_record: string;
  employee?: string;
  employee_name?: string;
  attendance_date?: string;
  requested_by: string | null;
  requested_by_name?: string | null;
  adjustment_type?: AdjustmentType | string;
  reason: string;
  evidence?: string | null;
  approved_by_name?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  decision_note?: string;
  changes_requested_at?: string | null;
  resubmitted_at?: string | null;
  /** Snapshot captured by the backend when the adjustment is raised. */
  old_values: Record<string, unknown>;
  proposed_values: Record<string, unknown>;
  status: AdjustmentStatus | string;
  approved_by: string | null;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceAdjustmentPayload {
  attendance_record: string;
  reason: string;
  proposed_values: Record<string, unknown>;
  adjustment_type?: AdjustmentType;
  evidence?: string | null;
}

export type AdjustmentType = "MISSED_CLOCK_IN" | "MISSED_CLOCK_OUT" | "ADD_MISSED_HOURS" | "TIME_CORRECTION" | "NOTE_ONLY";

export interface TimeWindow {
  start: string | null;
  end: string | null;
  minutes: number | null;
  off_day?: boolean;
}

/** GET /attendance-adjustments/{id}/review/ */
export interface AdjustmentReviewContext {
  reference: string;
  employee_id: string;
  employee_name: string;
  employee_number: string;
  department: string | null;
  position: string | null;
  attendance_date: string;
  scheduled: TimeWindow | null;
  recorded: TimeWindow | null;
  requested: TimeWindow | null;
  difference_minutes: number | null;
  compliant: boolean;
  policy_checks: Array<{ code: string; label: string; status: string; detail: string }>;
  queue: { previous_id: string | null; next_id: string | null; position: number | null; total: number };
  employee_dates: { previous_id: string | null; next_id: string | null };
  is_requester: boolean;
  can_decide: boolean;
  can_delegate: boolean;
}

/** Read-only; generated from attendance, decided through approve/reject. */
export interface OvertimeRecord {
  id: string;
  employee: string;
  attendance_record: string;
  calculated_minutes: number;
  approved_minutes: number;
  rate_multiplier: string;
  status: OvertimeStatus | string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/* Scheduling ---------------------------------------------------------------- */

export interface Shift {
  id: string;
  name: string;
  code: string;
  start_time: string;
  end_time: string;
  crosses_midnight: boolean;
  break_minutes: number;
  grace_period_minutes: number;
  /** Derived by the backend from the shift times and break. */
  scheduled_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShiftPattern {
  id: string;
  name: string;
  code: string;
  cycle_length_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShiftPatternDay {
  id: string;
  shift_pattern: string;
  day_index: number;
  shift: string | null;
  is_off_day: boolean;
  created_at: string;
  updated_at: string;
}

export interface RotationPattern {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RotationStep {
  id: string;
  rotation_pattern: string;
  sequence: number;
  shift_pattern: string | null;
  shift: string | null;
  duration_days: number;
  created_at: string;
  updated_at: string;
}

export interface FlexibleWorkRule {
  id: string;
  name: string;
  earliest_start: string | null;
  latest_start: string | null;
  earliest_end: string | null;
  latest_end: string | null;
  required_minutes: number;
  core_start: string | null;
  core_end: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ScheduleType =
  | "FIXED"
  | "SHIFT_PATTERN"
  | "ROTATING"
  | "FLEXIBLE";

export const SCHEDULE_TYPES: ScheduleType[] = [
  "FIXED",
  "SHIFT_PATTERN",
  "ROTATING",
  "FLEXIBLE",
];

export interface WorkSchedule {
  id: string;
  name: string;
  code: string;
  schedule_type: ScheduleType | string;
  effective_from: string;
  effective_to: string | null;
  timezone: string;
  is_active: boolean;
  fixed_shift: string | null;
  shift_pattern: string | null;
  rotation_pattern: string | null;
  flexible_rule: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleAssignment {
  id: string;
  employee: string;
  work_schedule: string;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleAssignmentPayload {
  employee: string;
  work_schedule: string;
  effective_from: string;
  effective_to?: string | null;
  is_current?: boolean;
}
