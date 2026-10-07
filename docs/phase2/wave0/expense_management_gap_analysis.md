# Wave 0 — Expense Management Gap Analysis

**Locked target:** Draft → Submitted → Manager Approval → Finance Review → Approved → Posted → Settled.

- No hard delete after approval or posting.
- Corrections and reversals are governed.
- GL mappings are configured per institution; no account ID is ever hard-coded.
- "Settled" must not imply a bank transfer unless a payment integration exists.

Evidence:

- `apps/accounting/models.py` `Expense` (≈L1602)
- `apps/accounting/services.py`: `create_expense`, `update_draft_expense`, `submit_expense`, `approve_expense`, `reject_expense`, `post_expense`, `_mapping_account`, `_cash_transaction_period`
- `apps/accounting/views.py` `ExpenseViewSet`; `ExpenseSerializer`
- `ergonx-frontend` `lib/api/accounting.ts` (`*Expense`) and `app/accounting/expenses/page.tsx`
- `tests/test_accounts_payable.py::test_expense_workflow_posts_a_balanced_cash_journal_and_rejects_invalid_transitions` (the only expense workflow test)
- Register entry EXP-001 (SAFEGUARDED)

## 1. Current implementation (verified)

| Aspect | Current behaviour |
|---|---|
| Model | One flat `Expense` row: `expense_date`, `account` (FK, must be an EXPENSE-type account of the same tenant), `amount` (>0), `currency` (3-letter), `description`, `attachment` (optional single `documents.Document`), `status`, `created_by`, `approved_by`, `journal_entry`. |
| Claimant | **None.** `created_by` is the user who typed it; there is no employee or claimant link and no "on behalf of". |
| Header/items | No header/item split; one amount per expense. |
| Attachments | One optional Document FK. No receipt-required rule. |
| Categories | No category model. **The submitter picks the GL expense account directly.** |
| Policies | None: no limits, per-diem rules, receipt thresholds or duplicate detection. |
| Statuses | DRAFT → PENDING → APPROVED → POSTED; PENDING → REJECTED. POSTED and REJECTED are immutable in `save()`. |
| Approval | One step. Any holder of `expense.approve` (IA, FM) may approve. **No self-approval guard. No manager stage. Not routed through the approval engine.** |
| Posting | `post_expense`, which requires `expense.post` plus the journal create/approve/post permissions. It creates an `EXPENSE`-source journal: **Dr selected expense account / Cr preset `CASH` mapping**. The journal is submitted, approved and posted in the same call by the same actor. Posting fails closed if: the period is not OPEN; there is no applied preset; the CASH `system_mapping_code` does not resolve to exactly one template; or the matching institution account is missing, inactive or not postable. |
| GL mapping | Resolved through the *applied accounting preset's* `AccountTemplate.system_mapping_code = "CASH"`, then the institution `Account` with the same **code**. No hard-coded IDs, but this inherits ERD-005: no durable link between account and template, so renaming the account code breaks the mapping, which then fails closed. |
| Tax | **None.** No input-VAT/recoverable-tax line and no withholding. |
| Currency | Stored, but **not checked against the institution base currency**. A foreign-currency expense would post its raw amount into the base ledger. **FIN-03 (P1).** |
| Settlement | **None as a step.** The CASH credit at posting *is* the settlement, so this is a cash-paid model. Employee reimbursement, payable, payment linkage and status are all absent. |
| Corrections | Reverse the linked journal through the generic journal reversal. The expense stays POSTED with no reversal link of its own (EXP-001). |
| Deletion | No DELETE (`http_method_names` = get, post, patch). Drafts can only be edited. |
| Audit | `accounting.expense.created/updated/submitted/approved/rejected/posted`, with from/to metadata on transitions. |
| Notifications | Submit notifies `expense.approve` holders. Approve, reject and post notify nobody. |
| Permissions | `expense.view`, `expense.create`, `expense.approve`, `expense.post`. ACC holds view and create; FM and IA hold all four. **EMPLOYEE and DEPARTMENT_HEAD hold none.** |
| Self-service | **None.** The queryset is institution-wide, there is no SELF scope, and there is no `/me/expenses` page. Staff cannot claim expenses. |
| Reporting | `/reports/expenses/` (CSV); finance dashboard expense categories; included in the approvals inbox. |
| Module | `ACCOUNTING` (disabled module → 403 `module_disabled`). |

## 2. Gap matrix against the Phase 2 target

