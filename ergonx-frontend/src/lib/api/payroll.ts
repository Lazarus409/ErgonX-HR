/** Payroll runs and periods. Workflow statuses change only through actions. */

import { apiAction, apiDelete, apiGet, apiGetList, apiPatch, apiPost } from "./client";
import type { ListParams, PaginatedData } from "@/types/api";
import type {
  PayrollComplianceDeadline,
  PayrollRunActivity,
  PayrollRunException,
  EmployeePayrollProfile,
  PayrollPeriod,
  Payslip,
  PayrollConfiguration,
  PayrollSetupChoices,
  ContributionRule,
  StatutoryThreshold,
  PayComponent,
  PayrollAdjustment,
  PayrollRecord,
  PayrollReconciliation,
  PayrollRun,
  PayrollRunFilters,
  SalaryStructure,
  SalaryStructureComponent,
} from "@/types/payroll";
import type { JournalEntry } from "@/types/accounting";

export async function listPayrollPeriods(
  params?: ListParams & {
    status?: string;
    start_date?: string;
    end_date?: string;
    pay_date?: string;
  },
): Promise<PaginatedData<PayrollPeriod>> {
  return apiGetList<PayrollPeriod>("/payroll-periods/", params);
}

export async function listPayrollConfigurations(): Promise<PaginatedData<PayrollConfiguration>> { return apiGetList<PayrollConfiguration>("/payroll-configurations/"); }
export async function getPayrollSetupChoices(): Promise<PayrollSetupChoices> { return apiGet<PayrollSetupChoices>("/payroll-configurations/choices/"); }
export async function createPayrollConfiguration(payload: Omit<PayrollConfiguration, "id" | "configured_at">): Promise<PayrollConfiguration> { return apiPost<PayrollConfiguration, typeof payload>("/payroll-configurations/", payload); }
export async function updatePayrollConfiguration(id: string, payload: Partial<Omit<PayrollConfiguration, "id" | "configured_at">>): Promise<PayrollConfiguration> { return apiPatch<PayrollConfiguration, typeof payload>(`/payroll-configurations/${id}/`, payload); }
export async function listContributionRules(params?: ListParams & { preset_version?: string }): Promise<PaginatedData<ContributionRule>> { return apiGetList<ContributionRule>("/contribution-rules/", params); }
export async function listStatutoryThresholds(params?: ListParams & { preset_version?: string }): Promise<PaginatedData<StatutoryThreshold>> { return apiGetList<StatutoryThreshold>("/statutory-thresholds/", params); }
export type EmployeePayrollProfilePayload = Pick<EmployeePayrollProfile, "employee" | "tax_residency" | "tax_identification_number">;
export async function listEmployeePayrollProfiles(params?: ListParams & { employee?: string; tax_residency?: string }): Promise<PaginatedData<EmployeePayrollProfile>> { return apiGetList<EmployeePayrollProfile>("/employee-payroll-profiles/", params); }
export async function createEmployeePayrollProfile(payload: EmployeePayrollProfilePayload): Promise<EmployeePayrollProfile> { return apiPost<EmployeePayrollProfile, EmployeePayrollProfilePayload>("/employee-payroll-profiles/", payload); }
export async function updateEmployeePayrollProfile(id: string, payload: Partial<EmployeePayrollProfilePayload>): Promise<EmployeePayrollProfile> { return apiPatch<EmployeePayrollProfile, Partial<EmployeePayrollProfilePayload>>(`/employee-payroll-profiles/${id}/`, payload); }

/** Start the payroll run for an open period. The key makes a double-click harmless. */
export async function createPayrollRun(payrollPeriod: string, idempotencyKey: string): Promise<PayrollRun> {
  return apiPost<PayrollRun, { payroll_period: string; idempotency_key: string }>("/payroll-runs/", { payroll_period: payrollPeriod, idempotency_key: idempotencyKey });
}

