# ErgonX Phase 2 — Wave 0 Reconciliation Report

**Date:** 2026-10-05
**Overall status: PARTIAL.** The contract is reconciled to the repository, but several high-risk decisions and security sign-offs are still open (see §5 and §6).

> **Update 2026-10-05:** all §6 recommendations were approved. See `DECISIONS.md`. Gates are now 10 COMPLETE and 2 PARTIAL; G0-02 and G0-06 remain as implementation items.

## Scope and evidence base

| Source | Version inspected |
|---|---|
| Backend | `Ergonx-backend`, branch `release-candidate` @ `a90f857`. Uncommitted, not touched: `apps/institutions/services.py` (onboarding setup-owner roles), untracked `migrations/0041_hr_admin_role_name.py`, `tests/test_onboarding_setup_owners.py` |
| Frontend | `ergonx-frontend`, branch `ui/concept-redesign` @ `420307a`. Uncommitted, not touched: `src/app/onboarding/page.tsx` |
| Contract | `ErgonX_Phase_2_Wave_0_Technical_Contract_Pack_v3_Reconciled.xlsx` (all 15 sheets) |
| Screens | `ErgonX_Phase_2_Stitch_Master_Screen_Pack_S001-S066` (manifest, variant index, 66 `metadata.json`) |
| Register | `Ergonx-backend/DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md` |
| Live OpenAPI | regenerated into scratch (`spectacular --validate`); repo file untouched |

Nothing in either repository was changed. This pass created no migrations, models, routes, permissions or behaviour changes. All output is under `docs/phase2/wave0/`, including read-only inspection scripts in `tools/`.

### Deliverables

| File | Contents |
|---|---|
| `frontend_route_reconciliation.md` / `.csv` / `.json` | 66-screen route map (A) |
| `api_reconciliation.md` / `.json` | 45 capability rows + decisions (B) |
| `api_operation_inventory.json` | 664 live operations: view, module, permission, serializer |
| `permission_matrix_final.md` + `permission_inventory.json` | 142 codes × 8 roles × endpoints (C) |
| `lifecycle_matrix_final.md` + `state_enum_inventory.txt` | 18 state machines (D) |
| `approval_engine_gap_analysis.md` | (E) |
| `expense_management_gap_analysis.md` | (F) |
| `module_dependency_matrix.md` | (G) |
| `audit_event_catalogue.md` + `audit_event_inventory.tsv` | 188 actions (H) |
| `phase2_test_matrix.md` | (I) |
| `tools/*.py` | reproducible, read-only generators |

---

## 1. Summary

