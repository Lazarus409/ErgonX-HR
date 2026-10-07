# Wave 0 — Phase 2 Test Matrix

## Current test and CI baseline (verified 2026-10-05)

| Item | State |
|---|---|
| Backend tests | `Ergonx-backend/tests/`: 60 test modules, **296 test functions**, plus 5 in `apps/*/tests.py`. pytest; `config.settings.test` (SQLite) locally; `@pytest.mark.postgresql` marker for PostgreSQL-only constraints |
| Backend CI | `Ergonx-backend/.github/workflows/backend.yml` runs on every push and PR: PostgreSQL 16 service → `makemigrations --check --dry-run` → `migrate` → `check` → `pytest` |
| OpenAPI gate | **None.** The schema has drifted to 33 errors and 171 warnings unnoticed. `tests/test_accounting.py` pins only the accounting operation count. |
| Frontend tests | **None.** No unit or component tests (0 `*.test.*` files); `package.json` has only `lint`. |
| Frontend CI | **None** in the frontend repo. It is unknown whether the monorepo root carries one; the current checkout has no root `.github`. |
| E2E | **None in the repos.** Browser verification used ad-hoc Playwright scripts kept in session scratchpads. |
| Known SQLite/PG gap | Postgres-only errors (e.g. `FOR UPDATE` on a nullable join) passed locally on SQLite before. CI on PG catches them, but only after push. |

### Existing coverage relevant to Phase 2 (keep green; do not lower)

- **Tenant isolation:** cross-institution access in 14 files; `tenant_mismatch` and `institution_suspended` asserted.
- **Module gating:** `module_disabled` in 7 files, including the accounting contract test that every operation requires the module.
- **Read-only role:** `read_only_role`. **Self-HR protection:** `self_hr_record_edit_not_allowed`.
- **Payroll:** immutability (`record_immutable`, FINALIZED); Ghana fail-closed (`test_ghana_payroll*`); run exceptions (`test_payroll_run_exceptions.py`).
- **Accounting:** balanced journals in 8 files; closed periods; mapping failure (`policy_not_applicable`); bank reconciliation sessions; AP bulk batch.
- **Recruitment:** requisition separation of duties; offer → hire.
- **Approvals:** leave review workflow and attendance adjustment review; approvals inbox.

## Matrix by wave

Legend:

- **Type:** U = unit/service; A = API (DRF client); PG = PostgreSQL-marked; E2E = browser; S = security-negative.
- **Exists?:** ✅ covered; ◐ partial; ❌ missing.

### Wave 1 — Design System

| Test | Type | Exists? | Notes |
|---|---|---|---|
| Typecheck + lint gate (`tsc --noEmit`, `eslint`) in CI | CI | ❌ | Add frontend workflow |
| State components render empty/error/loading/module-disabled/access-denied variants | Component | ❌ | Introduce Vitest + Testing Library (approval needed) |
| PWA worker never caches `/api/`, navigations or non-GET; offline page served | U (worker) | ◐ | Behaviour verified in PWA-001, but there is no automated test. Add a worker unit test. |
| No Stitch sample data in production bundles (grep gate for known sample names, e.g. "Academic Affairs") | CI | ❌ | Cheap guard for D2-024 |

### Wave 2 — Platform / Security

