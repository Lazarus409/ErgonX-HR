# Wave 0 — Final Lifecycle / State Matrix

Evidence:

- **State enums** come from `tools/inspect_states.py` (full output in `state_enum_inventory.txt`).
- **Transitions** come from each domain's `services.py`. Every transition named below is a service function called by an explicit `@action` endpoint (see `api_operation_inventory.json`).
- **Audit codes** come from `tools/inspect_audit.py` (see `audit_event_inventory.tsv`).
- **Notifications** are the `notification_type` values emitted by the same services.

## House rules (already true in code; keep them)

- **Explicit action endpoints, not generic PATCH of `status`.** Every `status` field is `read_only` in its serializer, and every transition is an `@action` that calls a locked (`select_for_update`) service.
- **Repeating a transition is a no-op.** For example, approving an APPROVED expense returns the record unchanged. Illegal transitions raise `invalid_state_transition` or `record_immutable`.
- **Finalized and posted data is never edited.**
  - Payroll: `calculate_payroll_run` and `cancel_payroll_run` reject FINALIZED with `record_immutable`. Payslips are created only at finalize and use PROTECT foreign keys.
  - Journals: POSTED and REVERSED journals cannot be voided. Correction goes through `create_reversal`, which creates a linked journal and marks the original REVERSED.
  - Expenses: `Expense.save()` rejects any change once a record is POSTED or REJECTED.
- **Do not rename existing enum values.** Stitch labels map onto the existing states in the *Stitch label mapping* column.

Legend:

- **Del?** — whether the API can hard-delete the record.
  - *soft*: `is_active` / status flag.
  - *403*: routed, but the permission code does not exist, so it is always refused.
  - *none*: `http_method_names` excludes DELETE.

---

### 1. Employee

| States | `Employee.status`: ACTIVE, INACTIVE, SUSPENDED, TERMINATED. Companion records: `EmployeeOnboarding` (NOT_STARTED, IN_PROGRESS, BLOCKED, READY_FOR_ACTIVATION, COMPLETED, CANCELLED); `EmployeeOffboarding` (NOT_STARTED, IN_PROGRESS, BLOCKED, READY_TO_TERMINATE, COMPLETED, CANCELLED); `Employment` (ACTIVE, ENDED, SUSPENDED) |
|---|---|

| From → To | Action endpoint / service | Actor / permission | Preconditions |
|---|---|---|---|
| (new) → onboarding started → COMPLETED (ACTIVE) | `POST /employees/{id}/onboarding_start|onboarding_complete/` → `employees.services` | `employee.update` | not own record (`self_hr_record_edit_not_allowed`) |
| ACTIVE → offboarding → TERMINATED | `POST /employees/{id}/offboarding_start|offboarding_complete/` | `employee.update` | not own record |
| TERMINATED → ACTIVE (new Employment) | `POST /employees/{id}/rehire/` | `employee.update` | not own record |
| any → INACTIVE | `DELETE /employees/{id}/` (soft: sets INACTIVE) | `employee.delete` | not own record |

- **Editable?** Yes, through PATCH with `employee.update`, except the actor's own record.
- **Hard delete?** No (soft).
- **Final?** TERMINATED is final until a rehire.
- **Correction:** rehire creates a new Employment; history comes from `/employees/{id}/employment_history|lifecycle/`.
- **Audit:**
  - `employee.onboarding.started/completed`
  - `employee.offboarding.initiated/completed`
  - `employee.rehired`
  - `employee.document.uploaded/removed`
  - **Gap:** create, update and soft-delete are not audited.
- **Notifications:** none specific.
- **Stitch mapping (S062):** "Active / On leave / Suspended / Exited". *On leave* is derived from approved leave and is not a state; *Exited* is TERMINATED.
- **Phase 2:** add `employee.created`, `employee.updated` (with before/after) and `employee.deactivated` audit events (W3).

### 2. Job Posting (also the Job Requisition)

| States | DRAFT, PENDING_APPROVAL, APPROVED, OPEN, CLOSED, CANCELLED |
|---|---|

| From → To | Action | Permission | Preconditions |
|---|---|---|---|
| DRAFT → PENDING_APPROVAL | `submit_approval` | `job_posting.update` | required hiring-plan fields |
| PENDING_APPROVAL → APPROVED | `approve` | `job_posting.approve` (DIRECTOR has it) | — |
| PENDING_APPROVAL → DRAFT | `return_for_changes` | `job_posting.approve` | comment |
| APPROVED → OPEN; DRAFT → OPEN only if the actor also holds `job_posting.approve` (self-approval shortcut that records approved_by = actor) | `publish` | `job_posting.update` | — |
| OPEN → CLOSED | `close` | `job_posting.update` | — |
| non-final → CANCELLED | `cancel` | `job_posting.update` | — |

