import { apiAction, apiDownload, apiGet, apiGetList, apiPatch, apiPost, apiPostMultipart } from "./client";
import type { ListParams, PaginatedData } from "@/types/api";
import type { BatchJob, BulkPreview, ReportRun, ReportRuns, SavedReport, BudgetDetail, BudgetOverview, BudgetPayload, BudgetRecord, ReconciliationAccount, ReconciliationDetail, ReconciliationSuggestion, InvoiceContext, InvoiceReminder, ReceivablesSummary, PayablesSummary, VendorBillContext, RecordAttachment, AccountActivity, JournalContext, Account, AccountingConfiguration, AccountingConfigurationPayload, AccountingPeriod, AccountingPresetApplicationResult, AccountingSetupChoices, BalanceSheet, BankAccount, BankStatementLine, Customer, Expense, GhanaComplianceReminder, IncomeStatement, Invoice, InvoiceLine, JournalEntry, PayComponentAccountMapping, PayComponentAccountMappingPayload, PayrollAccountMappingTemplate, Payment, Receipt, TaxCode, TaxComponent, TrialBalance, Vendor, VendorBill, VendorBillLine, WithholdingRule } from "@/types/accounting";

export type AccountPayload = Pick<Account, "code" | "name" | "account_type" | "parent" | "normal_balance" | "is_postable" | "is_active"> & { system_mapping_code?: string | null };

export function listAccounts(params?: ListParams & { account_type?: string; normal_balance?: string; parent?: string; is_postable?: boolean; is_active?: boolean }): Promise<PaginatedData<Account>> {
  return apiGetList<Account>("/accounts/", params);
}

export function createAccount(payload: AccountPayload): Promise<Account> {
  return apiPost<Account, AccountPayload>("/accounts/", payload);
}

export function updateAccount(id: string, payload: Partial<AccountPayload>): Promise<Account> {
  return apiPatch<Account, Partial<AccountPayload>>(`/accounts/${id}/`, payload);
}

export function listJournalEntries(params?: ListParams & { accounting_period?: string; entry_date?: string; source?: string; status?: string }): Promise<PaginatedData<JournalEntry>> {
  return apiGetList<JournalEntry>("/journal-entries/", params);
}

export function listAccountingPeriods(params?: ListParams & { status?: string }): Promise<PaginatedData<AccountingPeriod>> {
  return apiGetList<AccountingPeriod>("/accounting-periods/", params);
}
export function closeAccountingPeriod(id: string): Promise<AccountingPeriod> { return apiAction<AccountingPeriod>(`/accounting-periods/${id}/close/`); }
export function lockAccountingPeriod(id: string): Promise<AccountingPeriod> { return apiAction<AccountingPeriod>(`/accounting-periods/${id}/lock/`); }
export function reopenAccountingPeriod(id: string): Promise<AccountingPeriod> { return apiAction<AccountingPeriod>(`/accounting-periods/${id}/reopen/`); }

export type JournalEntryPayload = Pick<JournalEntry, "accounting_period" | "entry_date" | "description" | "reference"> & { lines: Array<Pick<JournalEntry["lines"][number], "account" | "description" | "debit" | "credit">> };
export function createJournalEntry(payload: JournalEntryPayload): Promise<JournalEntry> {
  return apiPost<JournalEntry, JournalEntryPayload>("/journal-entries/", payload);
}