| Test | Type | Exists? |
|---|---|---|
| **Email OTP expiry**: code rejected after 5-minute TTL | U/A S | ❌ (no MFA tests at all) |
| **Email OTP reuse prevention**: consumed code rejected; issuing a new challenge voids the old one | U/A S | ❌ |
| **Email OTP attempt limit**: 6th attempt rejected even with the right code | U/A S | ❌ |
| **Email OTP resend throttling**: repeated login without a code within the cooldown does not issue or send a new code | A S | ❌ (feature missing) |
| **Login throttling**: N failed password or MFA attempts per account/IP → 429 | A S | ❌ (feature missing) |
| TOTP: invalid/drifted code rejected; setup confirm; disable audited | U/A | ❌ |
| **Session revocation**: revoked session's refresh returns 401; access expires; logout blacklists refresh | A S | ❌ (feature missing) |
| Password change/reset revokes other sessions (if adopted) | A S | ❌ |
| **Institution context**: `X-Institution-ID` for a non-member → `tenant_mismatch`; switching re-resolves permissions/modules in bootstrap | A S | ◐ |
| **Permission denial**: every new endpoint has a deny test for a role lacking the code, and the AUDITOR write-deny test | A S | ◐ (pattern exists) |
| Bootstrap `default_landing` resolution by effective permission (after BQ-01) | A | ❌ |
| Module dependency rules: CORE_HR non-disableable; dependants refused (MOD-01) | A | ❌ |
| Module toggle audited (MOD-02) | A | ❌ |
| Custom role cannot receive PRIVILEGED codes unless granted by IA (PERM-03) | A S | ❌ |
| Role-level data scope / read-only flags replace role-code checks (PERM-01/02), with a regression proving system roles behave identically | A | ❌ |
| Approval engine: trigger resolution, requester never approver, ROLE = any holder, escalation job notifies only | U/A | ◐ (`test_approval_platform.py` covers basic engine) |
| AuditLog append-only (update/delete refused; admin read-only) | U | ❌ |
| OpenAPI gate: `spectacular --validate` with zero errors in CI | CI | ❌ |
| Notifications: route_hint allow-list; recipient isolation; preference honoured | A | ◐ |

### Tenant isolation (cross-cutting, every wave)

| Test | Type | Exists? |
|---|---|---|
| Cross-institution record access returns 404/403 for every new model's list/retrieve/action | A S | ◐ (14 files; extend to each new endpoint) |
| Module disabled → `module_disabled` for every new endpoint, and data visible again after re-enable | A | ◐ |
| **Inactive membership** (SUSPENDED/INACTIVE) → no tenant access; bootstrap refuses | A S | ◐ (3 files touch statuses; add explicit API test) |
| Custom role with INSTITUTION scope vs EMPLOYEE SELF scope on leave/attendance/payslips/expenses | A S | ◐ |

### Wave 3 — HR / Self-Service

| Test | Type | Exists? |
|---|---|---|
| **Self-HR admin mutation protection** on update, delete, lifecycle actions, compensation and documents | A S | ◐ (`test_access_experience_foundation` covers update) |
| Employee create/update/deactivate audited with masked before/after | A | ❌ |
| **Leave policy checks**: max consecutive days; no policy → fail; insufficient balance → fail; review context returns pass/warn/fail | U/A | ✅ / ◐ (NOT_EVALUATED status missing) |
| Configured leave workflow never resolves the requester as approver | U | ❌ (current gap) |
| **Attendance adjustment approval**: approve/return/resubmit/delegate; self-decision refused; evidence rule | A | ✅ (`test_attendance_adjustment_review.py`) |
| **Finalized payroll dependency**: approving an adjustment whose date is inside a FINALIZED payroll period → refused (LC-ATT-01) | A | ❌ |
| Landing: Employee → Home/Me; IA/Director → Executive; operational → Insights | E2E | ❌ |

### Wave 4 — Recruitment

| Test | Type | Exists? |
|---|---|---|
| **Requisition approval before publish**: submitter cannot approve; PENDING → APPROVED → OPEN; DRAFT publish allowed only to approve-holders (or blocked, per BQ-06) | A | ✅ / ◐ |
| **Evaluation permissions**: scorecard submit requires `candidate_evaluation.create`; submitted scorecard locked; `GET candidates/{id}/scorecard` requires a permission (PERM-07) | A S | ◐ |
| **Offer conversion lineage**: hire creates Employee + Employment; offer, application and candidate linked; offer cannot be hired twice | A | ◐ (hire covered in 11 files; assert lineage explicitly) |
| Offer approval separation of duties | A | ✅ |
| Hard DELETE of posting, candidate, interview or offer refused (explicit `http_method_names`) | A | ❌ |