export async function createPayrollPeriod(payload: {
  name: string;
  start_date: string;
  end_date: string;
  pay_date: string;
}): Promise<PayrollPeriod> {
  return apiPost<PayrollPeriod, typeof payload>("/payroll-periods/", payload);
}

export async function listPayrollRuns(
  params?: ListParams & PayrollRunFilters,
): Promise<PaginatedData<PayrollRun>> {
  return apiGetList<PayrollRun>("/payroll-runs/", params);
}

export async function getPayrollRun(id: string): Promise<PayrollRun> {
  return apiGet<PayrollRun>(`/payroll-runs/${id}/`);
}

export async function getPayrollPeriod(id: string): Promise<PayrollPeriod> {
  return apiGet<PayrollPeriod>(`/payroll-periods/${id}/`);
}

export async function listPayrollRecords(params?: ListParams & {
  payroll_run?: string;
}): Promise<PaginatedData<PayrollRecord>> {
  return apiGetList<PayrollRecord>("/payroll-records/", params);
}

export async function getPayrollRecord(id: string): Promise<PayrollRecord> {
  return apiGet<PayrollRecord>(`/payroll-records/${id}/`);
}

export async function listPayslips(params?: ListParams & { payroll_record?: string; payroll_record__employee?: string; generated_at?: string }): Promise<PaginatedData<Payslip>> {
  return apiGetList<Payslip>("/payslips/", params);
}

export async function getPayslip(id: string): Promise<Payslip> {
  return apiGet<Payslip>(`/payslips/${id}/`);
}

/** Re-runs exception detection on a calculated or in-review run. */
export async function validatePayrollRun(id: string): Promise<PayrollRun> {
  return apiPost<PayrollRun, Record<string, never>>(`/payroll-runs/${id}/validate/`, {});
}

export async function listPayrollRunExceptions(id: string): Promise<PayrollRunException[]> {
  return apiGet<PayrollRunException[]>(`/payroll-runs/${id}/exceptions/`);
}

/** Acknowledge (medium/low), resolve or reopen an exception; a note is required unless reopening. */
export async function updatePayrollRunException(runId: string, exceptionId: string, status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED", note = ""): Promise<PayrollRunException> {
  return apiPost<PayrollRunException, { status: string; note: string }>(`/payroll-runs/${runId}/exceptions/${exceptionId}/`, { status, note });
}

export async function listPayrollRunActivity(id: string): Promise<PayrollRunActivity[]> {
  return apiGet<PayrollRunActivity[]>(`/payroll-runs/${id}/activity/`);
}

export async function getPayrollPeriodComplianceDeadlines(periodId: string): Promise<PayrollComplianceDeadline[]> {
  return apiGet<PayrollComplianceDeadline[]>(`/payroll-periods/${periodId}/compliance-deadlines/`);
}

export async function getPayrollRunReconciliation(
  id: string,
): Promise<PayrollReconciliation> {
  return apiGet<PayrollReconciliation>(`/payroll-runs/${id}/reconcile/`);
}

