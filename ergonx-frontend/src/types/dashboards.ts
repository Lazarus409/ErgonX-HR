/**
 * Dashboard rollup types.
 *
 * Mirrors `apps/dashboards/views.py`. Note the API paths are plural
 * (`/dashboards/...`) and the accounting screen reads the `finance` rollup;
 * there is no dedicated accounting dashboard endpoint.
 */

export interface StatusCount {
  status: string;
  count: number;
}

export interface HireYearCount {
  year: number | null;
  count: number;
}

export interface NamedCount {
  count: number;
  department__name?: string;
  grade__name?: string;
  location__name?: string;
  employment_type?: string;
}

export interface RecentHire {
  id: string;
  first_name: string;
  last_name: string;
  employee_number: string;
  hire_date: string;
  employments__department__name: string;
  employments__position__title: string;
}

export interface EmployeeMetrics {
  total_employees: number;
  active_employees: number;
  by_status: StatusCount[];
}

export interface ExecutiveDashboard extends EmployeeMetrics {
  executive_title?: string;
  currency: string;
  pending_leave_requests?: number;
  pending_journals?: number;
  payroll_cost?: string | number;
  attendance_today?: {
    present: number;
    late: number;
    absent: number;
    on_leave: number;
  };
  financial_position?: {
    bank_balance: string | number;
    registered_bank_accounts: number;
    accounts_payable: string | number;
    accounts_receivable: string | number;
    posted_expenses: string | number;
  };
  recruitment_summary?: {
    open_jobs: number;
    active_candidates: number;
    applications: number;
    scheduled_interviews: number;
    offers_extended: number;
  };
  payroll_by_period?: Array<{
    label: string;
    period_end: string;
    gross_pay: string | number;
  }>;
  profit_and_loss_trend?: ProfitAndLossPoint[];
  cash_flow_trend?: CashFlowPoint[];
}

export interface ProfitAndLossPoint {
  month: string;
  income: string | number;
  expenses: string | number;
  net_income: string | number;
}

export interface CashFlowPoint {
  month: string;
  inflow: string | number;
  outflow: string | number;
  net_movement: string | number;
}

export interface HrDashboard extends EmployeeMetrics {
  by_hire_year: HireYearCount[];
  by_department: NamedCount[];
  by_grade: NamedCount[];
  by_location: NamedCount[];
  by_employment_type: NamedCount[];
  recent_hires: RecentHire[];
  /** Document checklist; null until HR sets up document requirements. */
  document_compliance?: { compliance_rate: number; complete_employees: number; employees: number; outstanding_employees: number } | null;
}

export interface LeaveDashboard {
  pending: number;
  currently_on_leave: number;
  upcoming: number;
  by_leave_type: Array<{
    leave_type__name: string;
    request_count: number;
    requested_days: string | number;
  }>;
  monthly_approved_leave: Array<{
    month: string;
    request_count: number;
    requested_days: string | number;
  }>;
  balance_utilisation: {
    year: number;
    entitlement_days: string | number;
    used_days: string | number;
    available_days: string | number;
    utilisation_percent: string | number | null;
  };
  /** Current-year approved leave days by current department (top 8). */
  approved_days_by_department?: Array<{ department: string; requested_days: string | number; request_count: number }>;
  /** 28 consecutive days from today: approved requests covering each day. */
  leave_calendar?: Array<{ date: string; on_leave: number }>;
  range_months?: number;
  range_start?: string;
  /** Submitted (non-draft) requests starting within the range. */
  total_requests?: number;
  approved_requests?: number;
  /** Approved leave days / (active headcount x working days) in the range, %. */
  average_absence_rate?: string | number | null;
  compliance?: Record<"policy_breaches" | "incomplete_leave_records" | "upcoming_long_absences", { count: number; items: Array<{ id: string; employee: string; issue: string }> }>;
}

