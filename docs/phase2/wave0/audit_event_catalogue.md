# Wave 0 — Audit Event Catalogue

## Mechanism

Evidence: `apps/audit/models.py`, `apps/audit/services.py`, `apps/audit/context.py` and `apps/audit/middleware.py`. The catalogue comes from an AST scan of every `record_audit_event(...)` call (`tools/inspect_audit.py`; raw output in `audit_event_inventory.tsv`).

- **Single store.** `AuditLog`, written only through `record_audit_event(actor, action, institution, entity, metadata, ip, user_agent)`, which is the only `AuditLog.objects.create` call site. Each record carries:
  - `entity_type` (model label) and `entity_id`;
  - IP address and user agent, captured from request context by the middleware;
  - a free-form JSON `metadata` field;
  - a timestamp from `BaseModel.created_at`.
- **Before/after.** There is no structured before/after column. Transitions conventionally store `{"from": ..., "to": ...}` through helpers (`accounting._transition`, `payroll._status_change_metadata`), and some events store changed field names. Field-level before/after is **not** captured for generic CRUD.
- **Generic CRUD** through `TenantModelViewSet` is **not** audited automatically. Only service-layer actions are.
- **Readers:** `GET /audit/` (`audit.view`), `GET /record-history/{type}/{id}/`, `GET /platform/audit/` (platform admin).

### Integrity findings

| ID | Finding | Action |
|---|---|---|
| AUD-01 | `AuditLog` is registered in Django admin with default (editable, deletable) `ModelAdmin`, and the model has no save/delete guard. The audit trail is not append-only. | W2: read-only admin (`has_change_permission`/`has_delete_permission` → False), a model `save()` refusing updates, and a `delete()` refusing deletes. Optionally a DB trigger on PostgreSQL. |
| AUD-02 | No authentication or security events: login success/failure, logout, refresh, password change/reset and MFA challenge are all unaudited (only MFA setup/enable/disable/method change are). | W2 (new events below). |
| AUD-03 | No events for employee create/update/deactivate, organization CRUD, leave type/policy config, schedule/shift config, module enable/disable, institution settings, or approval-workflow definition changes. | W2/W3 (new events below). |
| AUD-04 | No consistent before/after schema. | W2: standard `metadata.changes = {field: [before, after]}` for updates and `metadata.transition = {from, to}` for state changes, through one helper. |

## Current catalogue (188 distinct actions in 173 call sites)

###             else "payroll

| Action | Call site(s) | Metadata |
|---|---|---|
| `            else "payroll.tax_relief_claim.rejected"` | apps/payroll/services.py:1245 | yes |

### access

| Action | Call site(s) | Metadata |
|---|---|---|
| `access.invitation.created` | apps/institutions/services.py:1103 | yes |
| `access.invitation.revoked` | apps/institutions/services.py:1117 | yes |
| `access.membership.invited` | apps/institutions/services.py:1080 | yes |
| `access.membership.updated` | apps/institutions/services.py:634 | yes |
| `access.requested` | apps/institutions/access.py:58 | yes |
| `access.role.created` | apps/institutions/services.py:567 | yes |
| `access.role.updated` | apps/institutions/services.py:605 | yes |

### account

| Action | Call site(s) | Metadata |
|---|---|---|
| `account.mfa.disabled` | apps/accounts/views.py:134 | yes |
| `account.mfa.enabled` | apps/accounts/views.py:99 | yes |
| `account.mfa.method_changed` | apps/accounts/views.py:128 | yes |
| `account.mfa.setup_started` | apps/accounts/views.py:87 | yes |

### accounting

