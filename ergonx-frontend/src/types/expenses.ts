/** Expense Management 2.0 (Wave 6). */

export type ExpenseStatus = "DRAFT" | "PENDING" | "RETURNED" | "FINANCE_REVIEW" | "APPROVED" | "POSTED" | "SETTLED" | "REJECTED" | "REVERSED";
export type ExpensePaymentMethod = "REIMBURSABLE" | "PETTY_CASH";

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Submitted",
  RETURNED: "Returned for changes",
  FINANCE_REVIEW: "Finance review",
  APPROVED: "Approved",
  POSTED: "Posted",
  SETTLED: "Settled",
  REJECTED: "Rejected",
  REVERSED: "Reversed",
};

/** The locked lifecycle, in order, for the progress tracker. */
export const EXPENSE_STAGES: Array<{ status: ExpenseStatus; label: string }> = [
  { status: "DRAFT", label: "Draft" },
  { status: "PENDING", label: "Manager" },
  { status: "FINANCE_REVIEW", label: "Finance review" },
  { status: "APPROVED", label: "Approved" },
  { status: "POSTED", label: "Posted" },
  { status: "SETTLED", label: "Settled" },
];

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  expense_account: string;
  max_amount: string | null;
  receipt_required_over: string | null;
  is_active: boolean;
}

export interface ExpenseClaimLine {
  id?: string;
  category: string;
  category_name?: string;
  account?: string;
  account_code?: string;
  account_name?: string;
  expense_date: string;
  description: string;
  amount: string;
  receipts: string[];
  sequence?: number;
}

export interface ExpenseApprovalStep {
  id: string;
  sequence: number;
  step_name: string;
  approver: string;
  approver_name: string;
  status: "PENDING" | "APPROVED" | "RETURNED" | "REJECTED";
  comment: string;
  acted_at: string | null;
}

export interface ExpenseClaim {
  id: string;
  claimant: string | null;
  claimant_name: string | null;
  expense_date: string;
  account: string | null;
  amount: string;
  currency: string;
  description: string;
  payment_method: ExpensePaymentMethod;
  attachment: string | null;
  status: ExpenseStatus;
  status_label: string;
  lines: ExpenseClaimLine[];
  approvals: ExpenseApprovalStep[];
  submitted_at: string | null;
  decision_note: string;
  created_by: string;
  finance_reviewed_by: string | null;
  finance_reviewed_at: string | null;
  approved_by: string | null;
  journal_entry: string | null;
  settlement_account: string | null;
  settlement_date: string | null;
  settlement_reference: string;
  settlement_journal: string | null;
  settled_by: string | null;
  reversal_journal: string | null;
  reversed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpensePolicyCheck {
  code: string;
  label: string;
  /** "not_evaluated" is never treated as compliant. */
  status: "pass" | "warn" | "fail" | "not_evaluated";
  detail: string;
}

export interface ExpenseClaimPayload {
  description: string;
  payment_method?: ExpensePaymentMethod;
  claimant?: string;
  lines: Array<Pick<ExpenseClaimLine, "category" | "expense_date" | "description" | "amount" | "receipts">>;
}