| Metric | Result |
|---|---|
| **Stitch screens reviewed** | 66 / 66 |
| Existing screens (restyle only) | **50** |
| Existing screens requiring extension | **8**: S013 Executive, S023 Adjustment review, S027 Approval workflows, S031 Insights, S041 Modules, S043 Security Center, S056 Notifications, S061 Transitions pattern |
| New routes required | **0** — every Stitch route maps to an established family (`/me/*`, `/hr/employees`, `/accounting/payables|receivables|banking|reports`, `/recruitment/job-postings`, `/dashboard`, `/settings/*`) |
| Variant screens merged | **7**: S004→S059, S005→S010, S006→S009, S007→S011, S063→S047, S064→S066, S065→S015 |
| Deferred screens | **1**: S030 public careers application |
| Deferred features inside kept screens | performance trajectory (S024), healthcare-proxy and escalation order (S025), identity verification (S038), credit notes (S029), payroll "Paid" state, external calendars (S034), reconciliation reopen (S008), PDF/XLSX/XBRL exports (S019/S054) |
| Live API surface | 664 operations / 450 paths |
| Existing API contracts (capability rows) | **28** EXISTING |
| API extensions required | **16** EXISTING — EXTEND |
| New APIs required | **1** NEW capability (active sessions list/revoke), plus new *actions* inside extensions: logout revocation, expense settle / return / finance-review / claim lines / receipts, approval-engine trigger configuration |
| Superseded v3 API proposals | 9 (`/me/context/`, `/insights/`, `/recruitment/requisitions/`, `/policy-checks/`, `POST /review/` ×2, `/payroll/exceptions/:id/resolve/`, `/bank-statements/` + `/reconciliations/:id/matches/`, generic `/offers/:id/action/`) |
| Existing permissions | **142** codes, 8 system roles |
| New permissions required | **3**: `expense.claim_own`, `expense.finance_review`, `expense.settle` (+ optional `dashboard.insights.view`). 11 v3-proposed codes are superseded by existing ones. |
| Existing state machines | 18 reviewed; all have explicit action endpoints, locked services and immutability on final states |
| State-machine extensions required | **1 mandatory** (Expense: FINANCE_REVIEW, RETURNED, SETTLED) + **1 guard** (attendance adjustment vs finalized payroll) + **2 optional** (payroll return-for-correction, journal reject) + **2 deferred** (credit note, reconciliation reopen) |
| Approval-engine gaps | trigger model, conditions, ROLE=any-holder, manager/department-head approver types, RETURN, escalation job, definition audit, requester-never-approver |
| Expense gaps | 22 items (E-01…E-22): 8 New, 8 Extend, 4 Existing, 1 Not needed, 1 Deferred (E-17 = currency guard, FIN-03) |
| Module dependency findings | MOD-01 (no dependency validation; CORE_HR can be disabled → self-lockout), MOD-02 (toggle unaudited), MOD-03 (REPORTS gating inconsistent), MOD-04, MOD-05 |
| Audit | 188 existing actions / 173 call sites; 34 new Phase 2 events; AUD-01 (AuditLog mutable via admin), AUD-02 (no auth events), AUD-03 (no CRUD/config events), AUD-04 (no before/after schema) |
| Testing gaps | **zero MFA tests**; no throttling/session tests; no frontend tests or CI; no OpenAPI CI gate; no E2E in repo |

## 2. What v3 got wrong (the repository is ahead of the contract)

These v3 rows were classed NEW or VERIFY but are **already implemented**. They are recorded as RESOLVED below.

- **Email OTP.** Implemented: `UserMFA.Method.EMAIL_OTP` and `EmailOTPChallenge` (digest, 5-minute TTL, 5 attempts, single-use).
- **JobRequisition.** Implemented as the JobPosting DRAFT → PENDING_APPROVAL → APPROVED → OPEN lifecycle with hiring-plan fields.
- **Structured evaluation.** `RecruitmentCompetency` + `CompetencyRating` scorecards.
- **Payroll exception engine.** `PayrollRunException`; HIGH-severity exceptions block review.
- **Bank reconciliation sessions.** Statement import, suggestions, match/unmatch, complete with invariants.
- **Budgets.** Budget, lines, approval and actuals from posted GL.
- **Report catalogue and sharing.** `AnalyticsItem`, `/report-library/`, `report.publish`, scheduled refresh.
- **Attendance adjustment governance.** Evidence, return, resubmit and delegate.
- **Leave review.** Policy and balance checks in the review context, delegate, request-changes.
- **Approvals inbox.** Cross-module.
- **Insights.** `/home/insights/` with permission-filtered sections.

v3 was also wrong in these places:

- It counted 106 frontend pages. There are 144.
- It said OpenAPI validates with zero errors. It now reports 33 errors and 171 warnings, and the committed schema is stale.
- It assumed Recruitment Officer and Payroll Officer roles. These do not exist.
- The manifest lists S065 as a variant of S008. It is a variant of S015.

---

## 3. Final discrepancy table

Priority: P0 must fix before the dependent wave ships; P1 in its wave; P2 when convenient.