| Action | Call site(s) | Metadata |
|---|---|---|
| `<entity>.attachment_added (journal / vendor_bill / invoice)` | apps/accounting/views.py:327 | yes |
| `accounting.account.created` | apps/accounting/services.py:345 | — |
| `accounting.account.updated` | apps/accounting/services.py:362 | yes |
| `accounting.bank_account.created` | apps/accounting/services.py:1302 | — |
| `accounting.bank_account.updated` | apps/accounting/services.py:1323 | yes |
| `accounting.bank_statement_line.flagged` | apps/accounting/services.py:2213 | yes |
| `accounting.bank_statement_line.imported` | apps/accounting/services.py:1624 | yes |
| `accounting.bank_statement_line.matched` | apps/accounting/services.py:1655 | yes |
| `accounting.bank_statement_line.unflagged` | apps/accounting/services.py:2213 | yes |
| `accounting.bank_statement_line.unmatched` | apps/accounting/services.py:1673 | yes |
| `accounting.batch_job.completed` | apps/accounting/batch.py:212 | yes |
| `accounting.budget.approved` | apps/accounting/budgets.py:127 | yes |
| `accounting.budget.created` | apps/accounting/budgets.py:197 | — |
| `accounting.budget.note_added` | apps/accounting/budgets.py:304 | — |
| `accounting.budget.returned` | apps/accounting/budgets.py:127 | yes |
| `accounting.budget.submitted` | apps/accounting/budgets.py:105 | — |
| `accounting.budget.updated` | apps/accounting/budgets.py:220 | yes |
| `accounting.configuration.changed` | apps/accounting/services.py:144 | yes |
| `accounting.customer.created` | apps/accounting/services.py:1164 | — |
| `accounting.customer.updated` | apps/accounting/services.py:1175 | — |
| `accounting.expense.approved` | apps/accounting/services.py:1765 | yes |
| `accounting.expense.created` | apps/accounting/services.py:1721 | — |
| `accounting.expense.posted` | apps/accounting/services.py:1798 | yes |
| `accounting.expense.rejected` | apps/accounting/services.py:1779 | yes |
| `accounting.expense.submitted` | apps/accounting/services.py:1751 | yes |
| `accounting.expense.updated` | apps/accounting/services.py:1736 | — |
| `accounting.financial_report.created` | apps/accounting/reporting.py:260 | — |
| `accounting.financial_report.run` | apps/accounting/reporting.py:198 | yes |
| `accounting.financial_report.updated` | apps/accounting/reporting.py:277 | yes |
| `accounting.fiscal_year.closed` | apps/accounting/services.py:787 | yes |
| `accounting.fiscal_year.created` | apps/accounting/services.py:381 | — |
| `accounting.invoice.created` | apps/accounting/services.py:1211 | — |
| `accounting.invoice.held` | apps/accounting/services.py:1967 | yes |
| `accounting.invoice.issued` | apps/accounting/services.py:1276 | yes |
| `accounting.invoice.released` | apps/accounting/services.py:1967 | yes |
| `accounting.invoice.reminder_added` | apps/accounting/services.py:2018 | yes |
| `accounting.invoice.reminder_cancelled` | apps/accounting/services.py:2032 | — |
| `accounting.invoice.reminder_done` | apps/accounting/services.py:2032 | — |
| `accounting.invoice.sent` | apps/accounting/services.py:2004 | yes |
| `accounting.invoice.settlement_updated` | apps/accounting/services.py:1424 | yes |
| `accounting.invoice.updated` | apps/accounting/services.py:1234 | — |
| `accounting.invoice.voided` | apps/accounting/services.py:1290 | yes |
| `accounting.journal.approved` | apps/accounting/services.py:586 | yes |
| `accounting.journal.attachment_added` | apps/accounting/views.py:1484 | yes |
| `accounting.journal.created` | apps/accounting/services.py:471 | yes |
| `accounting.journal.note_added` | apps/accounting/views.py:1456 | — |
| `accounting.journal.posted` | apps/accounting/services.py:646 | yes |
| `accounting.journal.reversal_created` | apps/accounting/services.py:697 | yes |
| `accounting.journal.reversed` | apps/accounting/services.py:635 | yes |
| `accounting.journal.submitted` | apps/accounting/services.py:554 | yes |
| `accounting.journal.updated` | apps/accounting/services.py:524 | — |
| `accounting.journal.voided` | apps/accounting/services.py:721 | yes |
| `accounting.payment.posted` | apps/accounting/services.py:1489 | yes |
| `accounting.payment.voided` | apps/accounting/services.py:1582 | yes |
| `accounting.payroll_journal.generated` | apps/accounting/services.py:1877 | yes |
| `accounting.payroll_mappings.applied` | apps/accounting/services.py:1820 | yes |
| `accounting.period.closed` | apps/accounting/services.py:763 | yes |
| `accounting.period.created` | apps/accounting/services.py:398 | — |
| `accounting.period.locked` | apps/accounting/services.py:763 | yes |
| `accounting.period.open (reopen)` | apps/accounting/services.py:763 | yes |
| `accounting.preset.applied` | apps/accounting/services.py:316 | yes |
| `accounting.receipt.posted` | apps/accounting/services.py:1550 | yes |
| `accounting.receipt.voided` | apps/accounting/services.py:1582 | yes |
| `accounting.reconciliation.completed` | apps/accounting/services.py:2150 | yes |
| `accounting.reconciliation.started` | apps/accounting/services.py:2087 | yes |
| `accounting.reconciliation.statement_imported` | apps/accounting/services.py:2197 | yes |
| `accounting.vat_withholding_certificate.issued` | apps/accounting/services.py:1696 | yes |
| `accounting.vat_withholding_certificate.voided` | apps/accounting/services.py:1711 | — |
| `accounting.vendor.created` | apps/accounting/services.py:802 | — |
| `accounting.vendor.updated` | apps/accounting/services.py:819 | yes |
| `accounting.vendor_bill.approved` | apps/accounting/services.py:1015 | yes |
| `accounting.vendor_bill.created` | apps/accounting/services.py:901 | yes |
| `accounting.vendor_bill.held` | apps/accounting/services.py:1925 | yes |
| `accounting.vendor_bill.payment_scheduled` | apps/accounting/services.py:1943 | yes |
| `accounting.vendor_bill.posted` | apps/accounting/services.py:1125 | yes |
| `accounting.vendor_bill.rejected` | apps/accounting/services.py:1896 | yes |
| `accounting.vendor_bill.released` | apps/accounting/services.py:1925 | yes |
| `accounting.vendor_bill.revised` | apps/accounting/services.py:1910 | yes |
| `accounting.vendor_bill.settlement_updated` | apps/accounting/services.py:1394 | yes |
| `accounting.vendor_bill.submitted` | apps/accounting/services.py:981 | yes |
| `accounting.vendor_bill.updated` | apps/accounting/services.py:936 | yes |
| `accounting.vendor_bill.voided` | apps/accounting/services.py:1149 | yes |

