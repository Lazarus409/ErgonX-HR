# Payroll Module Completion Report

Report version: 1.5  
Assessment date: 2026-09-12  
Delivery status: **COMPLETE WITH DOCUMENTED LIMITATIONS**

Generic Payroll is functionally implemented, has an explicit tenant-aware selector boundary, stable machine-readable errors, complete operation-level OpenAPI, a Ghana setup/profile/deadline endpoint contract matrix, complete workflow audit/notification integration, and passes the full PostgreSQL suite. The Module Delivery and Frontend Integration Contract v1.0 gate is complete; the product/model limitations in §15 remain authoritative.

## 1. Models added or changed

Generic, country-neutral rule catalog:

- `PayrollPreset`
- `PayrollPresetVersion`
- `TaxRule`
- `TaxBand`
- `ContributionRule`
- `ContributionAllocation`
- `SpecialIncomeRule`
- `TaxReliefDefinition`
- `StatutoryThreshold`
- `ComplianceDeadline`

Institution and transaction domain:

- `InstitutionPayrollConfiguration`
- `EmployeeTaxReliefClaim`
- `PayrollPeriod`
- `PayrollRun`
- `PayrollRecord`
- `PayrollItem`
- `PayrollAdjustment`
- `Payslip`

The models include tenant ownership where applicable, effective dating, status enums, protected historical relationships, indexes, check/unique constraints, and finalized-state immutability. `EmployeePayrollProfile` is a Ghana localization extension and is covered in the Ghana completion report.

## 2. Migrations added

- `apps/payroll/migrations/0001_initial.py` — creates the generic Payroll rule and transaction schema.
- `apps/institutions/migrations/0007_seed_payroll_access.py` — idempotently seeds Payroll permissions and assignments to standard tenant roles.

Related later migrations:

- `apps/payroll/migrations/0002_employeepayrollprofile.py` — Ghana employee tax-profile extension.
- `apps/payroll/migrations/0003_seed_ghana_payroll_2026.py` — Ghana statutory preset seed.

Migration drift check: clean. Both later migrations were applied successfully on PostgreSQL 16.

## 3. Services added

Workflow and configuration services in `apps/payroll/services.py`:

- payroll configuration and country-preset choices;
- generic enforcement of selected-preset currency/frequency metadata and full proposed-configuration validation before insert or update;
- employee payroll-profile configuration;
- period and idempotent run creation;
- run calculation, review submission, approval, finalization, cancellation, and reconciliation;
- immutable payslip payload/checksum generation;
- compliance deadline projection;
- adjustment creation, submission, approval, and rejection;
- relief claim creation, submission, approval, and rejection;
- permission-holder and employee notifications.

Calculation services in `apps/payroll/calculation.py`:

- effective compensation and component resolution;
- approved overtime, unpaid leave, and approved adjustment consumption;
- generic flat/progressive tax and contribution processing;
- localized statutory evaluator dispatch;
- snapshotted payroll-item creation and record totals.

Critical state transitions use transactions; concurrency-sensitive run, adjustment, and claim operations re-read state under `select_for_update`.

## 4. Selectors added

`apps/payroll/selectors.py` contains the complex reusable read boundary:

- active/effective preset versions matching an institution's country;
- employees with effective compensation for a run;
- approved employee relief claims for a preset and tax year;
- prior finalized year-to-date payroll records and items;
- effective special-income and contribution rules for a run;
- effective configured compliance deadlines for a period;
- tenant-scoped payroll records with employees selected and items prefetched for reconciliation.

Every selector accepting tenant-owned records requires the institution explicitly and rejects cross-tenant inputs before querying. Simple, single-use reads remain local to their service or calculation rather than introducing a generic repository layer. Status: complete; former `CONTRACT-004` is recorded as `RES-006`.

## 5. Permissions added

All permissions are assigned to module code `PAYROLL`:

- `payroll.view`
- `payroll.configure`
- `payroll.prepare`
- `payroll.approve`
- `payroll.finalize`
- `payslip.view`
- `tax_relief.view`
- `tax_relief.claim`
- `tax_relief.approve`

Backend access requires an authenticated user, resolved active institution membership, enabled PAYROLL module, and the action's permission. Employee-role relief and payslip querysets are additionally self-scoped.