- **Editable?** DRAFT fully; limited afterwards.
- **Hard delete?** 403 (`job_posting.delete` does not exist).
- **Final?** CLOSED and CANCELLED.
- **Correction:** close the posting and create a new one.
- **Audit:**
  - `recruitment.requisition.submitted/approved/returned/team_added/team_removed`
  - `recruitment.job_posting.{status}`
  - `recruitment.job_posting.published`
- **Notifications:** `RECRUITMENT_REQUISITION_APPROVAL`, `..._APPROVED`, `..._RETURNED`.
- **Stitch mapping:** Requisition Draft/Submitted/Approved/Changes requested → DRAFT/PENDING_APPROVAL/APPROVED/DRAFT-after-return. Opening/Published → OPEN.
- **Phase 2:** none. This **supersedes v3 D2-013 (separate JobRequisition model)**. Open question: is a *second person's* approval mandatory before publish? Today an actor holding both `job_posting.update` and `job_posting.approve` (IA, HR) can publish straight from DRAFT (BQ-06).

### 3. Candidate

| States | ACTIVE, WITHDRAWN, HIRED |
|---|---|

- **Transitions:**
  - becomes HIRED via `offers/{id}/hire` (`offer.manage`);
  - WITHDRAWN is settable by editing the candidate (`candidate.update`). Withdrawing an *application* does not change candidate status.
- **Editable?** Yes (`candidate.update`).
- **Hard delete?** 403. Candidate documents are removed through `remove_document` (`candidate.update`).
- **Final?** HIRED.
- **Audit:** `recruitment.candidate.document_added/removed`.
- **Notifications:** `RECRUITMENT_CANDIDATE_HIRED`.
- **Phase 2:** none. Data-retention and deletion requests for candidates are a privacy item that is deferred (BQ-07).

### 4. Application

| States | DRAFT, ACTIVE, WITHDRAWN, REJECTED, OFFERED, HIRED, plus `stage` (an institution-configured RecruitmentStage with ApplicationStageHistory) |
|---|---|

| From → To | Action | Permission |
|---|---|---|
| DRAFT → ACTIVE | `submit` | `candidate.create` |
| ACTIVE stage n → stage m | `move_stage` | `candidate.update` |
| ACTIVE → REJECTED | `reject` | `candidate.update` |
| ACTIVE → WITHDRAWN | `withdraw` | `candidate.update` |
| ACTIVE → OFFERED | offer extended | `offer.create` |
| OFFERED → HIRED | offer `hire` (also creates the Employee and keeps lineage) | `offer.manage` |

- **Editable?** Limited.
- **Hard delete?** none.
- **Final?** HIRED, REJECTED, WITHDRAWN.
- **Correction:** stage history.
- **Audit:** `recruitment.application.submitted/stage_moved/rejected/withdrawn/scorecard_submitted`.
- **Notifications:** `RECRUITMENT_APPLICATION_SUBMITTED`.
- **Stitch mapping:** Screening/Interview/Offer are **stages**, not statuses. v3's `CONVERTED_TO_EMPLOYEE` is HIRED, with the employee link held on the offer.

### 5. Interview

| States | DRAFT, SCHEDULED, COMPLETED, CANCELLED, NO_SHOW |
|---|---|

- **Transitions:**
  - `schedule` (DRAFT or new → SCHEDULED);
  - `reschedule`;
  - `set_status` (→ COMPLETED, CANCELLED or NO_SHOW).
  - All three need `interview.manage`.
- **Editable?** DRAFT and SCHEDULED.
- **Hard delete?** 403.
- **Final?** COMPLETED, CANCELLED, NO_SHOW.
- **Audit:** `recruitment.interview.{status}`.
- **Notifications:** `RECRUITMENT_INTERVIEW_SCHEDULED`.
- **Phase 2:** external calendar integration is deferred (D2-015).

### 6. Offer

| States | DRAFT, PENDING_APPROVAL, APPROVED, EXTENDED, ACCEPTED, DECLINED, WITHDRAWN, HIRED |
|---|---|