### attendance

| Action | Call site(s) | Metadata |
|---|---|---|
| `attendance.adjustment.decided` | apps/attendance/services.py:371 | yes |
| `attendance.adjustment.delegated` | apps/attendance/services.py:521 | yes |
| `attendance.adjustment.requested` | apps/attendance/services.py:308 | — |
| `attendance.adjustment.resubmitted` | apps/attendance/services.py:497 | — |
| `attendance.adjustment.returned` | apps/attendance/services.py:465 | — |
| `attendance.clocked_in` | apps/attendance/services.py:188 | yes |
| `attendance.clocked_out` | apps/attendance/services.py:215 | yes |
| `attendance.date_classified` | apps/attendance/services.py:250 | yes |
| `attendance.overtime.decided` | apps/attendance/services.py:404 | yes |

### compensation

| Action | Call site(s) | Metadata |
|---|---|---|
| `compensation.component.override.changed` | apps/compensation/services.py:158 | yes |
| `compensation.component.override.ended` | apps/compensation/services.py:181 | — |
| `compensation.configuration.created` | apps/compensation/views.py:41 | — |
| `compensation.configuration.deactivated` | apps/compensation/views.py:59 | — |
| `compensation.configuration.updated` | apps/compensation/views.py:50 | — |
| `compensation.employee.changed` | apps/compensation/services.py:86 | yes |

### employee

| Action | Call site(s) | Metadata |
|---|---|---|
| `employee.document.removed` | apps/employees/views.py:184 | yes |
| `employee.document.uploaded` | apps/employees/views.py:147 | yes |
| `employee.offboarding.completed` | apps/employees/services.py:209 | — |
| `employee.offboarding.initiated` | apps/employees/services.py:173 | — |
| `employee.onboarding.completed` | apps/employees/services.py:150 | — |
| `employee.onboarding.started` | apps/employees/services.py:125 | — |
| `employee.rehired` | apps/employees/services.py:232 | yes |

### institution

| Action | Call site(s) | Metadata |
|---|---|---|
| `institution.onboarding.validated` | apps/institutions/services.py:985 | yes |

### leave

| Action | Call site(s) | Metadata |
|---|---|---|
| `leave.balance.accrued` | apps/leave/services.py:550 | yes |
| `leave.balance.carried_forward` | apps/leave/services.py:590 | yes |
| `leave.request.approved_step` | apps/leave/services.py:438 | yes |
| `leave.request.cancelled` | apps/leave/services.py:508 | — |
| `leave.request.changes_requested` | apps/leave/services.py:672 | yes |
| `leave.request.commented` | apps/leave/services.py:733 | — |
| `leave.request.created` | apps/leave/services.py:323 | — |
| `leave.request.delegated` | apps/leave/services.py:716 | yes |
| `leave.request.rejected` | apps/leave/services.py:477 | yes |
| `leave.request.submitted` | apps/leave/services.py:384 | yes |
| `leave.request.updated` | apps/leave/services.py:632 | yes |