| ID | Area | Finding | Current state | Target state | Action | Priority | Wave | Risk | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| W0-SEC-01 | Security | No rate limiting on login. Email OTP can be re-issued without limit (each issue resets to 5 attempts), and TOTP codes can be guessed without limit once the password is known. | No `DEFAULT_THROTTLE_*`; `LoginView` unthrottled; `issue_email_otp` has no cooldown | Per-account + per-IP login throttle; OTP resend cooldown; per-hour issue cap; lockout window | Add DRF throttles + cooldown in the accounts domain; audit failures | **P0** | W2 | Account takeover / email bombing | `accounts/views.py` L59; `accounts/serializers.py` L47-77; `config/settings/base.py` | IMPLEMENT |
| W0-SEC-02 | Security | Logout does not revoke the refresh token; there is no session registry or revocation | BFF clears cookies only; simplejwt blacklist app installed but unused at logout | Server-side logout blacklist + session list/revoke (D2-011) | New session registry API; BFF calls backend on logout | **P0** | W2 | Stolen refresh token valid to expiry | `route.ts` L90; `base.py` L39/L174 | IMPLEMENT |
| W0-SEC-03 | Security | Email OTP destination returned unmasked; no OTP/login/password audit | `email` in PATCH response; only MFA-config events | Masked destination; auth event set | Mask + add events (audit catalogue) | P1 | W2 | Info leak; no forensic trail | `accounts/views.py` L113-118 | IMPLEMENT |
| W0-SEC-04 | Security | MFA can be disabled with only an active session (no fresh factor) | `DELETE /auth/security/mfa/` | Require current password or code | Step-up on disable | P1 | W2 | Session theft → MFA removal | `accounts/views.py` L131 | IMPLEMENT |
| W0-SEC-05 | MFA (D2-010) | Email OTP declared NEW in v3 | Implemented | Hardened (SEC-01/03) | Re-classify | — | W2 | — | `accounts/models.py` L47 | RESOLVED |
| W0-AUD-01 | Audit | AuditLog is editable/deletable (default Django admin; no model guard) | mutable | append-only | Read-only admin + model guards | P1 | W2 | Tamperable trail | `audit/admin.py`; `audit/models.py` | IMPLEMENT |
| W0-AUD-02 | Audit | No auth, CRUD, config, module or workflow-definition events; no before/after standard | 188 action codes, service-layer only | Events in catalogue §New + `metadata.changes` helper | Add per wave | P1 | W2–W6 | Incomplete oversight | `audit_event_catalogue.md` | IMPLEMENT |
| W0-PERM-01 | RBAC | Row scope chosen by role code (EMPLOYEE / DEPARTMENT_HEAD); custom roles always INSTITUTION | `common/scoping.py` ROLE_DATA_SCOPES | Scope stored on Role | Role field + migration (approval) | P1 | W2 | Over-exposure through cloned roles | scoping.py L25 | BLOCKED (BQ-11) |
| W0-PERM-02 | RBAC | Read-only keyed on role code AUDITOR | READ_ONLY_ROLES | Role flag | Role field + migration | P2 | W2 | Custom auditors can write | permissions.py L8 | BLOCKED (BQ-11) |
| W0-PERM-03 | RBAC | Only `audit.view` is PRIVILEGED; any code is delegable to custom roles, including `settings.roles.manage` | classification unused | PRIVILEGED codes grantable only by IA; settings.* reclassified | Data migration + service rule | P1 | W2 | Privilege escalation by delegated role managers | services `_validate_delegable_permissions`; migration 0033 | IMPLEMENT |
| W0-PERM-04 | Dashboards | Locked landing rule not implemented; AUDITOR holds `dashboard.executive.view` | `default_landing` always HOME | Permission-based landing per locked decision | Bootstrap landing resolver | P1 | W3 | Wrong landing; rule unenforceable as is | `accounts/views.py` L520; ROLE_PERMISSION_CODES | BLOCKED (BQ-01) |
| W0-PERM-05 | RBAC | `settings.notifications.manage`, `settings.security.manage` enforced nowhere | dead codes | used or retired | decide with W2 security settings | P2 | W2 | Misleading role editor | permission_inventory.json | IMPLEMENT |
| W0-PERM-06 | RBAC | Scorecard GET resolves to no permission; scorecard POST needs only `candidate.view` | weak | `candidate.view` / `candidate_evaluation.create` | Tighten view permissions | P1 | W4 | Evaluation tampering by viewers | api_operation_inventory.json | IMPLEMENT |
| W0-SOD-01 | Governance | No preparer≠approver for payroll, journals, expenses, vendor bills; system journals self-approved; HR_ADMIN can run payroll end to end | partial (requisition/offer/budget/attendance guarded) | Policy-driven SoD | Decide policy, then guards | P1 | W5/W6 | Fraud / control weakness | services; approval gap analysis | BLOCKED (BQ-04) |
| W0-API-01 | OpenAPI | Live schema 33 errors / 171 warnings; 4 views missing; committed schema stale (2026-09-25); no CI gate | drift | valid schema + CI gate | Declarations + regenerate + gate (non-behavioural) | P1 | W2 | Frontend/consumers lack contract | spectacular output | IMPLEMENT |
| W0-API-02 | API | Hard DELETE on JobPosting/Candidate/Interview/Offer/ApprovalRequest/Import/Export refused only because the permission code does not exist | accidental 403 | explicit `http_method_names` | Remove DELETE routes | P2 | W2 | A future code addition would enable hard delete | api_reconciliation.md | IMPLEMENT |
| W0-API-03 | API | Search mounted twice (`/search/`, `/institutions/search/`) | duplicate | one path | retire one | P2 | W2 | Contract ambiguity | v1_urls.py | IMPLEMENT |
| W0-API-04 | API | v3 proposals duplicate existing endpoints (9) | — | keep working paths | Superseded | — | — | — | api_reconciliation.json | RESOLVED |
| W0-MOD-01 | Modules | No dependency validation; CORE_HR can be disabled → module/role/member management locked | none | CORE_HR non-disableable; dependants require CORE_HR | Service rule + error code | P1 | W2 | Tenant self-lockout | `InstitutionModuleViewSet` | IMPLEMENT |
| W0-MOD-02 | Modules | Module toggle unaudited | none | `institution.module.enabled/disabled` | Add event | P1 | W2 | Untraceable scope changes | idem | IMPLEMENT |
| W0-MOD-03 | Modules | REPORTS gating inconsistent | `/reports/*` ignore REPORTS | consistent rule | Decide | P2 | W2 | Confusing control | `reports/views.py` | BLOCKED (BQ-05) |
| W0-APR-01 | Approvals | Generic engine fed by no module; triggers implicit; conditions absent; escalation inert; RETURN unused; definitions unaudited (D2-012) | partial | bounded engine (§3 of gap analysis) | Extend models (migration) | P0 | W2 | Misleading settings; no manager routing for expenses | approval_engine_gap_analysis.md | IMPLEMENT |
| W0-APR-02 | Approvals | Configured leave steps can resolve the requester; ROLE steps resolve to the earliest-joined member only | gap | requester never approver; any holder | Fix resolver | P1 | W2 | Self-approval | `leave/services.py` L189-223 | IMPLEMENT |
| W0-LC-01 | Attendance (D2-016) | Adjustment governance | Implemented (evidence/return/resubmit/delegate) | + finalized-payroll guard | Guard when attendance feeds pay | P1 | W3 | Silent history rewrite once linked | `attendance/services.py` L335 | IMPLEMENT |
| W0-LC-02 | Payroll (D2-017) | Structured exception engine | Implemented | — | — | — | — | — | `PayrollRunException`; test_payroll_run_exceptions | RESOLVED |
| W0-LC-03 | Payroll | No return-for-correction; "Paid" state absent | cancel + recreate | optional | Decide with BQ-04 | P2 | W5 | UX friction | lifecycle §10 | ACCEPTED |
| W0-EXP-01 | Expenses (D2-018) | Flat cash-paid expense; no claimant, items, categories, policy, manager stage, finance review, settlement, self-service | see gap analysis | Locked 7-stage target | Expense 2.0 | **P0** | W6 | Core Phase 2 scope | expense_management_gap_analysis.md | BLOCKED (BQ-02, BQ-03) |
| W0-EXP-02 | Expenses | Currency not checked against base currency | raw amount posted | fail closed or FX | Guard | P1 | W6 (can ship W2) | Ledger misstatement | `post_expense` | IMPLEMENT |
| W0-EXP-03 | Expenses | No self-approval guard on approve | gap | guard | Add guard | P1 | W6 | Self-approval | `approve_expense` | IMPLEMENT |
| W0-ACC-01 | Accounting (D2-004 / ERD-005) | Account ↔ template provenance by code only | fail-closed code match | provenance field or ratified code mapping | Decide | P1 | W6 | Mapping breaks on recode | register ERD-005 | BLOCKED (BQ-09) |
| W0-ACC-02 | AR | No credit notes; issued invoices immutable | void DRAFT only | credit note | Defer; hide "Issue credit" | P2 | W7+ | — | `void_invoice` | DEFER |
| W0-REC-01 | Recruitment (D2-013/014) | Requisition + structured scorecards | Implemented on JobPosting/Competency | — | — | — | — | — | test_recruitment_requisitions; 0004 | RESOLVED |
| W0-REC-02 | Recruitment | Approve-holder can publish DRAFT directly (bypasses second-person approval) | shortcut | per BQ-06 | Decide | P2 | W4 | Control bypass | `publish_job_posting` | BLOCKED (BQ-06) |
| W0-REC-03 | Recruitment (D2-015) | External calendar availability | internal only | — | Defer | P2 | W8 | — | InterviewScheduler | DEFER |
| W0-REC-04 | Recruitment | Public careers portal (S030) | staff wizard | — | Defer | P2 | W8+ | — | RECRUIT-002 | DEFER |
| W0-BNK-01 | Bank rec (D2-019) | Manual/CSV reconciliation | Implemented | — | — | — | — | — | test_bank_reconciliation_sessions | RESOLVED |
| W0-BUD-01 | Budgets (D2-020) | Budgeting | Implemented (no revisions) | revisions only if asked | — | P2 | W7 | — | budgets.py | RESOLVED |
| W0-RPT-01 | Reports (D2-021) | Catalogue / saved / sharing / scheduling | Implemented (scheduled refresh needs Render cron) | — | Confirm cron | P2 | W8 | Stale scheduled reports | reports/library.py | RESOLVED |
| W0-RPT-02 | Reports (D2-003, REPORT-001) | CSV only | accepted | hide other formats | UI guard | P2 | W1 | False affordance | register | ACCEPTED |
| W0-OPS-01 | Ops (D2-002, OPS-001) | Typed handlers only | accepted | add only needed handlers | — | P2 | W7 | — | register | ACCEPTED |
| W0-HOME-01 | Home (D2-001, HOME-001) | Activity/reference adoption incremental | open | selective | per wave | P2 | W2/W3 | — | register | IMPLEMENT |
| W0-GHA-01 | Payroll (D2-005…009) | Minimum wage basis, pension eligibility, proration, relief timing, overtime threshold | fail-closed (GHA-001/002/003, PAY-001…004) | unchanged until verified | Carry forward; never guess | P1 | W5 | Legal misstatement if guessed | register + test_ghana_payroll* | ACCEPTED |
| W0-SCOPE-01 | Scope (D2-022/023) | Procurement / Learning / Performance / Benefits / subscription plans | absent | absent | Keep out of nav and seeds | — | W8+ | Scope creep | navigation.ts | DEFER |
| W0-UI-01 | Design (D2-024) | Stitch sample data must not ship | concept seed only | governed states | CI grep guard | P1 | W1 | Fake facts in prod | test matrix W1 | IMPLEMENT |
| W0-UI-02 | Navigation | Approval-workflows settings imply all modules use definitions; only Leave does | misleading | labelled until W2 | UI copy | P2 | W1 | Misconfiguration | S027 | IMPLEMENT |
| W0-TST-01 | Testing | Zero MFA tests; no frontend tests/CI; no E2E in repo | gaps | per test matrix | Add gates | P1 | W1/W2 | Regressions undetected | phase2_test_matrix.md | IMPLEMENT |
| W0-DOC-01 | Pack | S065 manifest says variant of S008 | error | variant of S015 | Note | P2 | — | — | manifest | RESOLVED |

