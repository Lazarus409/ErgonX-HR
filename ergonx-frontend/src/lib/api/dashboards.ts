/**
 * Dashboard service.
 *
 * The backend exposes plural `/dashboards/<name>/` routes. The older singular
 * paths (`/dashboard/executive/`, `/payroll/dashboard/`, ...) do not exist.
 * The accounting screen reads the `finance` rollup; there is no
 * `/accounting/dashboard/` endpoint.
 *
 * Each route requires the `dashboard.<name>.view` permission.
 */

import { apiGet } from "./client";
import type {
  AttendanceDashboard,
  DepartmentDashboard,
  ExecutiveDashboard,
  FinanceDashboard,
  HrDashboard,
  LeaveDashboard,
  PayrollDashboard,
  RecruitmentDashboard,
} from "@/types/dashboards";

export async function getExecutiveDashboard(): Promise<ExecutiveDashboard> {
  return apiGet<ExecutiveDashboard>("/dashboards/executive/");
}

/** Roster, today's attendance and leave for the departments the user heads. */
export async function getDepartmentDashboard(): Promise<DepartmentDashboard> {
  return apiGet<DepartmentDashboard>("/dashboards/department/");
}

export async function getHrDashboard(): Promise<HrDashboard> {
  return apiGet<HrDashboard>("/dashboards/hr/");
}

/** `months` selects the "Last N months" range (3, 6 or 12; backend default 6). */
export async function getLeaveDashboard(months?: 3 | 6 | 12): Promise<LeaveDashboard> {
  return apiGet<LeaveDashboard>(months ? `/dashboards/leave/?months=${months}` : "/dashboards/leave/");
}

/** `months` selects the "Last N months" range (3, 6 or 12; backend default 12). */
export async function getAttendanceDashboard(months?: 3 | 6 | 12): Promise<AttendanceDashboard> {
  return apiGet<AttendanceDashboard>(months ? `/dashboards/attendance/?months=${months}` : "/dashboards/attendance/");
}

export async function getPayrollDashboard(): Promise<PayrollDashboard> {
  return apiGet<PayrollDashboard>("/dashboards/payroll/");
}

/** `months` selects the "Last N months" range for the pipeline board (3, 6 or 12; backend default 12). */
export async function getRecruitmentDashboard(months?: 3 | 6 | 12): Promise<RecruitmentDashboard> {
  return apiGet<RecruitmentDashboard>(months ? `/dashboards/recruitment/?months=${months}` : "/dashboards/recruitment/");
}

/** Used by the accounting dashboard screen. */
/** `months` selects the "Last N months" cash-flow range (3, 6 or 12). */
export async function getFinanceDashboard(months?: 3 | 6 | 12): Promise<FinanceDashboard> {
  if (months) return apiGet<FinanceDashboard>(`/dashboards/finance/?months=${months}`);
  return apiGet<FinanceDashboard>("/dashboards/finance/");
}