The OpenAPI audit found that the employee payroll-profile view's declared `payroll.configure` permission was not consumed by the shared viewset. `TenantModelViewSet` now honors explicit `required_permission` declarations, and employee-role list/create denial is tested. This resolved discrepancy is recorded as `RES-008`.

## 6. API endpoints added

All endpoints are under `/api/v1/`.

- Read-only catalog: `payroll-presets`, `payroll-preset-versions`, `tax-rules`, `tax-bands`, `contribution-rules`, `contribution-allocations`, `special-income-rules`, `tax-relief-definitions`, `statutory-thresholds`, and `compliance-deadlines`.
- Configuration: `payroll-configurations` plus `choices`.
- Employee statutory profiles: `employee-payroll-profiles`.
- Transactions: `payroll-periods`, `payroll-runs`, `payroll-records`, `payroll-items`, `payroll-adjustments`, `employee-tax-relief-claims`, and `payslips`.
- Run actions: `calculate`, `submit-review`, `approve`, `finalize`, `cancel`, and `reconcile`.
- Adjustment actions: `submit`, `approve`, and `reject`.
- Relief actions: `submit`, `approve`, and `reject`.
- Period action: `compliance-deadlines`.

Status fields are read-only; transitions occur only through explicit service-backed action endpoints.

## 7. Filters, search, and ordering supported

- Presets: country/system-management filters; code/name/description search.
- Versions: preset/status/effective-date filters; version/preset search.
- Tax and contribution catalog: preset, method, residency, basis, active/effective-date and destination filters; relevant code/name search.
- Periods: status/start/end/pay-date filters; name search; date ordering.
- Runs: period/preset/status/run-number filters and lifecycle-date ordering.
- Records: run/employee/currency/status filters; gross/net ordering.
- Items: record/component/source filters; snapshotted code/name search; amount ordering.
- Adjustments: employee/period/component/status filters.
- Relief claims: employee/definition/tax-year/status filters.
- Payslips: record/generated-date filters.

All list endpoints use standard page-number pagination with a default of 25 and maximum requested page size of 100.

## 8. OpenAPI updated

- Generated artifact: `openapi-schema.yml`.
- Runtime schema: `/api/v1/schema/`.
- Swagger UI: `/api/v1/docs/`.
- Success and common error responses are represented through the standard envelope.
- Error responses publish a required stable `code` while retaining field-level `errors`; the shared enum is included in `ErrorEnvelope`.
- The generated schema validates successfully and includes the current Payroll/Ghana endpoints and enums.
- All 60 current Payroll-related operations have non-empty summaries, purpose descriptions, tenant/module/permission expectations, and documented `x-error-codes`.
- No-body workflow transitions no longer advertise model request payloads; relief approval uses `TaxReliefDecision`; compliance deadlines expose an unpaginated list with only the path ID parameter.
- Setup choices, idempotent run creation, reconciliation, and the common error envelope include representative examples.

Status: complete; former `CONTRACT-006` is recorded as `RES-009`.

## 9. Audit events added

Current Payroll events include:

- `payroll.configuration.changed`
- `payroll.employee_profile.changed`
- `payroll.period.created`
- `payroll.run.created`
- `payroll.run.calculated`
- `payroll.run.submitted_for_review`
- `payroll.run.approved`
- `payroll.run.finalized`
- `payroll.run.cancelled`
- `payroll.adjustment.created`
- `payroll.adjustment.submitted`
- `payroll.adjustment.approved`
- `payroll.adjustment.rejected`
- `payroll.adjustment.applied`
- `payroll.adjustment.unapplied`
- `payroll.tax_relief_claim.created`
- `payroll.tax_relief_claim.submitted`
- `payroll.tax_relief_claim.approved`
- `payroll.tax_relief_claim.rejected`

Critical run, adjustment, and relief transitions include `before.status` and `after.status`; relief decisions also snapshot the approved amount and adjustment application/reversal links the run. API-originated audit writes capture the direct remote IP and user agent through context-local middleware. Direct service/command calls correctly leave unavailable request context empty. Status: complete; former `CONTRACT-008` is recorded as `RES-012`.

## 10. Notifications added

- Payroll review submission notifies users holding `payroll.approve`.
- Payroll approval notifies users holding `payroll.finalize`.
- Adjustment submission notifies users holding `payroll.approve`.
- Relief submission notifies users holding `tax_relief.approve`.
- Relief approval/rejection notifies the linked employee user.
- Finalization notifies each linked employee that a payslip is available.
- Preset compliance deadlines generate notifications for users holding `payroll.finalize`.