| From → To | Action | Permission |
|---|---|---|
| DRAFT → PENDING_APPROVAL | `submit_approval` | `offer.create` |
| PENDING_APPROVAL → APPROVED / DRAFT | `approve` / `return_for_changes` | `offer.approve` |
| APPROVED → EXTENDED | `extend` (+ `generate_letter`) | `offer.create` |
| EXTENDED → ACCEPTED / DECLINED | `accept` / `decline` | `offer.manage` |
| non-final → WITHDRAWN | `withdraw` | `offer.manage` |
| ACCEPTED → HIRED | `hire` (creates Employee; candidate and application become HIRED) | `offer.manage` |

- **Editable?** DRAFT only.
- **Hard delete?** 403.
- **Final?** HIRED, DECLINED, WITHDRAWN.
- **Correction:** withdraw, then a new offer.
- **Audit:** `recruitment.offer.submitted/approved/returned/extended/letter_generated/withdrawn/hired`, `recruitment.offer.{status}`.
- **Notifications:** `RECRUITMENT_OFFER_APPROVAL/APPROVED/RETURNED/EXTENDED`, `RECRUITMENT_CANDIDATE_HIRED`.

### 7. Leave Request

| States | `LeaveRequest`: DRAFT, PENDING, APPROVED, REJECTED, CANCELLED. Per-step `LeaveApproval`: PENDING, APPROVED, REJECTED, SKIPPED, RETURNED (with `delegated_from`) |
|---|---|

| From → To | Action / service | Actor / permission | Preconditions |
|---|---|---|---|
| DRAFT → PENDING | `submit` → `submit_leave_request` | requester, `leave.request` | policy applies; balance sufficient; approver chain resolved (workflow definition → department head → reports_to → HR/admin fallback; self excluded) |
| PENDING (step n) → next step / APPROVED | `approve` | current step approver only, `leave.approve` | balance consumed on final approval |
| PENDING → REJECTED | `reject` | current step approver, `leave.reject` | — |
| PENDING → DRAFT (step RETURNED; later steps SKIPPED) | `request_changes` | current step approver, `leave.approve` | comment |
| PENDING step → delegate | `delegate` | current approver, `leave.approve` | delegate is eligible |
| DRAFT/PENDING/APPROVED → CANCELLED | `cancel` | requester or an approver, `leave.request` | balance restored |

- **Editable?** DRAFT only (PATCH).
- **Hard delete?** none.
- **Final?** APPROVED, REJECTED, CANCELLED.
- **Correction:** cancel, then a new request.
- **Audit:** `leave.request.created/updated/submitted/approved_step/rejected/changes_requested/delegated/commented/cancelled`.
- **Notifications:** `LEAVE_APPROVAL_REQUIRED`, `LEAVE_APPROVED`, `LEAVE_REJECTED`, `LEAVE_CHANGES_REQUESTED`.
- **Stitch mapping:** "Submitted" is PENDING. "Declined" is REJECTED. "Changes requested" is DRAFT plus a RETURNED approval step.
- **Phase 2:** none required. Payroll does not consume leave today, so there is no finalized-payroll dependency yet.

### 8. Attendance Record

| States | `status` is a **classification**, not a lifecycle: PRESENT, ABSENT, LATE, ON_LEAVE, HOLIDAY, OFF_DAY, REMOTE |
|---|---|

- **Writes:**
  - `clock-in` and `clock_out` (`attendance.clock`);
  - `classify` (`attendance.manage`);
  - an approved adjustment (see 9).
- **Editable?** No direct PATCH (`http_method_names` = get, post).
- **Hard delete?** none.
- **Audit:** `attendance.clocked_in/clocked_out/date_classified`.
- **Phase 2:** none.

### 9. Attendance Adjustment

| States | DRAFT, PENDING, APPROVED, REJECTED, RETURNED |
|---|---|

| From → To | Action | Actor / permission | Preconditions |
|---|---|---|---|
| (new) → PENDING | create → `request_adjustment` | `attendance.adjust` | evidence required when the adjustment adds more than 1h (Claude-defined rule, 2026-09-27) |
| PENDING → APPROVED / REJECTED | `approve` / `reject` → `decide_adjustment` | `attendance.approve`; not own attendance | **no finalized-payroll check** |
| PENDING → RETURNED | `request_changes` | `attendance.approve` | comment |
| RETURNED → PENDING | `resubmit` | requester, `attendance.adjust` | — |
| PENDING → delegate | `delegate` | `attendance.approve` | — |