export function getJournalEntry(id: string): Promise<JournalEntry> { return apiGet<JournalEntry>(`/journal-entries/${id}/`); }
export function submitJournalEntry(id: string): Promise<JournalEntry> { return apiAction<JournalEntry>(`/journal-entries/${id}/submit/`); }
export function approveJournalEntry(id: string): Promise<JournalEntry> { return apiAction<JournalEntry>(`/journal-entries/${id}/approve/`); }
export function postJournalEntry(id: string): Promise<JournalEntry> { return apiAction<JournalEntry>(`/journal-entries/${id}/post/`); }
export function voidJournalEntry(id: string): Promise<JournalEntry> { return apiAction<JournalEntry>(`/journal-entries/${id}/void/`); }
export interface JournalReversalPayload {
  accounting_period: string;
  entry_date: string;
  description?: string;
}
export function reverseJournalEntry(id: string, payload: JournalReversalPayload): Promise<JournalEntry> { return apiPost<JournalEntry, JournalReversalPayload>(`/journal-entries/${id}/reverse/`, payload); }
export function listVendors(params?: ListParams & { is_active?: boolean }): Promise<PaginatedData<Vendor>> { return apiGetList<Vendor>("/vendors/", params); }
export function listVendorBills(params?: ListParams & { vendor?: string; status?: string; currency?: string; accounting_period?: string }): Promise<PaginatedData<VendorBill>> { return apiGetList<VendorBill>("/vendor-bills/", params); }
export type VendorBillPayload = Pick<VendorBill, "vendor" | "bill_number" | "bill_date" | "due_date" | "currency" | "accounting_period"> & {
  lines: Array<Pick<VendorBillLine, "description" | "expense_account" | "quantity" | "unit_price">>;
};
export function createVendorBill(payload: VendorBillPayload): Promise<VendorBill> { return apiPost<VendorBill, VendorBillPayload>("/vendor-bills/", payload); }
export function submitVendorBill(id: string): Promise<VendorBill> { return apiAction<VendorBill>(`/vendor-bills/${id}/submit/`); }
export function approveVendorBill(id: string): Promise<VendorBill> { return apiAction<VendorBill>(`/vendor-bills/${id}/approve/`); }
export function postVendorBill(id: string): Promise<VendorBill> { return apiAction<VendorBill>(`/vendor-bills/${id}/post/`); }
export function voidVendorBill(id: string): Promise<VendorBill> { return apiAction<VendorBill>(`/vendor-bills/${id}/void/`); }
export function listCustomers(params?: ListParams & { is_active?: boolean }): Promise<PaginatedData<Customer>> { return apiGetList<Customer>("/customers/", params); }
export function listInvoices(params?: ListParams & { customer?: string; status?: string; currency?: string; accounting_period?: string }): Promise<PaginatedData<Invoice>> { return apiGetList<Invoice>("/invoices/", params); }
export type InvoicePayload = Pick<Invoice, "customer" | "invoice_number" | "invoice_date" | "due_date" | "currency" | "accounting_period" | "external_tax_reference"> & {
  lines: Array<Pick<InvoiceLine, "description" | "income_account" | "quantity" | "unit_price">>;
};
export function createInvoice(payload: InvoicePayload): Promise<Invoice> { return apiPost<Invoice, InvoicePayload>("/invoices/", payload); }
export function issueInvoice(id: string): Promise<Invoice> { return apiAction<Invoice>(`/invoices/${id}/issue/`); }
export function voidInvoice(id: string): Promise<Invoice> { return apiAction<Invoice>(`/invoices/${id}/void/`); }
export function listBankAccounts(params?: ListParams & { is_active?: boolean; currency?: string; ledger_account?: string }): Promise<PaginatedData<BankAccount>> { return apiGetList<BankAccount>("/bank-accounts/", params); }
export type BankAccountPayload = Pick<BankAccount, "name" | "bank_name" | "masked_account_number" | "currency" | "ledger_account" | "is_active">;
export function createBankAccount(payload: BankAccountPayload): Promise<BankAccount> { return apiPost<BankAccount, BankAccountPayload>("/bank-accounts/", payload); }
export function listExpenses(params?: ListParams & { status?: string; currency?: string; account?: string; expense_date?: string }): Promise<PaginatedData<Expense>> { return apiGetList<Expense>("/expenses/", params); }
/** A finance-entered (petty-cash) expense; currency defaults to the base currency. */
export type ExpensePayload = Pick<Expense, "expense_date" | "account" | "amount" | "description"> & { currency?: string; attachment?: string | null };
export function createExpense(payload: ExpensePayload): Promise<Expense> { return apiPost<Expense, ExpensePayload>("/expenses/", payload); }
export function submitExpense(id: string): Promise<Expense> { return apiAction<Expense>(`/expenses/${id}/submit/`); }
export function approveExpense(id: string): Promise<Expense> { return apiAction<Expense>(`/expenses/${id}/approve/`); }
export function rejectExpense(id: string): Promise<Expense> { return apiAction<Expense>(`/expenses/${id}/reject/`); }
export function postExpense(id: string): Promise<Expense> { return apiAction<Expense>(`/expenses/${id}/post/`); }
export function listPayments(params?: ListParams & { status?: string; currency?: string; bank_account?: string; vendor_bill?: string }): Promise<PaginatedData<Payment>> { return apiGetList<Payment>("/payments/", params); }
export function listReceipts(params?: ListParams & { status?: string; currency?: string; bank_account?: string; invoice?: string }): Promise<PaginatedData<Receipt>> { return apiGetList<Receipt>("/receipts/", params); }
export type PaymentPayload = Pick<Payment, "payment_number" | "payment_date" | "amount" | "currency" | "payment_method" | "bank_account" | "vendor_bill">;
export type ReceiptPayload = Pick<Receipt, "receipt_number" | "receipt_date" | "amount" | "currency" | "payment_method" | "bank_account" | "invoice">;
export function createPayment(payload: PaymentPayload): Promise<Payment> { return apiPost<Payment, PaymentPayload>("/payments/", payload); }
export function createReceipt(payload: ReceiptPayload): Promise<Receipt> { return apiPost<Receipt, ReceiptPayload>("/receipts/", payload); }
export function voidPayment(id: string, void_date: string): Promise<Payment> { return apiPost<Payment, { void_date: string }>(`/payments/${id}/void/`, { void_date }); }
export function voidReceipt(id: string, void_date: string): Promise<Receipt> { return apiPost<Receipt, { void_date: string }>(`/receipts/${id}/void/`, { void_date }); }
export type BankStatementLinePayload = Pick<BankStatementLine, "bank_account" | "statement_date" | "external_id" | "reference" | "description" | "amount" | "currency">;
export function listBankStatementLines(params?: ListParams & { bank_account?: string; status?: string; currency?: string; statement_date?: string }): Promise<PaginatedData<BankStatementLine>> { return apiGetList<BankStatementLine>("/bank-statement-lines/", params); }
export function createBankStatementLine(payload: BankStatementLinePayload): Promise<BankStatementLine> { return apiPost<BankStatementLine, BankStatementLinePayload>("/bank-statement-lines/", payload); }
export function matchBankStatementLine(id: string, journal_entry: string): Promise<BankStatementLine> { return apiPost<BankStatementLine, { journal_entry: string }>(`/bank-statement-lines/${id}/match/`, { journal_entry }); }
export function unmatchBankStatementLine(id: string): Promise<BankStatementLine> { return apiAction<BankStatementLine>(`/bank-statement-lines/${id}/unmatch/`); }
export function getTrialBalance(params?: { date_from?: string; date_to?: string }): Promise<TrialBalance> { return apiGet<TrialBalance>("/accounting-reports/trial-balance/", { params }); }
export function getIncomeStatement(params?: { date_from?: string; date_to?: string }): Promise<IncomeStatement> { return apiGet<IncomeStatement>("/accounting-reports/income-statement/", { params }); }
export function getBalanceSheet(params?: { as_of?: string }): Promise<BalanceSheet> { return apiGet<BalanceSheet>("/accounting-reports/balance-sheet/", { params }); }
export function listAccountingConfigurations(): Promise<PaginatedData<AccountingConfiguration>> { return apiGetList<AccountingConfiguration>("/accounting-configurations/"); }
export function getAccountingSetupChoices(): Promise<AccountingSetupChoices> { return apiGet<AccountingSetupChoices>("/accounting-configurations/choices/"); }
export function createAccountingConfiguration(payload: AccountingConfigurationPayload): Promise<AccountingConfiguration> { return apiPost<AccountingConfiguration, AccountingConfigurationPayload>("/accounting-configurations/", payload); }
export function updateAccountingConfiguration(id: string, payload: Partial<AccountingConfigurationPayload>): Promise<AccountingConfiguration> { return apiPatch<AccountingConfiguration, Partial<AccountingConfigurationPayload>>(`/accounting-configurations/${id}/`, payload); }
export function applyAccountingPreset(id: string, payload: { base_currency: string; fiscal_year_start_month: number; coa_template?: string }): Promise<AccountingPresetApplicationResult> { return apiPost<AccountingPresetApplicationResult, typeof payload>(`/accounting-preset-versions/${id}/apply/`, payload); }
export function listTaxCodes(params?: ListParams & { preset_version?: string; is_active?: boolean }): Promise<PaginatedData<TaxCode>> { return apiGetList<TaxCode>("/tax-codes/", params); }
export function listTaxComponents(params?: ListParams & { tax_code?: string }): Promise<PaginatedData<TaxComponent>> { return apiGetList<TaxComponent>("/tax-components/", params); }
export function listWithholdingRules(params?: ListParams & { preset_version?: string; is_vat_withholding_rule?: boolean }): Promise<PaginatedData<WithholdingRule>> { return apiGetList<WithholdingRule>("/withholding-rules/", params); }
export function listGhanaComplianceReminders(params?: ListParams & { status?: GhanaComplianceReminder["status"] }): Promise<PaginatedData<GhanaComplianceReminder>> { return apiGetList<GhanaComplianceReminder>("/ghana-compliance-reminders/", params); }
export function listPayrollAccountMappingTemplates(params?: ListParams & { accounting_preset_version?: string }): Promise<PaginatedData<PayrollAccountMappingTemplate>> { return apiGetList<PayrollAccountMappingTemplate>("/payroll-account-mapping-templates/", params); }
export function listPayComponentAccountMappings(params?: ListParams & { pay_component?: string; is_active?: boolean }): Promise<PaginatedData<PayComponentAccountMapping>> { return apiGetList<PayComponentAccountMapping>("/pay-component-account-mappings/", params); }
export function createPayComponentAccountMapping(payload: PayComponentAccountMappingPayload): Promise<PayComponentAccountMapping> { return apiPost<PayComponentAccountMapping, PayComponentAccountMappingPayload>("/pay-component-account-mappings/", payload); }
export function updatePayComponentAccountMapping(id: string, payload: Partial<PayComponentAccountMappingPayload>): Promise<PayComponentAccountMapping> { return apiPatch<PayComponentAccountMapping, Partial<PayComponentAccountMappingPayload>>(`/pay-component-account-mappings/${id}/`, payload); }
export function applyPayrollAccountMappingTemplates(effective_from: string): Promise<PayComponentAccountMapping[]> { return apiPost<PayComponentAccountMapping[], { effective_from: string }>("/pay-component-account-mappings/apply-templates/", { effective_from }); }

