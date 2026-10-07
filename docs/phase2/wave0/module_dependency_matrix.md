# Wave 0 — Module Dependency Matrix

Evidence:

- **Module model:** `apps/institutions/models.py` `InstitutionModule.ModuleCode`: CORE_HR, LEAVE, ATTENDANCE, PAYROLL, ACCOUNTING, RECRUITMENT, REPORTS.
- **Enablement:** `bootstrap_institution` enables CORE_HR and creates the other six disabled. The toggle is `PATCH /institutions/modules/{id}/` (`settings.modules.manage`), which then re-runs `validate_institution_onboarding`.
- **Backend gate:** `TenantRBACPermission`. A view whose `required_module` is not enabled gets 403 `module_disabled`. This is checked **before** the permission, so permissions never override a disabled module.
- **Frontend gate:** `ModuleAccessGate`, `ModuleGuard` and `ModuleDisabled` show a distinct "not enabled" state. Navigation items carry `module` + `anyPermissions` (`components/navigation/navigation.ts`) and are hidden when the module is off.
- **Cross-module reads:** dashboards (`apps/dashboards/views.py` L162/L257), the approvals inbox (`workflows/inbox.py` L400), search (`institutions/search.py` L249) and reports (`ReportsViewSet.required_module` per action).
- **Tests:**
  - `test_foundation::test_disabled_modules_are_not_active_capabilities`
  - `test_leave::test_leave_module_is_gated_until_enabled`
  - `test_payroll::test_payroll_module_gate_and_role_permissions`
  - `test_compensation::...payroll_module_gate...`
  - `test_accounting_api_contract::test_every_accounting_operation_requires_enabled_module`
  - `test_recruitment::...module_permission_and_tenant_scope`
  - `test_dashboards_reports::test_executive_dashboard_omits_disabled_module_rollups`
  - `test_home_personal_snapshot::...disabled_modules`
  - `test_access_experience_foundation::test_disabled_leave_is_removed_from_home_search_and_reports`

## Matrix

| Module | Depends on (data) | Required for | Backend API when disabled | Frontend navigation | Data preservation | Onboarding dependency | Cross-module integrations |
|---|---|---|---|---|---|---|---|
| **CORE_HR** | — | every other module (employees, departments, positions, grades, locations) | All `TenantModelViewSet` endpoints default to `required_module="CORE_HR"`, including roles, members, settings, documents, workflows, operations and `/institutions/modules/` itself. **Disabling CORE_HR therefore locks the institution out of module management** (the platform console only reads modules, so recovery needs Django admin or the database). Self-service `/employees/me/*`, dashboards, home, search, notifications and inbox have no module requirement and keep working. | HR area hidden | Rows untouched (flag only) | ORGANIZATION_SETUP, HR_CONFIGURATION | Search always treats CORE_HR as enabled (`| {"CORE_HR"}`) |
| **LEAVE** | CORE_HR (employee, department head, reports_to for approvers) | ATTENDANCE (approved leave classifies a day ON_LEAVE) | 403 `module_disabled` on leave types/policies/requests/balances/approvals; `/reports/leave/` 403; leave omitted from home, search, dashboards, inbox | Leave and My Leave hidden | Preserved | none (no LEAVE-specific step) | `attendance.services._approved_leave_exists` reads approved leave **without checking LEAVE is enabled**. Harmless (it only reads existing approved rows), but undocumented. |
| **ATTENDANCE** (incl. scheduling) | CORE_HR; LEAVE (optional) | — (payroll does **not** consume attendance or overtime today) | 403 on schedules, shifts, records, adjustments, overtime; omitted from inbox and dashboards | hidden | Preserved | SCHEDULING_CONFIGURATION | Overtime is not linked to pay (future, LC-ATT-01) |
| **PAYROLL** (incl. compensation, tax relief) | CORE_HR (employees, employment, grades) | ACCOUNTING payroll journal | 403 on compensation, payroll, payslips, tax relief; payslips hidden from self-service | hidden | Preserved | PAYROLL_CONFIGURATION; PAYROLL_GL_MAPPING (only when PAYROLL **and** ACCOUNTING are enabled) | `generate_accounting_journal` checks ACCOUNTING is enabled (`module_disabled`) and needs `journal.create` |
| **ACCOUNTING** | — (an institution can run accounting without HR data). PAYROLL is optional for payroll journals. | PAYROLL→GL; Expenses; Budgets; Bank reconciliation | 403 on every accounting operation (contract test pins this) | hidden | Preserved | ACCOUNTING_CONFIGURATION; PAYROLL_GL_MAPPING | Payroll mapping templates; budget actuals from posted GL |
| **RECRUITMENT** | CORE_HR (hire creates an Employee; departments/positions on postings) | — | 403 on postings, candidates, applications, interviews, evaluations, offers, stages; `/reports/recruitment/` 403 | hidden | Preserved | RECRUITMENT_CONFIGURATION | `offer.hire` → Employee + Employment (lineage kept on the offer) |
| **REPORTS** | data modules | — | **Inconsistent.** `/report-library/*` → 403 `module_disabled`, but `/reports/{module}/` checks only the *source* module, not REPORTS, so CSV reports keep working with REPORTS disabled. | `/reports` nav item gated on REPORTS | Preserved | none | `report.all` bypasses source *permissions* (by design) but not source *modules* |