## 4. Wave 0 gate status

| Gate | Status | Evidence | What remains |
|---|---|---|---|
| **G0-01** Routes reconciled with actual router | **COMPLETE** | 144-page tree diffed; 66/66 mapped; 0 new routes; `frontend_route_reconciliation.*` | Optional aliases are frontend-only and post-W1 |
| **G0-02** API inventory reconciled to live backend/OpenAPI | **PARTIAL** | 664-operation inventory; every v3 API row classified; 9 superseded | The published OpenAPI is invalid (33 errors) and stale. Freezing the contract requires regenerating the schema and adding a CI gate (W0-API-01, non-behavioural) |
| **G0-03** Permission matrix reconciled to actual codes | **PARTIAL** | 142 codes × roles × endpoints mapped; v3 codes superseded | BQ-01 (Executive landing vs AUDITOR); BQ-11 (role-code scoping) |
| **G0-04** Lifecycles approved (Payroll, Journal, Expense, Leave, Attendance Adj., Recruitment) | **PARTIAL** | 18 machines documented from code; Payroll, Journal, Leave, Attendance and Recruitment need no new states | The Expense target needs BQ-02/03; separation of duties needs BQ-04 |
| **G0-05** Approval-engine boundary approved | **PARTIAL** | Capabilities classified; bounded W2 design proposed | Architecture sign-off on §3 of the gap analysis |
| **G0-06** Email OTP security controls finalized | **PARTIAL** | Existing controls verified (digest, 5-min TTL, 5 attempts, single-use) | Throttle, cooldown, issue cap, masking and audit missing (SEC-01/03); BQ-10 parameter sign-off |
| **G0-07** Expense-to-GL mapping contract | **PARTIAL** | Current posting verified (Dr expense / Cr CASH mapping, fail-closed, no hard-coded IDs); target posting model written | BQ-02, BQ-03, BQ-09 |
| **G0-08** GH-2026.1 verified vs fail-closed rules | **COMPLETE** | Register GHA-001…005 and PAY-001…005 unchanged since the last register update; fail-closed behaviour covered by `test_ghana_payroll*`; no new legal validation found in the repo | Carry forward; no values to be guessed |
| **G0-09** 66 screens mapped to routes/components | **COMPLETE** | Route reconciliation incl. variants and component paths | — |
| **G0-10** Critical-path test plan agreed | **PARTIAL** | Matrix by wave drafted against the existing 296 tests and CI | QA/engineering agreement; CI gate additions need approval |
| **G0-11** Module dependency / disabled behaviour verified | **COMPLETE** | Hidden UI, blocked API (`module_disabled` before permission), data preserved, cross-module omission, each with tests | Findings MOD-01/02 are IMPLEMENT items (W2), not open contract ambiguities. BQ-05 is low risk |
| **G0-12** Audit taxonomy agreed | **PARTIAL** | Full current catalogue + new-event list | Security/audit agreement; AUD-01 |

