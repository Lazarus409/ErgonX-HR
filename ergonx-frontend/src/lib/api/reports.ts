import { apiGet } from "./client";

export type ReportName = "workforce-cost" | "recruitment" | "leave" | "attendance" | "payroll" | "accounting" | "ap-ar" | "expenses";
export interface ReportFilters { status?: string; date_from?: string; date_to?: string }
export interface ReportResult { report: string; group?: string[]; rows: Array<Record<string, string | number | null>>; }

/**
 * The summary columns that identify a row, in order; mirrors GROUP_FIELDS in
 * apps/reports/services.py. Opening a row sends these values as `group`.
 */
export const REPORT_GROUP_FIELDS: Record<ReportName, string[]> = {
  "workforce-cost": ["status"],
  leave: ["status"],
  attendance: ["status"],
  payroll: ["payroll_run__status"],
  accounting: ["source", "status"],
  "ap-ar": ["area"],
  expenses: ["status"],
  recruitment: ["status"],
};

/** Report URL, with `group=` repeated once per value (axios would send `group[]=`). */
export function reportPath(name: ReportName, group?: string[]): string {
  const query = new URLSearchParams();
  for (const value of group ?? []) query.append("group", value);
  const search = query.toString();
  return `/reports/${name}/${search ? `?${search}` : ""}`;
}

export function getReport(name: ReportName, filters: ReportFilters = {}): Promise<ReportResult> {
  return apiGet<ReportResult>(reportPath(name), { params: filters });
}

/** The records counted in one summary row, e.g. the employees marked ABSENT. */
export function getReportDetails(name: ReportName, group: string[], filters: ReportFilters = {}): Promise<ReportResult> {
  return apiGet<ReportResult>(reportPath(name, group), { params: filters });
}