| # | Target capability | Classification | Notes / design constraint |
|---|---|---|---|
| E-01 | Claimant (employee) on a claim, distinct from creator | **New** | FK to `Employee` (same tenant). Required for self-service and the manager stage. |
| E-02 | Claim header + line items | **New** | `ExpenseClaim` header + `ExpenseClaimLine`. **Decision BQ-02:** evolve `Expense` into the header (migration, keeps history), or add a new model and keep legacy `Expense` read-only. Recommendation: evolve `Expense` in place. Existing rows become single-line claims with claimant = null (legacy), so API paths stay stable. |
| E-03 | Multiple receipts per line | **Extend** | Reuse `documents.Document` (already used by bills, journals and budgets attachments); M2M or attachment table. |
| E-04 | Expense categories → GL mapping (institution-configured) | **New** | `ExpenseCategory` (institution, code, name, `expense_account` FK, optional `tax_code`, receipt-required threshold, active). Claimants choose a category, never a GL account. Finance may recode during review. Account FKs are configured per institution, never hard-coded. |
| E-05 | Policy checks (limit per category, receipt threshold, duplicates, future date) | **New (limited)** | Return PASS/WARN/FAIL/NOT_EVALUATED, the same shape as leave review checks. Unknown is never treated as compliant. |
| E-06 | Draft | **Existing** | DRAFT |
| E-07 | Submitted | **Existing** | PENDING (keep the value; label it "Submitted") |
| E-08 | Manager approval | **Extend** | Engine trigger `EXPENSE_CLAIM` with approver `REQUESTER_MANAGER`/department head. The claimant can never approve their own claim. Stays in PENDING with step tracking, so no new status is needed for the manager stage. |
| E-09 | Return for changes | **New** | Status RETURNED (→ resubmit), as for attendance adjustments. |
| E-10 | Finance review | **New** | Status `FINANCE_REVIEW` after the manager stage. Finance recodes category or account and tax, checks policy, and then approves, returns or rejects. Permission `expense.finance_review`. |
| E-11 | Approved | **Existing** | APPROVED (after finance review) |
| E-12 | Posted, accrual model | **Extend** | Change posting to Dr expense account(s) per line, Dr recoverable tax (only where the category's tax code configures it), Cr **employee-payable / configured liability** (new mapping code, for example `EMPLOYEE_PAYABLE`, in the preset plus an institution override). The cash-paid variant stays available when a claim is marked as paid from petty cash (Cr `CASH` mapping). Fail closed if any mapping is missing. |
| E-13 | Separation of duties at posting | **Extend** | Today post = submit + approve + post of the journal by one actor. Keep the system journal auto-approved (it is derived from an approved claim), but record the claim approver and finance reviewer on the journal context. BQ-04 decides whether the poster must differ from the approver. |
| E-14 | Settled | **New** | Status `SETTLED` via an explicit `settle` action (`expense.settle`): Dr employee payable / Cr bank or cash account (an institution `BankAccount` GL). It records a settlement reference and date. **It means 'settlement recorded', never 'money sent'**: there is no payment-rail call. Optionally link to the existing `Payment` model if AP-style payments are reused (BQ-03). |
| E-15 | Corrections after posting | **Extend** | Governed `reverse` on the claim: it creates the journal reversal, links it to the claim, and returns the claim to a terminal REVERSED (or keeps it POSTED with a reversal link). **Decision BQ-02b.** Either way, no edit and no delete. |
| E-16 | No hard delete after approval/posting | **Existing** | There is no DELETE endpoint today. Keep it that way, including for new claim and line models. |
| E-17 | Currency control | **Extend (P1, can ship before W6)** | Reject a non-base currency until FX is supported (fail closed), or add an explicit FX rate and base amount. Recommendation: fail closed now. |
| E-18 | Self-service claim UI + API | **New** | `expense.claim_own` permission and a SELF-scoped queryset (`common.scoping`). Frontend `/me/expenses` (new self-service route; no Stitch screen exists, so build it with Design System v2 patterns). |
| E-19 | Notifications | **Extend** | Notify the claimant on approve, return, reject, post and settle. Notify the approver on entering a step. Notify finance on entering finance review. |
| E-20 | Audit | **Extend** | New events: `accounting.expense.returned`, `.manager_approved`, `.finance_reviewed`, `.recoded` (before/after), `.settled`, `.reversed`. |
| E-21 | Corporate cards, mileage/per-diem engines, OCR receipt capture, bank payment initiation | **Deferred** | Not in the locked target. |
| E-22 | Budget consumption (committed spend) | **Not needed** | The guardrail forbids committed amounts without a source; budgets read actuals from the posted GL, which already works. |

## 3. Posting model (configurable; nothing assumed by ID or name)

```
On POST (claim APPROVED → POSTED), per claim:
  Dr <line.category.expense_account | finance-recoded account>      line net amount
  Dr <TaxCode → TaxComponent.input_account_mapping_code → institution account>     recoverable tax   (only when the category/tax code says so)
  Cr <EMPLOYEE_PAYABLE mapping → institution account>               claim total       (reimbursable claim)
     — or Cr <CASH mapping> when the claim is flagged paid-from-petty-cash (current behaviour)

On SETTLE (POSTED → SETTLED), reimbursable claims only:
  Dr <EMPLOYEE_PAYABLE mapping account>   claim total
  Cr <selected BankAccount.ledger_account | CASH mapping>   claim total
```

Every account is resolved at posting time, either from institution-configured category accounts or from preset `system_mapping_code`s with an institution override. Any unresolved mapping, a closed or locked period, or a non-base currency raises `policy_not_applicable` or `period_closed`, and nothing is posted.

## 4. Dependencies and blockers

- **G0-07** stays PARTIAL until BQ-02 (model evolution) and BQ-03 (settlement linkage) are answered.
- The approval-engine W2 work (trigger `EXPENSE_CLAIM`, approver `REQUESTER_MANAGER`) must land before the manager stage.
- ERD-005 (account provenance) should be resolved, or code-based mapping ratified, before adding the `EMPLOYEE_PAYABLE` mapping.
- Migrations need explicit approval. Nothing was created in this pass.
