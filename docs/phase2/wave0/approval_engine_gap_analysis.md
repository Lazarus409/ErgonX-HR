# Wave 0 — Approval / Workflow Engine Gap Analysis

**Target (locked):** a *controlled, configurable approval engine for supported business triggers*, not a no-code automation platform.

Evidence:

- `apps/workflows/{models,services,views,inbox}.py`
- `apps/leave/services.py` (`_configured_approvers`, `_department_head_approver`, approve/reject/request_changes/delegate)
- `apps/attendance/services.py` (decide/return/resubmit/delegate)
- per-module approve actions in `recruitment`, `payroll`, `accounting` and `budgets`
- tests: `tests/test_approval_platform.py`, `test_approval_inbox.py`, `test_leave_review_workflow.py`, `test_attendance_adjustment_review.py`

## 1. What exists today

ErgonX has **two approval layers**:

1. **A generic engine** (`apps.workflows`).
   - `ApprovalWorkflowDefinition` holds code, name, `workflow_type`, `entity_type` and `is_active`.
   - Each definition has ordered `ApprovalWorkflowStep` rows. A step has an approver role *or* user, plus `due_after_hours`.
   - `ApprovalRequest` (PENDING/APPROVED/REJECTED/CANCELLED) and `ApprovalAction` (APPROVE/REJECT/RETURN/CANCEL) record the run.
   - `submit_approval_request` and `decide_approval_request` advance a request through its steps. Both are audited (`APPROVAL_*`).
   - The API is CRUD: `/approval-workflows/`, `/approval-workflow-steps/`, `/approval-requests/` (+approve/reject/cancel) and `/approval-actions/` (read-only).
   - The settings UI is `/settings/approval-workflows`.
   - **No business module creates `ApprovalRequest` rows.** The engine runs but no module feeds it.
2. **Domain approvals.** Each module has its own explicit actions and state. Only Leave reads the engine's *definitions*, and only to resolve approvers.

| Domain | Approval mechanism | Multi-step | Approver resolution | Return/changes | Delegate | Self-approval guard |
|---|---|---|---|---|---|---|
| Leave | `LeaveApproval` rows per request | **Yes** (sequence) | engine definition (`entity_type=leave.LeaveRequest`), else department head (walks parents) → `reports_to` → first HR_ADMIN → first INSTITUTION_ADMIN | Yes (`request_changes` → DRAFT) | Yes | Fallback path excludes the requester. **The configured-definition path does not.** |
| Attendance adjustment | single decision | No | any holder of `attendance.approve` | Yes (RETURNED/resubmit) | Yes | Yes |
| Overtime | single decision | No | `attendance.approve` | No | No | Yes (2026-09-28) |
| Job requisition (JobPosting) | single decision | No | `job_posting.approve` | Yes | No | Yes on `approve`. **Bypassable**: an actor holding approve can `publish` straight from DRAFT. |
| Offer | single decision | No | `offer.approve` | Yes | No | Yes |
| Payroll run | review → approve → finalize | 3 gates | permission holders | No | No | **No** |
| Payroll adjustment / tax relief | single decision | No | `payroll.approve` / `tax_relief.approve` | No | No | Not checked |
| Journal | submit → approve → post | 2 gates | permission holders | No | No | **No** |
| Vendor bill | submit → approve → post | 2 gates | permission holders | `reject` → `revise` | No | Not checked |
| Expense | submit → approve → post | 1 gate | `expense.approve` holders | No | No | **No** |
| Budget | submit → approve | 1 gate | `budget.approve` | `return_for_changes` | No | Yes |
| Cross-module inbox | `GET /approvals/inbox/` aggregates all of the above | — | per item: module + permission + data scope + current-step owner (leave) | via module endpoint | via module endpoint | — |

## 2. Capability classification