export function getAccountBalances(): Promise<Record<string, string>> { return apiGet<Record<string, string>>("/accounts/balances/"); }
export function getAccountActivity(id: string, params: { date_from?: string; date_to?: string; status?: string; source?: string; search?: string }): Promise<AccountActivity> {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value) as Array<[string, string]>);
  return apiGet<AccountActivity>(`/accounts/${id}/activity/${query.toString() ? `?${query.toString()}` : ""}`);
}
export function getJournalContext(id: string): Promise<JournalContext> { return apiGet<JournalContext>(`/journal-entries/${id}/context/`); }
export function addJournalNote(id: string, body: string): Promise<JournalContext["notes"][number]> { return apiPost<JournalContext["notes"][number], { body: string }>(`/journal-entries/${id}/notes/`, { body }); }
export function uploadJournalAttachment(id: string, file: File, onProgress?: (progress: number) => void): Promise<JournalContext["attachments"][number]> {
  const body = new FormData();
  body.append("uploaded_file", file);
  return apiPostMultipart(`/journal-entries/${id}/attachments/`, body, onProgress);
}
export function downloadJournalAttachment(id: string, documentId: string): Promise<Blob> { return apiDownload(`/journal-entries/${id}/attachments/${documentId}/download/`); }

export function getVendorBill(id: string): Promise<VendorBill> { return apiGet<VendorBill>(`/vendor-bills/${id}/`); }
export function getPayablesSummary(months: 3 | 6 | 12): Promise<PayablesSummary> { return apiGet<PayablesSummary>(`/vendor-bills/summary/?months=${months}`); }
export function previewVendorBillBulk(ids: string[]): Promise<BulkPreview> { return apiPost<BulkPreview, { ids: string[] }>("/vendor-bills/bulk/preview/", { ids }); }
export function executeVendorBillBulk(payload: { ids: string[]; operation: string; reason?: string; confirm_text?: string }): Promise<BatchJob> { return apiPost<BatchJob, typeof payload>("/vendor-bills/bulk/execute/", payload); }
export function listVendorBillBatchJobs(limit = 5): Promise<{ count: number; results: BatchJob[] }> { return apiGet<{ count: number; results: BatchJob[] }>(`/vendor-bills/batch-jobs/?limit=${limit}`); }
export function getVendorBillContext(id: string): Promise<VendorBillContext> { return apiGet<VendorBillContext>(`/vendor-bills/${id}/context/`); }
export function rejectVendorBill(id: string, reason: string): Promise<VendorBill> { return apiPost<VendorBill, { reason: string }>(`/vendor-bills/${id}/reject/`, { reason }); }
export function reviseVendorBill(id: string): Promise<VendorBill> { return apiAction<VendorBill>(`/vendor-bills/${id}/revise/`); }
export function holdVendorBill(id: string, reason: string): Promise<VendorBill> { return apiPost<VendorBill, { reason: string }>(`/vendor-bills/${id}/hold/`, { reason }); }
export function releaseVendorBill(id: string): Promise<VendorBill> { return apiAction<VendorBill>(`/vendor-bills/${id}/release/`); }
export function scheduleVendorBillPayment(id: string, payment_date: string, payment_method: string): Promise<VendorBill> { return apiPost<VendorBill, { payment_date: string; payment_method: string }>(`/vendor-bills/${id}/schedule-payment/`, { payment_date, payment_method }); }
export function uploadRecordAttachment(resource: "vendor-bills" | "invoices" | "budgets", id: string, file: File, onProgress?: (progress: number) => void): Promise<RecordAttachment> {
  const body = new FormData();
  body.append("uploaded_file", file);
  return apiPostMultipart(`/${resource}/${id}/attachments/`, body, onProgress);
}
export function downloadRecordAttachment(resource: "vendor-bills" | "invoices" | "budgets", id: string, documentId: string): Promise<Blob> { return apiDownload(`/${resource}/${id}/attachments/${documentId}/download/`); }