- **Editable?** DRAFT and RETURNED by the requester.
- **Hard delete?** none.
- **Final?** APPROVED and REJECTED.
- **Correction:** a new adjustment.
- **Audit:** `attendance.adjustment.requested/decided/returned/resubmitted/delegated`.
- **Notifications:** `ATTENDANCE_ADJUSTMENT_ASSIGNED/DECIDED/RETURNED`.
- **Stitch mapping:** "Changes requested" is RETURNED.
- **Phase 2 — LC-ATT-01:** approving must fail closed with `payroll_period_finalized` when the attendance date falls in a payroll period that has a FINALIZED run, once attendance feeds payroll. Payroll does not read attendance yet, so this is a **guard to add with the overtime-pay link**, not a live corruption today. *Self-decision is checked after the record mutation inside the same atomic transaction, so it is safe, but the check should move first.*

### 10. Payroll Run

| States | DRAFT, CALCULATING, CALCULATED, UNDER_REVIEW, APPROVED, FINALIZED, CANCELLED. Exceptions: `PayrollRunException` OPEN, ACKNOWLEDGED, RESOLVED (severity HIGH blocks) |
|---|---|

| From → To | Action | Permission | Preconditions |
|---|---|---|---|
| DRAFT → CALCULATING → CALCULATED | `calculate` | `payroll.prepare` | configuration/preset complete; fails closed on unresolved Ghana rules (GHA-*/PAY-*); exceptions detected after calculation |
| CALCULATED → CALCULATED | `validate` (re-run exception detection) | `payroll.prepare` | — |
| CALCULATED → UNDER_REVIEW | `submit_review` | `payroll.prepare` | **no OPEN HIGH exceptions** (`payroll_exceptions_open`) |
| UNDER_REVIEW → APPROVED | `approve` | `payroll.approve` | no reconciliation discrepancies |
| APPROVED → FINALIZED | `finalize` | `payroll.finalize` | reconciliation clean; at least one record; records FINALIZED; payslips generated |
| any non-final → CANCELLED | `cancel` | `payroll.prepare` | not FINALIZED |
| exception OPEN ↔ ACKNOWLEDGED → RESOLVED | `POST exceptions/{exception_id}/` | `payroll.prepare` | run not FINALIZED or CANCELLED |

- **Editable?** No. `calculate` runs only from DRAFT; calling it on a CALCULATED run is a no-op, and `validate` only re-runs exception detection. To change figures before finalizing, fix the source data, then cancel and re-create the run.
- **Hard delete?** none.
- **Final?** FINALIZED and CANCELLED; FINALIZED is immutable.
- **Correction:** a `PayrollAdjustment` (DRAFT → PENDING → APPROVED/REJECTED → APPLIED) applied in a later run; `generate_accounting_journal` posts to the GL, and the GL is corrected by journal reversal.
- **Audit:** `payroll.run.created/calculated/validated/submitted_for_review/approved/finalized/cancelled`, `payroll.exception.updated`, `payroll.adjustment.*`.
- **Notifications:** `PAYROLL_ACTION_REQUIRED`.
- **Stitch / v3 mapping:**
  - VALIDATING → CALCULATING.
  - VALIDATION_FAILED → CALCULATED with OPEN HIGH exceptions.
  - READY_FOR_APPROVAL / APPROVAL_PENDING → UNDER_REVIEW.
  - **PAID has no equivalent.** Payment is not tracked, so do not show "Paid" (defer).
- **Gaps:** no preparer≠approver rule (BQ-04). There is no REJECTED transition from UNDER_REVIEW, and no recalculation after CALCULATED. The only way back is to cancel and re-create. Phase 2: add a governed `return_for_correction` (UNDER_REVIEW or CALCULATED → DRAFT, discarding records, with a note) if the product wants it.

### 11. Payslip

| States | No status field. A `Payslip` is created inside `finalize_payroll_run` (OneToOne to PayrollRecord, PROTECT) with a checksum and document reference. `PayrollRecord.status`: CALCULATED, FINALIZED, ERROR |
|---|---|

- **Editable?** No.
- **Hard delete?** none.
- **Final?** Always.
- **Correction:** a PayrollAdjustment in a later run.
- **Visibility:** self, unless the viewer holds `payroll.view`.
- **Phase 2:** none.

### 12. Journal

| States | DRAFT, PENDING_APPROVAL, APPROVED, POSTED, REVERSED, VOID |
|---|---|