### Wave 5 — Payroll

| Test | Type | Exists? |
|---|---|---|
| **Blocking exceptions**: OPEN HIGH exception blocks `submit_review` (`payroll_exceptions_open`) | A | ✅ |
| **State transition restrictions**: calculate only from DRAFT; approve only UNDER_REVIEW; finalize only APPROVED; cancel never FINALIZED | A | ✅ / ◐ |
| **Immutability**: finalized run, records and payslips cannot change; exception update on FINALIZED refused | A | ✅ |
| **Ghana fail-closed**: unresolved overtime threshold, proration, unsupported pay basis and pension gaps fail the calculation, not guess | U | ✅ (`test_ghana_payroll*`) |
| Preparer ≠ approver (if BQ-04 adopts it) | A | ❌ |
| `return_for_correction` (if LC-PAY-01 adopted) | A | ❌ |
| Payroll → GL journal requires ACCOUNTING enabled and mappings; balanced | A | ✅ |

### Wave 6 — Accounting / Expenses

| Test | Type | Exists? |
|---|---|---|
| **Debit = credit** for every generated journal (expense, settlement, payroll, AP, AR) | U | ✅ (extend to new expense/settlement) |
| **Posted immutability**: POSTED journal and expense cannot be edited or voided; reversal links | A | ✅ |
| **Expense posting**: per-line Dr expense + optional Dr recoverable tax / Cr employee payable | U/A | ❌ (new model) |
| **Closed period**: posting/settling into CLOSED/LOCKED period → `period_closed`-style refusal | A | ✅ (cash transactions); ❌ for settle |
| **Mapping failure**: missing category account, missing `EMPLOYEE_PAYABLE`/`CASH` mapping, inactive account → fail closed, nothing posted | A | ◐ |
| **Settlement**: Dr payable / Cr bank; only from POSTED; idempotent; no "payment sent" semantics | A | ❌ |
| Expense self-service: claimant sees only own claims; manager stage resolves manager; claimant cannot approve own; finance review recoding audited | A S | ❌ |
| Non-base-currency expense refused (FIN-03) | A | ❌ |
| No hard delete of claims/lines after submit | A | ❌ |
| Journal creator ≠ approver (if BQ-04) | A | ❌ |

### Wave 7 — Advanced Finance

| Test | Type | Exists? |
|---|---|---|
| **Reconciliation invariants**: cannot complete with unmatched lines, missing closing balance or non-zero difference; match/unmatch audited | A | ✅ (`test_bank_reconciliation_sessions.py`) |
| Statement import handler (typed; rejects malformed rows) | A | ◐ |
| Budget actuals only from POSTED GL; approve SoD | A | ✅ |
| Financial report run; scheduled-run command | A | ✅ / ◐ |
| Unsupported export formats are not offered (UI) and rejected (API) | A/E2E | ❌ |

### Wave 8 — Reporting / Integrations

| Test | Type | Exists? |
|---|---|---|
| Report access: `report.all` read-only institution-wide; source-module gating; REPORTS-module rule (BQ-05) | A | ✅ / ❌ |
| Library sharing/publish permission (`report.publish`) | A | ✅ |
| Export jobs typed handlers; download permission | A | ◐ |

## Gate expectations

1. Every new endpoint ships with: an allow test, a permission-deny test, a cross-tenant test, a module-disabled test, and an audit assertion.
2. Every new state transition ships with a legal-transition test, an illegal-transition test (`invalid_state_transition`) and an idempotency test.
3. W2 adds three CI gates: the OpenAPI validation gate, the frontend type and lint gate, and a minimal Playwright smoke run against seeded demo data. Adding Playwright is a dependency change, so it needs approval.