export function getInvoice(id: string): Promise<Invoice> { return apiGet<Invoice>(`/invoices/${id}/`); }
export function getReceivablesSummary(months: 3 | 6 | 12): Promise<ReceivablesSummary> { return apiGet<ReceivablesSummary>(`/invoices/summary/?months=${months}`); }
export function getInvoiceContext(id: string): Promise<InvoiceContext> { return apiGet<InvoiceContext>(`/invoices/${id}/context/`); }
export function holdInvoice(id: string, reason: string): Promise<Invoice> { return apiPost<Invoice, { reason: string }>(`/invoices/${id}/hold/`, { reason }); }
export function releaseInvoice(id: string): Promise<Invoice> { return apiAction<Invoice>(`/invoices/${id}/release/`); }
export function sendInvoice(id: string, email: string): Promise<Invoice & { delivery: string }> { return apiPost<Invoice & { delivery: string }, { email: string }>(`/invoices/${id}/send/`, { email }); }
export function addInvoiceReminder(id: string, payload: { remind_on: string; channel: string; note: string }): Promise<InvoiceReminder[]> { return apiPost<InvoiceReminder[], typeof payload>(`/invoices/${id}/reminders/`, payload); }
export function updateInvoiceReminder(id: string, reminderId: string, status: "DONE" | "CANCELLED"): Promise<InvoiceReminder[]> { return apiPost<InvoiceReminder[], { status: string }>(`/invoices/${id}/reminders/${reminderId}/`, { status }); }
export type CustomerPayload = Pick<Customer, "name" | "email" | "phone" | "address" | "country_code" | "tax_identification_number" | "is_active">;
export function createCustomer(payload: CustomerPayload): Promise<Customer> { return apiPost<Customer, CustomerPayload>("/customers/", payload); }
export function updateCustomer(id: string, payload: Partial<CustomerPayload>): Promise<Customer> { return apiPatch<Customer, Partial<CustomerPayload>>(`/customers/${id}/`, payload); }