## Verified behaviours

| Check | Result | Evidence |
|---|---|---|
| Disabled module is hidden in the UI | **Yes** | `ModuleAccessGate` and navigation `module` filter; `ModuleDisabled` state |
| API access is blocked | **Yes**, for module-owned endpoints, with a distinct `module_disabled` code (≠ permission denied) | `TenantRBACPermission`; contract tests |
| Existing data is preserved | **Yes.** The toggle only flips `is_enabled`; no cascade or cleanup exists. Re-enabling restores access. | `InstitutionModuleViewSet.partial_update` |
| Permission does not override disablement | **Yes.** The module check runs first; IA (who holds every permission) still gets 403. | `common/permissions.py` |
| Cross-module views omit disabled data | **Yes** for executive dashboard, home, search, inbox and Insights | tests listed above |

## Findings

| ID | Finding | Risk | Action | Wave |
|---|---|---|---|---|
| MOD-01 | **No dependency validation on toggle.** CORE_HR can be disabled, which disables module management itself. PAYROLL, LEAVE, ATTENDANCE or RECRUITMENT can be enabled while CORE_HR is off. | High (self-lockout; inconsistent state) | Backend rule in the module service: CORE_HR cannot be disabled, and dependants require CORE_HR. Dependency table: LEAVE, ATTENDANCE, PAYROLL, RECRUITMENT → CORE_HR. Disabling a module that others depend on is refused with the dependant list (`module_dependency`). | W2 |
| MOD-02 | Module enable/disable writes **no dedicated audit event** (only `institution.onboarding.validated`). | Medium | Add `institution.module.enabled` / `.disabled` with actor, before/after. | W2 |
| MOD-03 | REPORTS gating is inconsistent between `/reports/*` and `/report-library/*`. | Low | **BQ-05.** Either require REPORTS on both, or treat REPORTS as "saved analytics" only and document it. | W2 |
| MOD-04 | `_approved_leave_exists` ignores LEAVE enablement. | Low | Document as intended (historical approved leave still classifies the day) or gate it. | W3 |
| MOD-05 | v3's assumed dependency "Reports depends on Payroll/Accounting" does not exist in code. Reports depend only on the source module of each report. | — | Record as RESOLVED (no change). | — |

## Proposed dependency rules (W2, approval required)

| Module | Requires enabled | Cannot be disabled while |
|---|---|---|
| CORE_HR | — | always (non-disableable) |
| LEAVE | CORE_HR | — (ATTENDANCE reads leave only optionally) |
| ATTENDANCE | CORE_HR | — |
| PAYROLL | CORE_HR | — |
| ACCOUNTING | — | — (PAYROLL→GL already fails closed with `module_disabled`) |
| RECRUITMENT | CORE_HR | — |
| REPORTS | — | — |