| From → To | Action | Permission | Preconditions |
|---|---|---|---|
| DRAFT → PENDING_APPROVAL | `submit` | `journal.create` | balanced |
| PENDING_APPROVAL → APPROVED | `approve` | `journal.approve` | — |
| APPROVED → POSTED | `post` | `journal.post` | period OPEN (shared lock with period close); accounts active and postable |
| DRAFT, PENDING_APPROVAL or APPROVED → VOID | `void` | `journal.create` | not POSTED or REVERSED |
| POSTED → REVERSED (+ new linked reversing journal) | `reverse` → `create_reversal` | `journal.reverse` | target period open |

- **Editable?** DRAFT only.
- **Hard delete?** none.
- **Final?** POSTED (immutable), REVERSED, VOID.
- **Audit:** `accounting.journal.created/updated/submitted/approved/posted/voided/reversal_created/reversed/note_added/attachment_added`.
- **Notifications:** `ACCOUNTING_ACTION_REQUIRED`.
- **Stitch mapping:** "Rejected" has no state; use VOID or return to DRAFT. There is no reject action today.
- **Gaps:** no creator≠approver rule. System-generated journals (expense, payroll) are submitted, approved and posted by the same actor in one call (FIN-02, BQ-04).

### 13. AP Vendor Bill

| States | DRAFT, PENDING, APPROVED, REJECTED, POSTED, PART_PAID, PAID, VOID (+ `on_hold` flag) |
|---|---|

- **Transitions:**

  | Transition | Action | Permission |
  |---|---|---|
  | DRAFT → PENDING | `submit` | `vendor_bill.create` |
  | PENDING → APPROVED | `approve` | `vendor_bill.approve` |
  | PENDING → REJECTED (reason required) | `reject` | `vendor_bill.approve` |
  | REJECTED → DRAFT | `revise` | `vendor_bill.create` |
  | APPROVED → POSTED | `post` | `vendor_bill.post` |
  | POSTED → PART_PAID / PAID | payments (settlement sync) | `payment.create` |
  | non-posted → VOID | `void` | `vendor_bill.void` |
  | set or clear the hold flag | `hold` / `release` | `vendor_bill.approve` |
  | schedule a payment | `schedule_payment` | `payment.create` |
  | bulk | `bulk/preview` + `bulk/execute` | per-record re-check |

- **Hard delete?** none.
- **Final?** PAID and VOID. POSTED is immutable; it is corrected by payment void and a future reversal ("Posted or paid bills require a future reversal/payment workflow").
- **Audit:** `accounting.vendor_bill.*`.

### 14. AR Invoice

| States | DRAFT, ISSUED, PART_PAID, PAID, VOID (+ hold flag, reminders SCHEDULED/DONE/CANCELLED) |
|---|---|

- **Transitions:**
  - `issue` (`invoice.issue`) posts the journal;
  - receipts move it to PART_PAID or PAID;
  - `void` is DRAFT only (`invoice.void`);
  - `hold`, `release`, `send` and `reminders` need `invoice.issue`.
- **Final?** PAID and VOID. ISSUED is immutable ("Issued invoices require a future credit-note/reversal workflow").
- **Audit:** `accounting.invoice.*`.
- **Phase 2:** credit notes are **deferred** (BQ-08). Stitch "Issue credit" must be hidden.

### 15. Expense Claim (current `Expense`)

| States | DRAFT, PENDING, APPROVED, POSTED, REJECTED |
|---|---|

| From → To | Action | Permission | Preconditions |
|---|---|---|---|
| DRAFT → PENDING | `submit` | `expense.create` | — |
| PENDING → APPROVED | `approve` | `expense.approve` | **no self-approval guard** |
| PENDING → REJECTED | `reject` | `expense.approve` | — |
| APPROVED → POSTED | `post` → `post_expense` | `expense.post` + `journal.create/approve/post` | period OPEN; preset `CASH` mapping resolves to exactly one active postable account |

- **Editable?** DRAFT only.
- **Hard delete?** none.
- **Final?** POSTED and REJECTED (enforced in `save()`).
- **Correction:** reverse the linked journal. The expense stays POSTED (EXP-001).
- **Audit:** `accounting.expense.created/updated/submitted/approved/rejected/posted`.
- **Notifications:** submit notifies holders of `expense.approve` (`ACCOUNTING_ACTION_REQUIRED`). Approve, reject and post notify nobody.
- **Phase 2 target:** see `expense_management_gap_analysis.md`. The mapping is:
  - Draft → DRAFT.
  - Submitted → PENDING.
  - Manager Approval → PENDING with an engine step.
  - Finance Review → **new** FINANCE_REVIEW.
  - Approved → APPROVED.
  - Posted → POSTED.
  - Settled → **new** SETTLED.
  - Changes requested → **new** RETURNED.
  - Declined → REJECTED.