### payroll

| Action | Call site(s) | Metadata |
|---|---|---|
| `payroll.adjustment.applied` | apps/payroll/services.py:576 | yes |
| `payroll.adjustment.approved` | apps/payroll/services.py:1030 | yes |
| `payroll.adjustment.created` | apps/payroll/services.py:955 | — |
| `payroll.adjustment.rejected` | apps/payroll/services.py:1030 | yes |
| `payroll.adjustment.submitted` | apps/payroll/services.py:995 | yes |
| `payroll.adjustment.unapplied` | apps/payroll/services.py:850 | yes |
| `payroll.configuration.changed` | apps/payroll/services.py:183 | yes |
| `payroll.employee_profile.changed` | apps/payroll/services.py:250 | yes |
| `payroll.exception.updated` | apps/payroll/services.py:1389 | yes |
| `payroll.period.created` | apps/payroll/services.py:276 | — |
| `payroll.run.approved` | apps/payroll/services.py:669 | yes |
| `payroll.run.calculated` | apps/payroll/services.py:590 | yes |
| `payroll.run.cancelled` | apps/payroll/services.py:866 | yes |
| `payroll.run.created` | apps/payroll/services.py:339 | yes |
| `payroll.run.finalized` | apps/payroll/services.py:808 | yes |
| `payroll.run.submitted_for_review` | apps/payroll/services.py:632 | yes |
| `payroll.run.validated` | apps/payroll/services.py:1366 | yes |
| `payroll.tax_relief_claim.created` | apps/payroll/services.py:1127 | — |
| `payroll.tax_relief_claim.submitted` | apps/payroll/services.py:1161 | yes |

### platform

| Action | Call site(s) | Metadata |
|---|---|---|
| `platform.reactivate` | apps/accounts/platform.py:55 | yes |
| `platform.suspend` | apps/accounts/platform.py:55 | yes |

### recruitment

| Action | Call site(s) | Metadata |
|---|---|---|
| `recruitment.application.rejected` | apps/recruitment/services.py:159 | — |
| `recruitment.application.scorecard_submitted` | apps/recruitment/services.py:517 | — |
| `recruitment.application.stage_moved` | apps/recruitment/services.py:128 | yes |
| `recruitment.application.submitted` | apps/recruitment/services.py:106 | yes |
| `recruitment.application.withdrawn` | apps/recruitment/services.py:143 | — |
| `recruitment.candidate.document_added` | apps/recruitment/services.py:547 | yes |
| `recruitment.candidate.document_removed` | apps/recruitment/services.py:557 | yes |
| `recruitment.evaluation.recorded` | apps/recruitment/services.py:190 | yes |
| `recruitment.interview.completed / cancelled / no_show` | apps/recruitment/services.py:177 | — |
| `recruitment.interview.drafted` | apps/recruitment/services.py:707 | yes |
| `recruitment.interview.rescheduled` | apps/recruitment/services.py:707 | yes |
| `recruitment.interview.scheduled` | apps/recruitment/services.py:707 | yes |
| `recruitment.job_posting.cancelled` | apps/recruitment/services.py:83 | — |
| `recruitment.job_posting.closed` | apps/recruitment/services.py:83 | — |
| `recruitment.job_posting.published` | apps/recruitment/services.py:67 | — |
| `recruitment.offer.accepted / declined` | apps/recruitment/services.py:241 | yes |
| `recruitment.offer.approved` | apps/recruitment/services.py:757 | yes |
| `recruitment.offer.extended` | apps/recruitment/services.py:215 | — |
| `recruitment.offer.hired` | apps/recruitment/services.py:322 | yes |
| `recruitment.offer.letter_generated` | apps/recruitment/services.py:825 | — |
| `recruitment.offer.returned` | apps/recruitment/services.py:774 | yes |
| `recruitment.offer.submitted` | apps/recruitment/services.py:733 | — |
| `recruitment.offer.withdrawn` | apps/recruitment/services.py:258 | — |
| `recruitment.requisition.approved` | apps/recruitment/services.py:382 | yes |
| `recruitment.requisition.returned` | apps/recruitment/services.py:399 | yes |
| `recruitment.requisition.submitted` | apps/recruitment/services.py:358 | — |
| `recruitment.requisition.team_added` | apps/recruitment/services.py:414 | yes |
| `recruitment.requisition.team_removed` | apps/recruitment/services.py:425 | yes |