export function listReconciliationAccounts(): Promise<ReconciliationAccount[]> { return apiGet<ReconciliationAccount[]>("/bank-reconciliations/accounts/"); }
export function listReconciliationSessions(bankAccount: string): Promise<PaginatedData<ReconciliationDetail["session"]>> { return apiGetList<ReconciliationDetail["session"]>("/bank-reconciliations/", { bank_account: bankAccount, page_size: 100 } as ListParams); }
export function startReconciliation(payload: { bank_account: string; period_start: string; period_end: string; statement_opening_balance?: string; statement_closing_balance?: string }): Promise<ReconciliationDetail> { return apiPost<ReconciliationDetail, typeof payload>("/bank-reconciliations/", payload); }
export function getReconciliation(id: string): Promise<ReconciliationDetail> { return apiGet<ReconciliationDetail>(`/bank-reconciliations/${id}/`); }
export function updateReconciliationBalances(id: string, payload: { statement_opening_balance: string | null; statement_closing_balance: string | null }): Promise<ReconciliationDetail> { return apiPatch<ReconciliationDetail, typeof payload>(`/bank-reconciliations/${id}/`, payload); }
export function completeReconciliation(id: string): Promise<ReconciliationDetail> { return apiAction<ReconciliationDetail>(`/bank-reconciliations/${id}/complete/`); }
export function importReconciliationStatement(id: string, file: File): Promise<ReconciliationDetail> { const body = new FormData(); body.append("file", file); return apiPostMultipart<ReconciliationDetail>(`/bank-reconciliations/${id}/import/`, body); }
export function getReconciliationSuggestions(id: string, lineId: string): Promise<ReconciliationSuggestion[]> { return apiGet<ReconciliationSuggestion[]>(`/bank-reconciliations/${id}/lines/${lineId}/suggestions/`); }
export function reconciliationLineAction(id: string, lineId: string, operation: "match" | "unmatch" | "flag" | "unflag", payload: { journal_entry?: string; note?: string } = {}): Promise<ReconciliationDetail> { return apiPost<ReconciliationDetail, typeof payload>(`/bank-reconciliations/${id}/lines/${lineId}/${operation}/`, payload); }
export function downloadReconciliationReport(id: string): Promise<Blob> { return apiDownload(`/bank-reconciliations/${id}/report/`); }