export interface AttendanceDashboard {
  present: number;
  late: number;
  absent: number;
  overtime_minutes: number;
  weekly_attendance: Array<{
    date: string;
    present: number;
    late: number;
    absent: number;
    on_leave: number;
    overtime_minutes: number;
  }>;
  by_department: Array<{
    employee__employments__department__name: string;
    present: number;
    late: number;
    absent: number;
    on_leave: number;
    total: number;
  }>;
  repeated_lateness: Array<{
    employee_id: string;
    employee__first_name: string;
    employee__last_name: string;
    employee__employee_number: string;
    employee__employments__department__name: string;
    late_occurrences: number;
    total_minutes_late: number;
  }>;
  lateness_trend: Array<{ month: string; late_occurrences: number; total_minutes_late: number }>;
  lateness_by_department: Array<{ employee__employments__department__name: string; late_occurrences: number; total_minutes_late: number }>;
  range_months?: number;
  range_start?: string;
  /** Attended (present, late, remote) / attended + absent over the range, %. */
  attendance_rate?: number | null;
  late_arrivals?: number;
  /** Clock-ins without a clock-out on past days in the range. */
  missing_punches?: number;
  pending_adjustments?: number;
  attendance_trend?: Array<{ month: string; attendance_rate: number | null }>;
  department_rates?: Array<{ department: string; attendance_rate: number | null; records: number }>;
  priority_exceptions?: Array<{ record_id: string; employee_id: string; employee: string; issue: string; date: string; status: string }>;
  recent_adjustments?: Array<{ id: string; employee: string; adjustment_type: string; adjusted_by: string; date: string; status: string }>;
}

export interface PayrollDashboard {
  latest_run_id: string | null;
  latest_run_status: string | null;
  pending_runs: number;
  finalized_gross_pay: string | number;
  finalized_net_pay: string | number;
  finalized_deductions: string | number;
  employer_contributions: string | number;
  runs_by_status: StatusCount[];
  payroll_by_period: Array<{
    label: string;
    period_end: string;
    gross_pay: string | number;
    net_pay: string | number;
    total_deductions: string | number;
  }>;
  /** Gross pay by current department for the latest finalized run. */
  cost_by_department?: { period: string | null; departments: Array<{ department: string; gross_pay: string | number }> };
}

export interface FinanceAttentionItem {
  type: string;
  description: string;
  entity: string;
  date: string;
  status: string;
  href: string;
}

export interface FinanceDashboard {
  range_months?: number;
  range_start?: string;
  cash_flow_range?: CashFlowPoint[];
  reconciliation_exceptions?: number;
  pending_approvals?: number;
  pending_approvals_breakdown?: { journals: number; vendor_bills: number; expenses: number };
  unposted_journals?: number;
  close_status?: { current_period: string | null; current_status: string | null; current_end: string | null; overdue_open_periods: number };
  needs_attention?: FinanceAttentionItem[];
  needs_attention_total?: number;
  recent_journals?: Array<{ id: string; entry_date: string; journal_number: string; description: string; source: string; status: string }>;
  controls?: Record<"period_close" | "segregation_of_duties" | "audit_trail", { ok: boolean; detail: string }>;
  currency: string;
  pending_journals: number;
  accounts_payable: string | number;
  accounts_receivable: string | number;
  expenses: string | number;
  bank_balance: string | number;
  registered_bank_accounts: number;
  accounts_payable_aging: Array<{ bucket: string; amount: string | number }>;
  accounts_receivable_aging: Array<{ bucket: string; amount: string | number }>;
  journals_by_status: StatusCount[];
  profit_and_loss_trend: ProfitAndLossPoint[];
  cash_flow_trend: CashFlowPoint[];
  /** Posted expenses by expense account: top five plus "Other". */
  expenses_by_account?: Array<{ label: string; value: string | number }>;
  unreconciled_bank_lines?: {
    count: number;
    latest: Array<{ id: string; statement_date: string; bank_account: string; reference: string; description: string; amount: string | number; currency: string; status: string }>;
  };
}

export interface RecruitmentBoardCard {
  id: string;
  candidate_id: string;
  candidate: string;
  job_posting_id: string;
  job_title: string;
  status: string;
  applied_at: string | null;
}

export interface RecruitmentBoardColumn {
  key: string;
  label: string;
  stage_id?: string;
  count: number;
  cards: RecruitmentBoardCard[];
}

