import { apiAction, apiGet, apiGetList, apiPatch, apiPost } from "./client";
import { uploadDocument } from "./operations";
import type { ListParams, PaginatedData } from "@/types/api";
import type { ExpenseCategory, ExpenseClaim, ExpenseClaimPayload, ExpensePolicyCheck } from "@/types/expenses";

/** Claims visible to the caller: finance sees all; staff see their own and those awaiting them. */
export function listExpenseClaims(params?: ListParams & { status?: string; claimant?: string; payment_method?: string }): Promise<PaginatedData<ExpenseClaim>> {
  return apiGetList<ExpenseClaim>("/expenses/", params);
}
export function getExpenseClaim(id: string): Promise<ExpenseClaim> { return apiGet<ExpenseClaim>(`/expenses/${id}/`); }
export function createExpenseClaim(payload: ExpenseClaimPayload): Promise<ExpenseClaim> { return apiPost<ExpenseClaim, ExpenseClaimPayload>("/expenses/", payload); }
export function updateExpenseClaim(id: string, payload: Partial<ExpenseClaimPayload>): Promise<ExpenseClaim> { return apiPatch<ExpenseClaim, Partial<ExpenseClaimPayload>>(`/expenses/${id}/`, payload); }
export function submitExpenseClaim(id: string): Promise<ExpenseClaim> { return apiAction<ExpenseClaim>(`/expenses/${id}/submit/`); }
export function getExpensePolicyChecks(id: string): Promise<{ checks: ExpensePolicyCheck[] }> { return apiGet<{ checks: ExpensePolicyCheck[] }>(`/expenses/${id}/policy-checks/`); }

export function financeReviewExpense(id: string, decision: "approve" | "return" | "reject", comment: string, recodes: Record<string, string> = {}): Promise<ExpenseClaim> {
  return apiAction<ExpenseClaim, { decision: string; comment: string; recodes: Record<string, string> }>(`/expenses/${id}/finance-review/`, { decision, comment, recodes });
}
export function postExpenseClaim(id: string): Promise<ExpenseClaim> { return apiAction<ExpenseClaim>(`/expenses/${id}/post/`); }
/** Records that a reimbursable claim was settled. ErgonX does not send money. */
export function settleExpenseClaim(id: string, payload: { settlement_account: string; settlement_date?: string; reference?: string }): Promise<ExpenseClaim> {
  return apiAction<ExpenseClaim, typeof payload>(`/expenses/${id}/settle/`, payload);
}
export function reverseExpenseClaim(id: string, payload: { reason: string; reversal_date?: string }): Promise<ExpenseClaim> {
  return apiAction<ExpenseClaim, typeof payload>(`/expenses/${id}/reverse/`, payload);
}

export function listExpenseCategories(params?: ListParams & { is_active?: boolean }): Promise<PaginatedData<ExpenseCategory>> { return apiGetList<ExpenseCategory>("/expense-categories/", params); }
export function createExpenseCategory(payload: Omit<ExpenseCategory, "id">): Promise<ExpenseCategory> { return apiPost<ExpenseCategory, Omit<ExpenseCategory, "id">>("/expense-categories/", payload); }
export function updateExpenseCategory(id: string, payload: Partial<Omit<ExpenseCategory, "id">>): Promise<ExpenseCategory> { return apiPatch<ExpenseCategory, Partial<Omit<ExpenseCategory, "id">>>(`/expense-categories/${id}/`, payload); }

/** Upload a receipt the claimant can attach to a line. */
export function uploadExpenseReceipt(file: File, onProgress?: (progress: number) => void) {
  return uploadDocument(file, { category: "EXPENSE_RECEIPT", classification: "CONFIDENTIAL" }, onProgress);
}