### reports

| Action | Call site(s) | Metadata |
|---|---|---|
| `reports.analytics_item.created` | apps/reports/library.py:395; apps/reports/library.py:461 | yes |
| `reports.analytics_item.refreshed` | apps/reports/library.py:302 | yes |
| `reports.analytics_item.shared` | apps/reports/library.py:495 | yes |
| `reports.analytics_item.unshared` | apps/reports/library.py:495 | yes |
| `reports.analytics_item.updated` | apps/reports/library.py:420 | yes |

### schedule

| Action | Call site(s) | Metadata |
|---|---|---|
| `schedule.assignment.changed` | apps/scheduling/services.py:49 | yes |
| `schedule.assignment.created` | apps/scheduling/services.py:16 | — |

### workflows

| Action | Call site(s) | Metadata |
|---|---|---|
| `APPROVAL_APPROVE` | apps/workflows/services.py:58 | yes |
| `APPROVAL_CANCEL` | apps/workflows/services.py:58 | yes |
| `APPROVAL_REJECT` | apps/workflows/services.py:58 | yes |
| `APPROVAL_REQUESTED` | apps/workflows/services.py:24 | — |

## New Phase 2 events (only the ones that do not already exist)

Naming follows the existing `<domain>.<entity>.<verb>` convention. Every event needs:

- an actor;
- the institution (null for pre-tenant auth events);
- the entity;
- `metadata.transition` or `metadata.changes` as applicable.

Secrets, OTP codes, tokens and passwords are **never** stored.

| Event | Trigger | Required metadata | Wave |
|---|---|---|---|
| `account.login.succeeded` | successful login (after MFA) | method (password / totp / email_otp), remember flag; no token values | W2 |
| `account.login.failed` | bad password / bad MFA code | reason code (`invalid_credentials`, `mfa_invalid`, `email_otp_invalid`), attempt count; email hash, not plaintext, when the user is unknown | W2 |
| `account.mfa.email_otp.issued` | email OTP challenge created (login or enrolment) | purpose, masked destination, expires_at | W2 |
| `account.mfa.email_otp.verified` / `.failed` / `.locked` | consume success / mismatch / max attempts reached | attempts | W2 |
| `account.logout` | BFF logout (needs a backend call) | session id | W2 |
| `account.session.revoked` | user or admin revokes a session/token family | session id, revoked_by, reason | W2 |
| `account.password.changed` / `account.password.reset_requested` / `account.password.reset_completed` | password flows | — (never the password) | W2 |
| `institution.module.enabled` / `institution.module.disabled` | module toggle | module_code, transition | W2 |
| `institution.setting.changed` | institution settings PATCH | key, changes (masked if `is_sensitive`) | W2 |
| `approval_workflow.created` / `.updated` / `.deactivated`; `approval_workflow_step.changed` | engine configuration | changes | W2 |
| `approval.escalated` | overdue step reminder/escalation job | step, due_at, notified | W2 |
| `employee.created` / `employee.updated` / `employee.deactivated` | HR CRUD | changes (PII fields masked in metadata) | W3 |
| `leave.policy.changed`, `leave.type.changed` | leave configuration | changes | W3 |
| `attendance.adjustment.blocked_finalized_payroll` | approval refused by LC-ATT-01 guard | payroll_run_id | W3 |
| `payroll.run.returned_for_correction` | only if LC-PAY-01 is approved | note, transition | W5 |
| `accounting.expense.returned`, `.manager_approved`, `.finance_reviewed`, `.recoded`, `.settled`, `.reversed` | Expense 2.0 transitions | transition; recoded = changes (account/category/tax); settled = settlement ref, bank account, journal id | W6 |
| `accounting.journal.rejected` | only if LC-JNL-01 is approved | reason | W6 |
| `accounting.module_mapping.changed` | institution override of a system mapping code (ERD-005 resolution) | mapping_code, changes | W6 |

**Already exist — do not duplicate.** v3 listed these as Phase 2 examples, but they are already emitted:

- job requisition submitted/approved/published: `recruitment.requisition.submitted/approved` and `recruitment.job_posting.published`;
- attendance adjustment submitted/applied: `attendance.adjustment.requested/decided`;
- payroll exception resolved: `payroll.exception.updated` (status in metadata);
- reconciliation match/unmatch/completion: `accounting.bank_statement_line.matched/unmatched` and `accounting.reconciliation.completed`;
- budget approval: `accounting.budget.approved/returned`.

Budget *revision* has no event because budget revisions don't exist.