Matching transition retries are idempotent and do not duplicate notifications or audit events. Opposite/incompatible decisions remain invalid transitions.

## 11. Tests added

`tests/test_payroll.py` covers:

- module gating and seeded permissions;
- active-period overlap rejection;
- calculation lifecycle, snapshots, idempotency, reconciliation, finalization, payslip generation, and immutability;
- approved overtime, unpaid leave, and adjustment integration;
- progressive tax-band calculation;
- preset-bound/self-scoped relief claims;
- cross-tenant API isolation.

The Ghana report covers seven localized tests plus seven API-contract tests. Shared foundation, compensation, attendance, leave, authorization, response-envelope, and PostgreSQL-only integrity tests also exercise Payroll dependencies.

`tests/test_payroll_demo_seed.py` verifies that the demo command refuses non-debug environments, creates the complete finalized scenario, persists usable credentials, and produces identical entity/audit/notification counts when run twice.

`tests/test_payroll_selectors.py` verifies country/effective-date scope, eligible employees, configured statutory rules, approved reliefs, finalized YTD records/items, reconciliation prefetch behavior, and explicit cross-tenant rejection across the selector API.

`tests/test_payroll_workflow_integration.py` verifies submission/decision audit events, before/after state, request IP/user-agent capture, finalizer/reviewer/claimant notifications, monetary metadata, and retry-safe side effects. Calculation tests additionally verify adjustment-application audit metadata, and the deterministic demo pins the resulting 18 audit events and 9 notifications across reruns.

Shared and Payroll API tests verify `authentication_required`, `permission_denied`, `module_disabled`, `tenant_mismatch`, `validation_error`, `not_found`, `invalid_state_transition`, `record_immutable`, `period_closed`, and `duplicate_operation`, including preservation of field-level errors.

The Payroll OpenAPI contract test walks all Payroll-related operations and requires summaries, descriptions, PAYROLL access context, and error-code metadata. It also pins representative action request bodies, parameters, unpaginated response shape, and examples. The Ghana endpoint matrix covers every exposed setup-choice, configuration, payroll-profile, and calculated-deadline operation across authentication, module, permission, tenant, filter/search/pagination, envelope, stable-code, and validation behavior. Former `CONTRACT-007` is resolved as `RES-011`; preset-constraint defect `RES-010` was found and fixed during that reconciliation.

## 12. PostgreSQL result

PostgreSQL 16 validation after completing workflow audit/notification integration on 2026-09-12:

```text
80 passed in 95.91s
```

The run included PostgreSQL-specific concurrency/integrity cases, OpenAPI/action-shape tests, permission/error-contract tests, selector isolation tests, and all Ghana tests. Final SQLite validation was:

```text
77 passed, 3 PostgreSQL-only tests skipped
```

## 13. Frontend integration note path

`docs/integration/payroll_frontend_contract.md`

The note contains the required module flag, permissions, endpoint tables, query parameters, request/response examples, status enums, workflow transitions, frontend behavior, errors, and limitations. Thirty-three route families/actions shared across the Payroll notes were matched against OpenAPI.

## 14. Seed and demo-data support

Available deterministic seeds:

- Payroll permission codes and standard-role assignments.
- Ghana system statutory preset data, documented separately.
- Development-only `seed_payroll_demo` management command.

`seed_payroll_demo` creates a reserved Ghana institution, admin and employee users, organization/employment, resident/non-resident profiles, compensation and bonus configuration, an approved relief claim and adjustment, a finalized run, two payslips, and compliance reminders. It refuses `DEBUG=False`. Two-run tests prove stable entity, audit, and notification counts.

## 15. Remaining issues

Product/model limitations:

- `PAY-001` — base salary has no explicit pay-period basis.
- `PAY-002` — no approved mid-period proration rule; calculation fails closed.
- `PAY-003` and `PAY-004` — Ghana relief timing and derived-cap policy require decisions.
- `PAY-005` — correction/off-cycle/payment/export workflows are deferred.

The maintained authoritative issue list is `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`.

## Completion decision

**COMPLETE WITH DOCUMENTED LIMITATIONS.** Runtime behavior, delivery artifacts, API contracts, audit/notification integration, deterministic demo support, and PostgreSQL validation satisfy the current module delivery gate. The limitations in §15 remain explicit constraints and do not become implied capabilities.