**Result: 4 COMPLETE, 8 PARTIAL, 0 BLOCKED.** Wave 0 is **not complete**. High-risk work (Waves 2, 5 and 6) should not start until §6 is answered. Wave 1 (Design System) and the non-behavioural W0 hygiene items can proceed now.

## 5. Critical blockers

1. **SEC-01 and SEC-02 (P0).** Brute-forceable MFA, and logout does not revoke tokens. These are live production weaknesses, independent of Phase 2 design. Recommend fixing them first, as a security patch.
2. **BQ-01 dashboard landing.** The locked rule cannot be implemented as written while AUDITOR holds `dashboard.executive.view`, and "Employee Home" is ambiguous between `/` and `/me`.
3. **BQ-02 and BQ-03 Expense 2.0 shape.** Evolve vs replace the model, and the settlement/liability model. These block G0-07 and Wave 6.
4. **BQ-04 separation of duties.** Affects the payroll, journal, expense and AP lifecycles.
5. **W0-APR-01.** The approval-engine extension is a prerequisite for the expense manager stage.

## 6. Blocking questions requiring product decision

| ID | Question | Recommendation |
|---|---|---|
| BQ-01 | Should the *landing route* after sign-in be Executive Dashboard for IA/Director, Insights for other operational roles, and Home for Employees? Or are these navigation destinations while everyone lands on Home (current behaviour)? Should AUDITOR keep `dashboard.executive.view`? Is "Employee Home" `/` or `/me`? | Land by effective permission in bootstrap: `dashboard.executive.view` → `/dashboard`; any operational module permission → `/insights`; else `/me`. Remove `dashboard.executive.view` from the AUDITOR default. |
| BQ-02 | Expense 2.0: evolve `Expense` in place (header + new lines), or add `ExpenseClaim` and freeze `Expense`? After a posted claim is reversed, does it become REVERSED or stay POSTED with a link? | Evolve in place (API paths stable; history kept); add terminal REVERSED. |
| BQ-03 | Settlement: reimbursable claims credit an employee-payable liability and settle later (Dr payable / Cr bank)? Keep the cash-paid option? Reuse the AP `Payment` model for settlement records? | Payable + explicit settle; keep "paid from petty cash" as an option; do not reuse AP Payment (vendor-bound). |
| BQ-04 | Enforce separation of duties (preparer ≠ approver ≠ poster) for payroll, journals, expenses and vendor bills? Always, or as an institution setting? | Institution setting, default ON for payroll and journals; system-generated journals exempt but record the upstream approver. |
| BQ-05 | Should disabling REPORTS block module CSV reports (`/reports/*`) too? | Yes. REPORTS gates every reports surface. |
| BQ-06 | May a requisition approver publish their own DRAFT directly? | No. Remove the shortcut and require PENDING_APPROVAL → APPROVED by someone else. |
| BQ-07 | Candidate data retention and deletion policy (privacy) | Defer to W8; non-blocking. |
| BQ-08 | Credit notes in Phase 2? | Defer; hide "Issue credit". |
| BQ-09 | ERD-005: add durable account provenance (`system_mapping_code` on Account + institution override), or ratify code-based mapping? | Add provenance before introducing `EMPLOYEE_PAYABLE`. |
| BQ-10 | Email OTP parameters | TTL 5 min (keep); 5 attempts (keep); resend cooldown 60 s; ≤5 challenges per user per 15 min; login throttle 5 failures per account per 15 min, then a 15-min lock; 20 requests/min per IP; masked destination (`d•••@g•••.com`). |
| BQ-11 | Move data scope and read-only from role codes to Role fields (migration)? | Yes in W2, defaulted from the current system roles so behaviour is unchanged. |

