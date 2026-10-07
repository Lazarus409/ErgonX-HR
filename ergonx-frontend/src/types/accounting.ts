export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
export type NormalBalance = "DEBIT" | "CREDIT";

export interface Account {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent: string | null;
  normal_balance: NormalBalance;
  is_postable: boolean;
  is_active: boolean;
  /** Durable system role (CASH, EMPLOYEE_PAYABLE, ...); posting resolves accounts by it. */
  system_mapping_code?: string | null;
  created_at: string;
  updated_at: string;
}

export interface JournalLine {
  id: string;
  account: string;
  account_code?: string;
  account_name?: string;
  department_name?: string | null;
  description: string;
  debit: string;
  credit: string;
  department: string | null;
  location: string | null;
  employee: string | null;
  cost_centre: string;
  project: string;
  fund: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface JournalEntry {
  id: string;
  journal_number: string;
  accounting_period: string;
  period_name?: string;
  created_by_name?: string | null;
  approved_by_name?: string | null;
  posted_by_name?: string | null;
  total_debit?: string;
  total_credit?: string;
  entry_date: string;
  description: string;
  source: string;
  reference: string;
  status: string;
  created_by: string;
  approved_by: string | null;
  posted_by: string | null;
  posted_at: string | null;
  reversal_of: string | null;
  lines: JournalLine[];
  created_at: string;
  updated_at: string;
}

export interface AccountingPeriod {
  id: string;
  fiscal_year: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vendor { id: string; name: string; vendor_code: string; email: string; phone: string; address: string; country_code: string; tax_identification_number: string; tax_residency: string; taxpayer_type: string; vat_registered: boolean; withholding_category: string; statutory_profile_metadata: Record<string, unknown>; is_active: boolean; created_at: string; updated_at: string; }
export interface VendorBillLine {
  id: string;
  description: string;
  expense_account: string;
  quantity: string;
  unit_price: string;
  tax_code: string | null;
  withholding_rule: string | null;
  line_total: string;
  created_at: string;
  updated_at: string;
}

export interface VendorBill {
  id: string; vendor: string; bill_number: string; bill_date: string; due_date: string | null; currency: string; subtotal: string; tax_total: string; withholding_total: string; total_amount: string; amount_payable: string; status: string; accounting_period: string; journal_entry: string | null; lines: VendorBillLine[]; created_at: string; updated_at: string;
  vendor_name?: string; vendor_code?: string; amount_paid?: string;
  submitted_by_name?: string | null; submitted_at?: string | null; approved_by_name?: string | null; approved_at?: string | null;
  rejected_by_name?: string | null; rejected_at?: string | null; rejection_reason?: string;
  on_hold?: boolean; hold_reason?: string; scheduled_payment_date?: string | null; scheduled_payment_method?: string;
}

export interface PayablesSummary {
  range_months: number;
  range_start: string;
  counts: Record<"all" | "pending" | "approved" | "rejected" | "paid" | "on_hold", number>;
  approval_queue: Array<{ id: string; vendor: string; bill_number: string; amount: string; currency: string; submitted_at: string | null; submitted_by: string | null; on_hold: boolean }>;
  approval_queue_total: number;
  active_vendors: number;
  total_bills: number;
  payments_made: number | null;
  payments_amount: string | null;
  amounts_restricted: boolean;
}

export interface RecordAttachment { id: string; original_filename: string; content_type: string; size_bytes: number; created_at: string }
export interface RecordAuditEntry { id: string; action: string; actor: string; created_at: string; metadata: Record<string, unknown> }

export interface VendorBillContext {
  attachments: RecordAttachment[];
  audit: RecordAuditEntry[];
  payments: Array<{ id: string; payment_number: string; payment_date: string; amount: string; currency: string; payment_method: string; status: string }>;
  related: Array<{ type: string; reference: string; status: string; href: string | null }>;
  vendor: { id: string; name: string; code: string; email: string; phone: string; address: string; tax_identification_number: string };
  institution: { name: string };
}
export interface Customer { id: string; customer_code: string; name: string; email: string; phone: string; address: string; country_code: string; tax_identification_number: string; tax_residency: string; taxpayer_type: string; vat_registered: boolean; withholding_category: string; statutory_profile_metadata: Record<string, unknown>; is_active: boolean; created_at: string; updated_at: string; }
export interface InvoiceLine {
  id: string;
  description: string;
  income_account: string;
  quantity: string;
  unit_price: string;
  tax_code: string | null;
  line_total: string;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string; customer: string; invoice_number: string; invoice_date: string; due_date: string | null; currency: string; subtotal: string; tax_total: string; total_amount: string; status: string; accounting_period: string; journal_entry: string | null; external_tax_reference: string | null; lines: InvoiceLine[]; created_at: string; updated_at: string;
  customer_name?: string; customer_code?: string; amount_received?: string; amount_due?: string; on_hold?: boolean; hold_reason?: string; sent_at?: string | null; sent_to?: string; notes?: string;
}

export interface InvoiceReminder { id: string; remind_on: string; channel: string; note: string; status: string; created_by: string; completed_at: string | null }

export interface ReceivablesSummary {
  range_months: number;
  range_start: string;
  outstanding: { count: number; amount: string | null };
  due_this_week: { count: number; amount: string | null };
  overdue: { count: number; amount: string | null };
  exceptions: { count: number; on_hold: number; over_60_days: number };
  counts: Record<"all" | "outstanding" | "overdue" | "paid" | "on_hold" | "drafts", number>;
  upcoming_receipts: Array<{ id: string; customer: string; invoice_number: string; due_date: string; amount_due: string | null; currency: string }>;
  amounts_restricted: boolean;
  today: string;
}

export interface InvoiceContext {
  attachments: RecordAttachment[];
  audit: RecordAuditEntry[];
  receipts: Array<{ id: string; receipt_number: string; receipt_date: string; amount: string; currency: string; payment_method: string; status: string }>;
  reminders: InvoiceReminder[];
  related: Array<{ type: string; reference: string; status: string; href: string | null }>;
  collection: { days_outstanding: number | null; days_overdue: number };
  customer: { id: string; name: string; code: string; email: string; phone: string; address: string; tax_identification_number: string };
  institution: { name: string };
}
export interface BankAccount { id: string; name: string; bank_name: string; masked_account_number: string; currency: string; ledger_account: string; is_active: boolean; created_at: string; updated_at: string; }
export interface Expense { id: string; expense_date: string; account: string; amount: string; currency: string; description: string; attachment: string | null; status: string; created_by: string; approved_by: string | null; journal_entry: string | null; created_at: string; updated_at: string; }
export interface Payment { id: string; payment_number: string; payment_date: string; amount: string; currency: string; payment_method: string; bank_account: string | null; vendor_bill: string; journal_entry: string | null; status: string; created_at: string; updated_at: string; }
export interface Receipt { id: string; receipt_number: string; receipt_date: string; amount: string; currency: string; payment_method: string; bank_account: string | null; invoice: string; journal_entry: string | null; status: string; created_at: string; updated_at: string; }
export interface BankStatementLine { id: string; bank_account: string; statement_date: string; external_id: string; reference: string; description: string; amount: string; currency: string; journal_entry: string | null; status: string; reconciled_by: string | null; reconciled_at: string | null; created_at: string; updated_at: string; }
export interface TrialBalanceRow { account_id: string; code: string; name: string; account_type: string; normal_balance: string; debit: string; credit: string; }
export interface TrialBalance { rows: TrialBalanceRow[]; total_debit: string; total_credit: string; balanced: boolean; }
export interface IncomeStatement { income: TrialBalanceRow[]; expenses: TrialBalanceRow[]; total_income: string; total_expenses: string; net_income: string; }
export interface BalanceSheet { assets: TrialBalanceRow[]; liabilities: TrialBalanceRow[]; equity: TrialBalanceRow[]; total_assets: string; total_liabilities: string; retained_result: string; total_equity: string; balanced: boolean; }
export interface AccountingSetupChoice { mode: string; preset_version_id: string | null; preset_code: string | null; version_code: string | null; name: string; institution_type?: string; reporting_framework: string | null; coa_templates?: Array<{ id: string; name: string }>; compliance_warning?: string; }
export interface AccountingSetupChoices { country_code: string; currency: string; choices: AccountingSetupChoice[]; }
export interface AccountingConfiguration { id: string; country_code: string; base_currency: string; accounting_setup_mode: string; selected_accounting_preset_version: string | null; reporting_framework: string; tax_identification_number: string; vat_registered: boolean; is_vat_withholding_agent: boolean; statutory_profile_metadata: Record<string, unknown>; fiscal_year_start_month: number; is_configured: boolean; }
export type AccountingConfigurationPayload = Pick<AccountingConfiguration, "country_code" | "base_currency" | "accounting_setup_mode" | "selected_accounting_preset_version" | "reporting_framework" | "tax_identification_number" | "vat_registered" | "is_vat_withholding_agent" | "statutory_profile_metadata" | "fiscal_year_start_month" | "is_configured">;
export interface AccountingPresetApplicationResult { configuration: AccountingConfiguration; coa_template: { id: string; name: string }; created_count: number; reused_count: number; accounts: Account[]; }
/** Read-only statutory catalogue records attached to an applied accounting preset. */
export interface TaxCode { id: string; preset_version: string; code: string; name: string; tax_treatment: string; effective_from: string; effective_to: string | null; is_active: boolean; }
export interface TaxComponent { id: string; tax_code: string; code: string; name: string; rate: string; input_account_mapping_code: string | null; output_account_mapping_code: string | null; sequence: number; }
export interface WithholdingRule { id: string; preset_version: string; code: string; name: string; residency: string; transaction_category: string; rate: string; threshold: string | null; effective_from: string; effective_to: string | null; is_vat_withholding_rule: boolean; requires_confirmation: boolean; }
export interface GhanaComplianceReminder { id: string; institution: string; code: string; title: string; authority: string; due_date: string; statutory_reference: string; status: "OPEN" | "COMPLETED" | "WAIVED"; completed_by: string | null; completed_at: string | null; notes: string; created_at: string; updated_at: string; }
export interface PayrollAccountMappingTemplate { id: string; accounting_preset_version: string; payroll_component_code: string; debit_account_mapping_code: string | null; credit_account_mapping_code: string | null; description: string; }
export interface PayComponentAccountMapping { id: string; institution: string; pay_component: string; debit_account: string | null; credit_account: string | null; effective_from: string; effective_to: string | null; is_active: boolean; }
export type PayComponentAccountMappingPayload = Pick<PayComponentAccountMapping, "pay_component" | "debit_account" | "credit_account" | "effective_from" | "effective_to" | "is_active">;

export interface AccountActivityLine {
  id: string;
  journal_entry_id: string;
  journal_number: string;
  entry_date: string;
  reference: string;
  description: string;
  debit: string;
  credit: string;
  running_balance: string | null;
  status: string;
  source: string;
}

export interface AccountActivity {
  account: { id: string; code: string; name: string; account_type: string; normal_balance: string; is_postable: boolean; is_active: boolean; parent: string | null; parent_name: string | null };
  balance: string;
  opening_balance: string;
  closing_balance: string;
  period_debits: string;
  period_credits: string;
  unposted_lines: number;
  monthly: Array<{ month: string; debit: string; credit: string }>;
  lines: AccountActivityLine[];
}

export interface JournalContext {
  related: Array<{ type: string; id: string; reference: string; status: string; href: string | null }>;
  notes: Array<{ id: string; author: string; body: string; created_at: string }>;
  attachments: Array<{ id: string; original_filename: string; content_type: string; size_bytes: number; created_at: string }>;
  audit: Array<{ id: string; action: string; actor: string; created_at: string; metadata: Record<string, unknown> }>;
  requires_approval: boolean;
}

export interface ReconciliationAccount {
  id: string; name: string; bank_name: string; masked_account_number: string; currency: string;
  state: "NOT_STARTED" | "IN_PROGRESS" | "RECONCILED" | "OVERDUE"; unmatched_lines: number;
  latest_session: { id: string; period_start: string; period_end: string; status: string } | null;
}

export interface ReconciliationLine {
  id: string; statement_date: string; description: string; reference: string; amount: string; currency: string; type: string; status: string;
  journal_entry: string | null; journal_number: string | null; suggestion_count: number; exception_note: string;
}

export interface ReconciliationDetail {
  session: { id: string; bank_account: string; bank_account_name: string; period_start: string; period_end: string; statement_opening_balance: string | null; statement_closing_balance: string | null; status: string; completed_at: string | null; last_imported_at: string | null; created_at: string; updated_at: string };
  bank_account: { id: string; name: string; bank_name: string; masked_account_number: string; currency: string };
  institution: { name: string };
  started_by: string; completed_by: string | null; last_imported_by: string | null;
  counts: { all: number; matched: number; unmatched: number; exceptions: number };
  progress: number; matched_amount: string; unmatched_amount: string; book_balance: string; difference: string | null; can_complete: boolean;
  lines: ReconciliationLine[];
  import_result?: { created: number; skipped: number; errors: string[] };
}

export interface ReconciliationSuggestion { id: string; journal_number: string; entry_date: string; description: string; source: string }

export const BUDGET_CATEGORIES: Array<[string, string]> = [["PERSONNEL", "Personnel"], ["OPERATING", "Operating expenses"], ["SUPPLIES", "Supplies & materials"], ["TRAVEL", "Travel"], ["CAPITAL", "Capital equipment"], ["TRANSFERS", "Transfers"], ["OTHER", "Other"]];
export const BUDGET_TYPES: Array<[string, string]> = [["OPERATING", "Operating"], ["CAPITAL", "Capital"], ["PROJECT", "Project"]];

export interface BudgetLineRecord { id?: string; category: string; account: string | null; account_code?: string | null; account_name?: string | null; description: string; initiative: string; allocated: string }
export interface BudgetTotals { allocated: string; committed: string; actual: string; remaining: string; variance: string; health?: string }

export interface BudgetRecord {
  id: string; code: string; name: string; fiscal_year: string; fiscal_year_name: string; period_start: string; period_end: string;
  department: string | null; department_name: string | null; budget_type: string; owner: string | null; owner_name: string | null;
  description: string; status: string; version: number; lines: BudgetLineRecord[]; totals: BudgetTotals; approval_note: string;
  submitted_at: string | null; approved_at: string | null; created_at: string; updated_at: string;
}

export type BudgetPayload = Pick<BudgetRecord, "name" | "fiscal_year" | "department" | "budget_type" | "owner" | "description"> & { lines: Array<Omit<BudgetLineRecord, "id" | "account_code" | "account_name">> };

export interface BudgetOverview {
  fiscal_years: Array<{ id: string; name: string; start_date: string; end_date: string }>;
  fiscal_year: string | null;
  folders: Array<{ id: string | null; name: string; count: number }>;
  total_budgets: number;
  categories: Array<{ category: string; label: string; allocated: string; committed: string; actual: string; variance: string; status: string }>;
  initiatives: Array<{ initiative: string; allocated: string; actual: string; committed: string; budgets: string[] }>;
  comparisons: Array<{ department: string; department_id: string | null; allocated: string; actual: string; committed: string; budgets: number }>;
  budgets: Array<{ id: string; code: string; name: string; department: string; status: string; budget_type: string } & BudgetTotals>;
  pending_approvals: Array<{ id: string; name: string; submitted_at: string | null }>;
}

export interface BudgetDetail {
  budget: BudgetRecord;
  totals: BudgetTotals;
  health: string;
  categories: Array<{ category: string; label: string; allocated: string; committed: string; actual: string; remaining: string; variance: string; percent_of_budget: string; lines: Array<{ id: string; description: string; initiative: string; account: string | null; allocated: string; committed: string; actual: string; remaining: string; variance: string }> }>;
  initiatives: Array<{ initiative: string; allocated: string; actual: string; committed: string }>;
  notes: Array<{ id: string; author: string; body: string; created_at: string }>;
  attachments: RecordAttachment[];
  people: { created_by: string | null; submitted_by: string | null; submitted_by_id: string | null; approved_by: string | null };
  audit: RecordAuditEntry[];
}

export const REPORT_TYPES: Array<[string, string]> = [["BALANCE_SHEET", "Statement of financial position"], ["INCOME_STATEMENT", "Income statement"], ["TRIAL_BALANCE", "Trial balance"], ["AR_AGING", "Receivables aging"], ["AP_AGING", "Payables aging"], ["BUDGET_VS_ACTUAL", "Budget vs actual"]];
export const REPORT_CATEGORIES: Array<[string, string]> = [["STANDARD", "Standard reports"], ["MANAGEMENT", "Management reports"], ["COMPLIANCE", "Compliance reports"], ["AUDIT", "Audit reports"], ["END_OF_PERIOD", "End of period"], ["CUSTOM", "Custom reports"]];
export const REPORT_FREQUENCIES: Array<[string, string]> = [["NONE", "Not scheduled"], ["MONTHLY", "Monthly"], ["QUARTERLY", "Quarterly"], ["YEARLY", "Yearly"]];

export interface SavedReport {
  id: string; code: string; name: string; report_type: string; report_type_label: string; category: string; category_label: string; description: string;
  parameters: Record<string, string | boolean>; owner: string | null; owner_name: string | null; allowed_roles: string[]; is_standard: boolean;
  schedule_frequency: string; next_run_on: string | null; notes: string; status: string; last_run_at: string | null; created_at: string; updated_at: string;
}

export interface ReportResultRow { code: string; label: string; current: string; comparative: string | null; buckets?: Record<string, string> }
export interface ReportResult {
  title: string; subtitle: string; columns: string[]; bucket_columns?: string[];
  sections: Array<{ title: string; rows: ReportResultRow[]; total: string; total_comparative: string | null; bucket_totals?: Record<string, string> }>;
  totals: Array<{ label: string; current: string; comparative: string | null }>;
  summary: Array<{ label: string; value: string }>;
  checks: Record<string, boolean>;
}
export interface ReportRun { id: string; version: number; status: string; parameters: Record<string, string | boolean>; result: ReportResult; error: string; run_by: string | null; created_at: string; scheduled: boolean }
export interface ReportRuns {
  versions: Array<{ id: string; version: number; status: string; created_at: string; run_by: string | null; scheduled: boolean }>;
  run: ReportRun | null;
  audit: RecordAuditEntry[];
  institution: { name: string; currency: string };
  roles: string[];
}

/** Governed bulk actions (concept "Bulk actions and batch governance"). */
export type BulkOperationGroup = "safe" | "workflow" | "restricted";
export interface BulkOperationPreview {
  code: string;
  label: string;
  description: string;
  group: BulkOperationGroup;
  needs_reason: boolean;
  confirm_text: string;
  available: boolean;
  unavailable_reason: string;
  eligible: string[];
  ineligible: Array<{ id: string; reference: string; reason: string }>;
  eligible_amount: string;
}
export interface BulkPreview { resource: string; count: number; total_amount: string; currencies: string[]; operations: BulkOperationPreview[] }
export interface BatchJob {
  id: string;
  resource: string;
  operation: string;
  operation_label: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
  reason: string;
  total_items: number;
  succeeded: number;
  failed: number;
  total_amount: string;
  results: Array<{ id: string; reference: string; status: "succeeded" | "failed"; message: string }>;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