export type PayComponentPayload = Pick<PayComponent, "name" | "code" | "component_type" | "calculation_type" | "taxable" | "pensionable" | "cash_or_kind" | "recurring" | "is_active">;
export async function listPayComponents(params?: ListParams & { component_type?: string; calculation_type?: string; taxable?: boolean; pensionable?: boolean; recurring?: boolean; is_active?: boolean }): Promise<PaginatedData<PayComponent>> { return apiGetList<PayComponent>("/pay-components/", params); }
export async function createPayComponent(payload: PayComponentPayload): Promise<PayComponent> { return apiPost<PayComponent, PayComponentPayload>("/pay-components/", payload); }
export async function updatePayComponent(id: string, payload: Partial<PayComponentPayload>): Promise<PayComponent> { return apiPatch<PayComponent, Partial<PayComponentPayload>>(`/pay-components/${id}/`, payload); }
export async function deletePayComponent(id: string): Promise<void> { return apiDelete(`/pay-components/${id}/`); }
export type SalaryStructurePayload = Pick<SalaryStructure, "name" | "code" | "description" | "is_active">;
export async function listSalaryStructures(params?: ListParams & { is_active?: boolean }): Promise<PaginatedData<SalaryStructure>> { return apiGetList<SalaryStructure>("/salary-structures/", params); }
export async function createSalaryStructure(payload: SalaryStructurePayload): Promise<SalaryStructure> { return apiPost<SalaryStructure, SalaryStructurePayload>("/salary-structures/", payload); }
export async function updateSalaryStructure(id: string, payload: Partial<SalaryStructurePayload>): Promise<SalaryStructure> { return apiPatch<SalaryStructure, Partial<SalaryStructurePayload>>(`/salary-structures/${id}/`, payload); }
export async function deleteSalaryStructure(id: string): Promise<void> { return apiDelete(`/salary-structures/${id}/`); }
export type SalaryStructureComponentPayload = Pick<SalaryStructureComponent, "salary_structure" | "pay_component" | "default_amount" | "default_percentage" | "percentage_base_component" | "sequence" | "is_required">;
export async function listSalaryStructureComponents(params?: ListParams & { salary_structure?: string; pay_component?: string; is_required?: boolean }): Promise<PaginatedData<SalaryStructureComponent>> { return apiGetList<SalaryStructureComponent>("/salary-structure-components/", params); }
export async function createSalaryStructureComponent(payload: SalaryStructureComponentPayload): Promise<SalaryStructureComponent> { return apiPost<SalaryStructureComponent, SalaryStructureComponentPayload>("/salary-structure-components/", payload); }
export async function deleteSalaryStructureComponent(id: string): Promise<void> { return apiDelete(`/salary-structure-components/${id}/`); }
export async function listPayrollAdjustments(params?: ListParams & { status?: string }): Promise<PaginatedData<PayrollAdjustment>> { return apiGetList<PayrollAdjustment>("/payroll-adjustments/", params); }
export async function createPayrollAdjustment(payload: { employee: string; payroll_period: string; pay_component: string; amount: string; reason: string }): Promise<PayrollAdjustment> { return apiPost<PayrollAdjustment, typeof payload>("/payroll-adjustments/", payload); }
export async function submitPayrollAdjustment(id: string): Promise<PayrollAdjustment> { return apiAction<PayrollAdjustment>(`/payroll-adjustments/${id}/submit/`); }
export async function approvePayrollAdjustment(id: string): Promise<PayrollAdjustment> { return apiAction<PayrollAdjustment>(`/payroll-adjustments/${id}/approve/`); }
export async function rejectPayrollAdjustment(id: string): Promise<PayrollAdjustment> { return apiAction<PayrollAdjustment>(`/payroll-adjustments/${id}/reject/`); }

export async function calculatePayrollRun(id: string): Promise<PayrollRun> {
  return apiAction<PayrollRun>(`/payroll-runs/${id}/calculate/`);
}

export async function submitPayrollRunForReview(id: string): Promise<PayrollRun> {
  return apiAction<PayrollRun>(`/payroll-runs/${id}/submit-review/`);
}

export async function approvePayrollRun(id: string): Promise<PayrollRun> {
  return apiAction<PayrollRun>(`/payroll-runs/${id}/approve/`);
}

export async function finalizePayrollRun(id: string): Promise<PayrollRun> {
  return apiAction<PayrollRun>(`/payroll-runs/${id}/finalize/`);
}

export async function cancelPayrollRun(id: string): Promise<PayrollRun> {
  return apiAction<PayrollRun>(`/payroll-runs/${id}/cancel/`);
}

/** Creates or returns the idempotent draft accounting journal for a finalized run. */
export async function generatePayrollAccountingJournal(id: string): Promise<JournalEntry> {
  return apiAction<JournalEntry>(
    `/payroll-runs/${id}/generate-accounting-journal/`,
  );
}