## 7. New Phase 2 backend work confirmed

- **Security:** login and OTP throttling; resend cooldown; destination masking; auth audit events; session registry with list/revoke; server-side logout blacklist; step-up to disable MFA.
- **RBAC:** PRIVILEGED classification and grant rule; Role-level data scope and read-only flags (pending BQ-11); bootstrap landing resolution (pending BQ-01).
- **Platform:** module dependency validation and toggle audit; AuditLog append-only; standard `metadata.changes`; OpenAPI repair and CI gate; drop accidental DELETE routes; single search mount.
- **Approvals:** trigger enum and conditions, approver types (ROLE any-holder, REQUESTER_MANAGER, REQUESTER_DEPARTMENT_HEAD), RETURN, escalation reminder job, definition audit, requester-never-approver.
- **HR:** employee CRUD audit; attendance-adjustment finalized-payroll guard (with the overtime-pay link); leave `NOT_EVALUATED` check status.
- **Recruitment:** scorecard permission tightening; publish shortcut per BQ-06.
- **Payroll:** separation of duties / return-for-correction per BQ-04 (optional).
- **Expenses 2.0:** claimant, lines, receipts, categories→accounts, policy checks, manager stage through the engine, finance review, RETURNED, accrual posting, SETTLED, governed reversal, self-service API and `/me/expenses`, currency guard, notifications, audit, 3 permissions.