| Capability | Status | Evidence / gap | Phase 2 decision |
|---|---|---|---|
| Workflow definitions | **Already supported** | Definition and step CRUD + UI | Keep |
| Triggers (which business event uses which definition) | **Partially supported** | Implicit: Leave picks the *oldest active* definition whose `entity_type` is `leave.LeaveRequest`. `workflow_type` is free text. No other module looks up definitions. | **Phase 2 extension.** Introduce a closed `trigger` enum (LEAVE_REQUEST, ATTENDANCE_ADJUSTMENT, EXPENSE_CLAIM, JOB_REQUISITION, OFFER, PAYROLL_RUN, JOURNAL, VENDOR_BILL, BUDGET). Allow one active definition per trigger, plus optional scope (department, amount band). Replace free-text `entity_type` matching. |
| Conditions (amount thresholds, department, leave type) | **Not supported** | — | **Phase 2 extension, limited.** Amount band (min/max) for EXPENSE_CLAIM, VENDOR_BILL and JOURNAL; department scope for all. No expression language. |
| Stages / multi-stage | **Partially supported** | Engine has ordered steps. Leave honours multi-step. Payroll and journal gates are hard-coded. | Keep hard-coded *control* gates (payroll finalize, journal post). Use the engine only for the human approval stages. |
| Role-based approvers | **Partially supported** | `approver_role` exists, but Leave resolves it to the **single earliest-joined member** holding that role, not to "any holder". The generic engine accepts any holder. | **Phase 2 extension.** Standardise on any active holder of the role, with first-decision-wins and a recorded decider. |
| User-based approvers | **Already supported** | `approver_user` | Keep |
| Manager relationships | **Partially supported** | Department head (walks parent departments, skips self) and `Employment.reports_to` are used only in Leave's fallback. A step keyed on role code `DEPARTMENT_HEAD` is special-cased to mean "the requester's head". | **Phase 2 extension.** Add explicit approver types `REQUESTER_DEPARTMENT_HEAD` and `REQUESTER_MANAGER` instead of the role-code special case. Needed for the expense manager stage. |
| Delegation | **Partially supported** | Per-request delegation in Leave and Attendance (`delegate` actions, `delegated_from`). No standing out-of-office delegation. | Keep per-request. **Defer** standing delegation (W8) unless product requires it. |
| Escalation | **Not supported** | `due_after_hours` and `due_at` are computed, but nothing acts on them (no scheduler job). | **Phase 2 extension (light).** A daily job (`run_scheduled_*` pattern; needs Render cron) sends a reminder to the approver and an overdue notice to a configured escalation role. No auto-approve and no auto-reassign. |
| Request changes / return | **Partially supported** | Leave, Attendance, Requisition, Offer, Budget and Vendor bill (reject → revise). Generic engine: `RETURN` enum exists but the service rejects it. | Implement `RETURN` in the engine; add it to Expense (W6). |
| Comments | **Partially supported** | Leave comments thread; adjustment decision note; journal and budget notes; engine `ApprovalAction.comments`. | Keep per domain. |
| Workflow history | **Already supported** | Per-domain approval rows, `ApprovalAction`, `AuditLog`, `/record-history/` | Keep |
| Notifications | **Partially supported** | Leave, attendance, recruitment, payroll and accounting send action-required notifications. Generic engine sends none. | Engine must notify the step approver on entering a step, and the requester on the outcome. |
| Audit | **Partially supported** | Domain decisions are audited. Definition and step create/update/delete are **not** audited. | Add `approval_workflow.created/updated/deactivated` and `approval_workflow_step.changed` events (W2). |
| Self-approval / separation of duties | **Partially supported** | Guarded for attendance, overtime, requisition approve, offer approve and budget approve. Not guarded for configured Leave steps, expense, journal, payroll, vendor bill, payroll adjustments/tax relief, or the requisition publish-from-DRAFT shortcut. | **Phase 2 (W2 core).** The engine refuses to resolve the requester as approver. Domain separation-of-duties rules follow BQ-04. |
| Batch decisions | **Partially supported** | AP bulk executes with per-record permission re-check. The inbox has no bulk decide. | Bulk decide in the inbox only through per-record module endpoints (never an engine bypass). |
| No-code automation (arbitrary actions, field updates, webhooks) | — | — | **Defer / out of scope** |
| Procurement approvals (shown in S027 examples) | — | — | **Out of scope** (D2-022) |

## 3. Recommended Wave 2 boundary

*G0-05: proposed for approval.*

1. **Engine role = approver resolution and step tracking.** Domain records keep their own states and explicit actions. A domain service calls `resolve_approval_chain(trigger, record)` on submit, and moves to the next step through the engine. This is the Leave pattern, generalised.
2. **Supported triggers in Phase 2:**
   - LEAVE_REQUEST (existing)
   - ATTENDANCE_ADJUSTMENT
   - EXPENSE_CLAIM (manager stage; finance review stays permission-based)
   - JOB_REQUISITION
   - OFFER
   - BUDGET
   - *(optional)* VENDOR_BILL above a threshold

   Payroll and journals keep their hard-coded control gates.
3. **Approver types:** USER, ROLE (any active holder), REQUESTER_DEPARTMENT_HEAD, REQUESTER_MANAGER. Never the requester. Never a read-only role (already validated).
4. **Conditions:** department scope and amount band only.
5. **Escalation:** reminder plus overdue notice only.
6. **Migrations required:**
   - trigger enum and condition fields on `ApprovalWorkflowDefinition`;
   - `approver_type` on `ApprovalWorkflowStep`;
   - optional `escalation_role`.

   Existing Leave definitions migrate to `trigger=LEAVE_REQUEST`. *Approval needed before creating them.*
7. **Not built:** a generic rules engine, arbitrary actions, standing delegation calendars, parallel "any-of-N groups" beyond role holders, and SLA dashboards.

## 4. Risks if this is left as-is

- An institution admin can configure a Leave definition whose role step resolves to the requester (configured path has no self-exclusion).
- The settings UI implies that definitions apply to all modules, but they only affect Leave. This is a misleading control surface; label it in the UI until W2 lands.
- `due_after_hours` suggests SLAs that are never enforced.