### 16. Bank Reconciliation

| States | Session: IN_PROGRESS, COMPLETED. Line: UNMATCHED, MATCHED, EXCEPTION |
|---|---|

- **Actions:** create session → `import_statement` → `suggestions` → `match`/`unmatch` and `line_action` (flag/unflag) → `complete`. All writes need `bank_reconciliation.manage`.
- **Preconditions for `complete`:**
  - a statement has been imported;
  - every line is MATCHED or flagged EXCEPTION;
  - a statement closing balance has been entered;
  - the book-to-statement difference is exactly 0.00.
- **Final?** COMPLETED.
- **Correction:** there is no reopen. Start a new session.
- **Audit:** `accounting.reconciliation.started/statement_imported/completed`, `accounting.bank_statement_line.imported/matched/unmatched/flagged/unflagged`.
- **Stitch / v3 mapping:** DRAFT has no equivalent. A session is created IN_PROGRESS. Governed reopen is **deferred** (W7, only if requested).

### 17. Report / export jobs

| Record | States | Notes |
|---|---|---|
| `operations.ExportJob` | QUEUED, RUNNING, COMPLETED, FAILED, CANCELLED | `download` needs `export_job.view`. Typed handlers only. |
| `operations.ImportJob` | UPLOADED, VALIDATING, READY, COMMITTING, COMPLETED, FAILED, CANCELLED (+ row results VALID/INVALID/IMPORTED/SKIPPED) | `confirm` needs `import_job.create`. |
| `operations.BackgroundJob` | QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED | read-only API |
| `accounting.FinancialReportRun` | COMPLETED, FAILED | `run` needs `financial_report.view`. `run_scheduled_reports` needs a daily cron on Render. |
| `accounting.BatchJob` (AP bulk) | QUEUED, PROCESSING, COMPLETED, PARTIAL, FAILED | `accounting.batch_job.completed` |
| `reports.AnalyticsItem` | DRAFT, PUBLISHED, ARCHIVED | `report.publish` is checked in the service |

None of these are hard-deletable through the API (DELETE resolves to non-existent codes or is excluded). Import and export job state changes are not audited (AUD gap, low).

### 18. Approval Request (generic engine)

| States | `ApprovalRequest`: PENDING, APPROVED, REJECTED, CANCELLED. `ApprovalAction`: APPROVE, REJECT, RETURN (unused), CANCEL |
|---|---|

- **Transitions** (`decide_approval_request`):
  - PENDING (step n) → step n+1 or APPROVED, by the assigned user or a holder of the assigned role;
  - → REJECTED, by the same;
  - → CANCELLED, by the requester only.
- **Due date:** `due_at` is computed from `due_after_hours`, but nothing escalates it.
- **Hard delete?** 403.
- **Final?** APPROVED, REJECTED, CANCELLED.
- **Audit:** `APPROVAL_REQUESTED`, `APPROVAL_APPROVE/REJECT/CANCEL`.
- **Notifications:** none.
- **Phase 2:** see `approval_engine_gap_analysis.md`. Decide whether expense, payroll and journal approvals move onto this engine, or whether the engine only resolves approvers, as it already does for Leave (recommended).

---

## State-machine changes required in Phase 2 (all need migrations; approval required)

| ID | Record | Change | Wave |
|---|---|---|---|
| LC-EXP-01 | Expense | Add FINANCE_REVIEW, RETURNED, SETTLED (and keep DRAFT/PENDING/APPROVED/POSTED/REJECTED); add claimant, line items, settlement link | W6 |
| LC-ATT-01 | AttendanceAdjustment | Guard approve against finalized payroll periods (no new state) | W3, or with the overtime-pay link |
| LC-PAY-01 | PayrollRun | Optional governed `return_for_correction` (→ DRAFT); optional separation of duties (no new state) | W5 (BQ-04) |
| LC-JNL-01 | Journal | Optional `reject` from PENDING_APPROVAL → DRAFT; optional separation of duties | W6 (BQ-04) |
| LC-AR-01 | Invoice | Credit note record — **deferred** | W7+ |
| LC-BR-01 | Reconciliation session | Governed reopen — **deferred** | W7+ |

No other state machine needs new states. Every other Stitch status label maps onto existing values, as shown above.