## 8. Existing capabilities to reuse (do not rebuild)

- BFF/HttpOnly session boundary; TOTP + email-OTP models.
- Bootstrap context; `TenantContextPermission` / `TenantRBACPermission`; `common.scoping`.
- Universal search and saved entries; notifications with allow-listed route hints.
- Cross-module approvals inbox; leave multi-step approvals with delegate/return.
- `PayrollRunException`; payroll→GL with fail-closed mappings.
- Journal reversal; AP bulk batch jobs.
- Bank reconciliation sessions; budgets with actuals; financial report library and runs; report library and sharing.
- JobPosting requisition lifecycle; competency scorecards; interview scheduler; offer approval/letter/hire lineage.
- `ImportJob` / `ExportJob` / `BackgroundJob`; `documents.Document` attachments.
- `AuditLog` + `/record-history/`; PWA shell (online-first).
- Design System v2 state, dialog and status components.

## 9. Deferred capabilities

- Public careers portal (S030); external calendar availability.
- Credit notes; reconciliation reopen; budget revisions.
- Payroll "Paid" state and payment rails; bank feeds.
- Standing approval delegation calendars.
- PDF/XLSX/XBRL exporters (until real renderers exist).
- Performance trajectory, healthcare-proxy documents, identity verification.
- Procurement, Learning, Performance, Benefits, subscription plans.
- SMS OTP and recovery phone (excluded).