export interface RecruitmentDashboard {
  range_months?: number;
  range_start?: string;
  /** Sum of openings on published requisitions. */
  open_roles?: number;
  requisitions_pending_approval?: number;
  candidates_in_process?: number;
  interviews_this_week?: number;
  offers_pending?: number;
  /** Draft, each active stage, then Hired — applications within the range. */
  board?: RecruitmentBoardColumn[];
  job_options?: Array<{ id: string; title: string; code: string }>;
  open_jobs: number;
  active_candidates: number;
  applications: number;
  scheduled_interviews: number;
  offers_extended: number;
  pipeline: Array<{ name: string; count: number }>;
  applications_by_status?: Array<{ status: string; count: number }>;
  /** Six calendar months ending with the current month, by application date. */
  applications_trend?: Array<{ month: string; applications: number }>;
  top_open_jobs?: Array<{ title: string; application_count: number }>;
  applications_by_source?: Array<{ source: string; count: number }>;
  interviews_by_status?: Array<{ status: string; count: number }>;
  /** Accepted offers bucketed by days from application to acceptance. */
  time_to_hire?: Array<{ bucket: string; hires: number }>;
}

/* Department Head workspace (`/dashboards/department/`) -------------------- */

export interface DepartmentTodayCounts {
  present: number;
  late: number;
  absent: number;
  on_leave: number;
  remote: number;
  not_recorded: number;
}

export interface DepartmentTeamMember {
  employee_id: string;
  employee_number: string;
  full_name: string;
  work_email: string;
  phone: string;
  status: string;
  department: string;
  position: string;
  grade: string;
  employment_type: string;
  reports_to: string | null;
  today_status: string | null;
}

export interface DepartmentLeaveItem {
  id: string;
  employee: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  requested_days?: string;
  status?: string;
}

export interface DepartmentApprovalItem {
  id: string;
  employee: string;
  employee_number: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  requested_days: string;
  reason: string;
  submitted_at: string | null;
  step: number;
  available_balance: string | null;
  also_off: string[];
}

export interface DepartmentDashboard {
  as_of: string;
  departments: Array<{ id: string; name: string; code: string; headcount: number }>;
  headcount: number;
  team: DepartmentTeamMember[];
  today: Partial<DepartmentTodayCounts>;
  on_leave_today: DepartmentLeaveItem[];
  upcoming_leave: DepartmentLeaveItem[];
  pending_approvals: number;
  approval_queue: DepartmentApprovalItem[];
  leave_by_type: Array<{ leave_type__name: string; days: string; requests: number }>;
  attendance_trend: Array<{ date: string; present: number; late: number; absent: number }>;
  by_position: Array<{ position: string; count: number }>;
}

/** Compact Home card for members who head a department. */
export interface TeamSnapshot {
  departments: string[];
  headcount: number;
  today: DepartmentTodayCounts;
  pending_approvals: number;
}

/** One share row: count and percent of the active workforce. */
export interface InsightShare {
  label: string;
  count: number;
  percent: string | number | null;
}

export interface InsightKpi {
  value: string | number;
  previous?: string | number;
  change_percent?: string | number | null;
}

/** `GET /home/insights/`: each section is null when the caller cannot see it. */
export interface InsightsPayload {
  currency: string;
  executive_title: string;
  range_months: number;
  range_start: string;
  range_end: string;
  access: Record<"workforce" | "payroll" | "finance" | "recruitment" | "leave" | "attendance" | "operations", boolean>;
  workforce: {
    as_of: string;
    total_employees: number;
    demographics: { gender: InsightShare[]; age_range: InsightShare[]; employment_status: InsightShare[] };
    by_department: InsightShare[];
    by_location: InsightShare[];
    age_distribution: InsightShare[];
    tenure_distribution: InsightShare[];
    headcount_trend: Array<{ month: string; headcount: number }>;
  } | null;
  kpis: {
    employees: InsightKpi | null;
    payroll: InsightKpi | null;
    revenue: (InsightKpi & { cash_balance: string | number }) | null;
    /** Posted income from 1 January against the same span last year. */
    revenue_ytd: (InsightKpi & { cash_balance: string | number; year_start: string }) | null;
    alerts: { value: number; breakdown: Array<{ code: string; label: string; count: number }> } | null;
    /** Share of compliance checks passed; `change_points` is the change in percentage points. */
    compliance: { value: string | number | null; previous: string | number | null; change_points: string | number | null; checks: Array<{ code: string; label: string; passed: number; total: number }> } | null;
  };
  revenue_by_source: Array<{ label: string; amount: string | number; percent: string | number | null }> | null;
  module_trend: { months: string[]; series: Array<{ code: string; label: string; unit: string; values: number[] }> } | null;
  leave_attendance: Array<{ month: string; leave_days: string | number | null; attendance_rate: string | number | null }> | null;
}