export function getBudgetOverview(params: { fiscal_year?: string; department?: string }): Promise<BudgetOverview> {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value) as Array<[string, string]>);
  return apiGet<BudgetOverview>(`/budgets/overview/${query.toString() ? `?${query.toString()}` : ""}`);
}
export function getBudget(id: string): Promise<BudgetRecord> { return apiGet<BudgetRecord>(`/budgets/${id}/`); }
export function getBudgetDetail(id: string): Promise<BudgetDetail> { return apiGet<BudgetDetail>(`/budgets/${id}/detail_view/`); }
export function createBudget(payload: BudgetPayload): Promise<BudgetRecord> { return apiPost<BudgetRecord, BudgetPayload>("/budgets/", payload); }
export function updateBudget(id: string, payload: Partial<BudgetPayload>): Promise<BudgetRecord> { return apiPatch<BudgetRecord, Partial<BudgetPayload>>(`/budgets/${id}/`, payload); }
export function submitBudget(id: string): Promise<BudgetRecord> { return apiAction<BudgetRecord>(`/budgets/${id}/submit/`); }
export function approveBudget(id: string, note: string): Promise<BudgetRecord> { return apiPost<BudgetRecord, { note: string }>(`/budgets/${id}/approve/`, { note }); }
export function returnBudget(id: string, note: string): Promise<BudgetRecord> { return apiPost<BudgetRecord, { note: string }>(`/budgets/${id}/return/`, { note }); }
export function addBudgetNote(id: string, body: string): Promise<BudgetDetail["notes"][number]> { return apiPost<BudgetDetail["notes"][number], { body: string }>(`/budgets/${id}/notes/`, { body }); }
export function listFiscalYears(): Promise<PaginatedData<{ id: string; name: string; start_date: string; end_date: string; status: string }>> { return apiGetList("/fiscal-years/", { page_size: 100, ordering: "-start_date" } as ListParams); }
export function getBudgetOptions(): Promise<{ fiscal_years: Array<{ id: string; name: string; start_date: string; end_date: string }>; departments: Array<{ id: string; name: string }>; accounts: Array<{ id: string; code: string; name: string; account_type: string }> }> { return apiGet("/budgets/options/"); }

export type SavedReportPayload = Partial<Pick<SavedReport, "name" | "report_type" | "category" | "description" | "parameters" | "allowed_roles" | "schedule_frequency" | "notes" | "owner">>;
export function listSavedReports(params?: ListParams & { report_type?: string; category?: string }): Promise<PaginatedData<SavedReport>> { return apiGetList<SavedReport>("/financial-reports/", { page_size: 100, ...params } as ListParams); }
export function getSavedReport(id: string): Promise<SavedReport> { return apiGet<SavedReport>(`/financial-reports/${id}/`); }
export function createSavedReport(payload: SavedReportPayload): Promise<SavedReport> { return apiPost<SavedReport, SavedReportPayload>("/financial-reports/", payload); }
export function updateSavedReport(id: string, payload: SavedReportPayload): Promise<SavedReport> { return apiPatch<SavedReport, SavedReportPayload>(`/financial-reports/${id}/`, payload); }
export function runSavedReport(id: string, parameters: Record<string, string | boolean> = {}): Promise<ReportRun> { return apiPost<ReportRun, { parameters: typeof parameters }>(`/financial-reports/${id}/run/`, { parameters }); }
export function getSavedReportRuns(id: string, runId?: string): Promise<ReportRuns> { return apiGet<ReportRuns>(`/financial-reports/${id}/runs/${runId ? `?run=${runId}` : ""}`); }