## 10. Recommended implementation order

| Wave | Contents (in order) | Depends on | Blockers |
|---|---|---|---|
| **W2-pre (security patch)** | SEC-01 throttling + OTP cooldown; SEC-02 logout blacklist; AUD-01 append-only audit | — | BQ-10 sign-off |
| **W1 Design System** | Tokens and primitives from Stitch; state library (S059 canonical); dialogs (S060); transitions pattern (S061); sample-data guard; hide unsupported exports; frontend lint/type CI | none | none. Can run now, in parallel |
| **W2 Platform/Security** | OpenAPI repair + CI gate → session registry/revoke → auth audit events → PRIVILEGED grant rule → Role scope/read-only fields (BQ-11) → module dependency rules + audit → approval engine extension (triggers, approver types, RETURN, escalation, requester-never-approver) → notification preferences → Security Center, Notification Center, Modules and Approvals UI restyle | W2-pre | BQ-10, BQ-11, G0-05 sign-off |
| **W3 HR/Self-Service** | Bootstrap landing (BQ-01) → Executive/Insights/Home routing → employee CRUD audit → leave NOT_EVALUATED → HR, Leave, Attendance and Me screens restyle → LC-ATT-01 guard (when overtime pay is linked) | W2 engine (for leave resolver fix) | BQ-01 |
| **W4 Recruitment** | Scorecard permission tightening → publish rule (BQ-06) → recruitment screens restyle | W2 | BQ-06 |
| **W5 Payroll** | SoD / return-for-correction (if approved) → payroll workspace and run-detail restyle → Ghana items stay fail-closed | W2 | BQ-04 |
| **W6 Accounting/Expenses** | Currency guard (can ship earlier) → ERD-005 provenance (BQ-09) → Expense 2.0 models + migration → engine trigger EXPENSE_CLAIM → finance review → accrual posting → settle → reversal → `/me/expenses` + finance UI → journal SoD (BQ-04) | W2 engine; BQ-09 | BQ-02, BQ-03, BQ-04, BQ-09 |
| **W7 Advanced Finance** | Bank-statement typed import handler (if non-CSV needed) → budget/report restyle → credit notes only if approved | W6 | BQ-08 |
| **W8 Reporting/Integrations** | REPORTS gating (BQ-05) → report catalogue restyle → Render cron for scheduled reports → deferred integrations by approval | W2 | BQ-05, BQ-07 |

## 11. Recommended next action

1. Answer **BQ-01, BQ-02, BQ-03, BQ-04, BQ-10 and BQ-11**.
2. Approve the **W2-pre security patch** (SEC-01, SEC-02, AUD-01).
3. In parallel, start **Wave 1 Design System**, which has no blockers.

When those are approved, G0-02, G0-03, G0-04, G0-06, G0-07 and G0-12 can be closed in a short follow-up pass.
