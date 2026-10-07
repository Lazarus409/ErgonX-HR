# Ghana Payroll Preset Module Completion Report

Report version: 1.5  
Assessment date: 2026-09-12  
Delivery status: **PARTIALLY COMPLETE**

The `GH-PAYROLL` / `GH-2026.1` preset, localized calculations, onboarding choice, explicit residency, relief integration, compliance reminders, stable shared errors, operation-level OpenAPI, endpoint contract matrix, and shared workflow audit/notification integration are implemented and PostgreSQL-green. The module is not marked complete because documented Ghana legal/data-model decisions remain open.

## 1. Models added or changed

Added:

- `EmployeePayrollProfile` — tenant-owned one-to-one Employee extension with explicit `RESIDENT`/`NON_RESIDENT` status and optional tax identification number.

Reused generic versioned entities without Ghana-specific schema branches:

- `PayrollPreset` and `PayrollPresetVersion`
- `TaxRule` and `TaxBand`
- `ContributionRule` and `ContributionAllocation`
- `SpecialIncomeRule`
- `TaxReliefDefinition` and `EmployeeTaxReliefClaim`
- `StatutoryThreshold`
- `ComplianceDeadline`
- Payroll run/record/item snapshots

This preserves the required generic engine and separates localized evaluation into `apps/payroll/localizations/ghana.py`.

ERD extension requiring ratification: `EmployeePayrollProfile` exists because ERD v1.1 defines residency on tax rules but no corresponding employee tax classification. Tracked as `ERD-001`.

## 2. Migrations added

- `apps/payroll/migrations/0002_employeepayrollprofile.py` — adds the tenant-scoped employee payroll profile and residency index.
- `apps/payroll/migrations/0003_seed_ghana_payroll_2026.py` — idempotently seeds `GH-PAYROLL` / `GH-2026.1` and its statutory child records.

Both migrations apply cleanly on PostgreSQL 16. Migration drift check reports no changes.

## 3. Services added

- `payroll_setup_choices` — returns active presets for the institution country plus the explicit Custom option and warning.
- `configure_payroll` — validates the complete proposed configuration and generically enforces selected-preset currency/frequency metadata before insert or update.
- `configure_employee_payroll_profile` — permission-checked, tenant-validated, audited residency/TIN configuration.
- `compliance_deadlines_for_period` — calculates effective deadline dates from versioned rules.
- Ghana localized evaluator dispatch through `calculate_localized_statutory`.
- `calculate_statutory` — resident/non-resident PAYE, pension, bonus, overtime gate, casual withholding, approved relief application, and snapshotted statutory items.
- Finalization integration for Ghana compliance notifications.

All statutory values, including non-resident special-income rates, are read from the selected versioned rules. Country logic is not embedded as a branch in the generic calculation engine.

## 4. Selectors added

Ghana's reusable reads now use `apps/payroll/selectors.py` for:

- approved employee relief claims for the selected preset and tax year;
- prior finalized year-to-date payroll records and items;
- effective contribution rules, including prefetched pension allocations;
- effective special-income rules for bonus, overtime, and casual withholding;
- effective compliance deadlines for the configured institution preset.

The evaluator supplies the institution explicitly, and the selectors reject tenant-owned inputs belonging to another institution. Focused selector tests cover the tenant guards and effective/YTD result scope. Former `CONTRACT-004` is resolved as `RES-006`.

## 5. Permissions added

Ghana uses the generic PAYROLL permission set; no country-specific roles or bypasses were introduced:

- `payroll.view`
- `payroll.configure`
- `payroll.prepare`
- `payroll.approve`
- `payroll.finalize`
- `payslip.view`
- `tax_relief.view`
- `tax_relief.claim`
- `tax_relief.approve`

Employee payroll profiles require `payroll.configure`. Relief ownership and approval remain separated.

An OpenAPI permission audit found that the profile view's explicit permission declaration was not honored by the shared base viewset. That authorization defect is corrected and covered by employee-role list/create denial tests; see `RES-008`.

## 6. API endpoints added

Ghana-specific integration uses generic `/api/v1/` endpoints:

- `GET payroll-configurations/choices/` — returns `GH-2026.1` as the recommended Ghana option and Custom as an explicit alternative.
- `POST/PATCH payroll-configurations/` — explicitly selects Ghana preset or Custom.
- `GET/POST/PATCH employee-payroll-profiles/` — manages required tax residency/TIN.
- `GET payroll-periods/{id}/compliance-deadlines/` — projects PAYE and pension due dates.
- Read-only catalog endpoints expose Ghana PAYE, pension, special-income, relief, threshold, and deadline records.
- Generic run actions calculate, reconcile, approve, and finalize Ghana payroll.

## 7. Filters, search, and ordering supported

- Setup choices are automatically restricted to active/effective preset versions matching the institution country.
- Employee payroll profiles filter by `employee` and `tax_residency`; search covers employee number/name and TIN.
- Ghana catalog filtering uses generic `preset_version`, tax method/residency/basis, income type, unit, authority, event type, and effective-date filters.
- Tax bands can be ordered by sequence; other catalog endpoints expose documented code/effective-date ordering where configured.
- Payroll periods, runs, records, items, claims, and payslips inherit the generic Payroll filters documented in the frontend contract.

## 8. OpenAPI updated

The validated `openapi-schema.yml` includes:

- employee payroll-profile list/create/detail/patch schemas;
- payroll setup choices and `compliance_warning`;
- calculated compliance-deadline response shape;
- Ghana-capable generic catalog and workflow endpoints;
- published enum values and standard response envelopes.
- the required machine-readable error `code` and its published enum.
- non-empty summaries, descriptions, tenant/module/permission expectations, and error-code metadata for every Payroll/Ghana operation;
- corrected request bodies and parameters for workflow actions and compliance deadlines;
- selected setup, run-creation, reconciliation, and error examples.

Former `CONTRACT-006` is resolved as `RES-009`.

## 9. Audit events added

Ghana-specific event:

- `payroll.employee_profile.changed`

Shared events capture payroll configuration, period/run creation, calculation, review, approval, finalization, cancellation, relief claim creation/submission/decision, and adjustment creation/submission/decision/application/reversal. Critical transitions include before/after status; API requests supply direct remote IP and user agent when available.

Shared audit integration is complete; former `CONTRACT-008` is recorded as `RES-012`.

## 10. Notifications added

- Finalizing a Ghana run creates one `PAYROLL_COMPLIANCE_DEADLINE` notification per configured effective deadline for permission holders.
- PAYE and pension reminder metadata includes run ID, deadline ID, and calculated ISO due date.
- Generic finalization also produces employee payslip notifications.
- Review, approval, adjustment, and relief-submission workflows use the shared permission-holder notification mechanism.
- Relief decisions notify the linked employee user.
- Matching retries do not duplicate notifications or audit events.

No return is filed and no funds are remitted; reminders are not proof of compliance.

## 11. Tests added

`tests/test_ghana_payroll.py` contains seven focused integration/calculation and authorization tests:

1. Complete and source-backed `GH-2026.1` seed contents.
2. Explicit setup choices, Custom warning, and employee residency API.
3. Resident graduated PAYE, pension, finalization, and deadline reminders.
4. Missing-residency transactional rollback and non-resident flat tax.
5. Approved relief, bonus concession, and YTD metadata.
6. Proof that the non-resident bonus rate is read from versioned rule data rather than hardcoded.
7. Employee-role denial for payroll-profile list and creation.

`tests/test_ghana_payroll_api_contract.py` contains seven contract tests spanning all eight exposed setup-choice, configuration, profile, and calculated-deadline operations. It verifies authentication, PAYROLL gating, permissions, tenant isolation, filters/search/pagination, rendered success/error envelopes, stable codes, exact Ghana deadlines, profile validation, preset-metadata configuration constraints, and non-mutating rejected PATCH requests.

`tests/test_payroll_demo_seed.py` additionally verifies the end-to-end Ghana demonstration scenario, development-only guard, credentials, finalization, and two-run idempotency.

`tests/test_payroll_selectors.py` verifies the shared selector behavior consumed by the Ghana evaluator, including effective Ghana rule selection, approved reliefs, finalized YTD reads, and cross-tenant rejection.

Shared Payroll API tests verify predictable authentication, permission, module, tenant, validation, workflow, immutability, closed-period, duplicate-operation, and not-found codes inherited by Ghana endpoints.

OpenAPI tests verify all Payroll/Ghana operations are documented and pin the setup, deadline, run-action, relief-decision, reconciliation, and error contracts. Former `CONTRACT-007` is resolved as `RES-011`; the configuration defect found during that reconciliation is recorded as `RES-010`.

## 12. PostgreSQL result

PostgreSQL 16 validation after completing shared workflow audit/notification integration on 2026-09-12:

```text
80 passed in 95.91s
```

Focused Ghana API contract validation:

```text
7 passed
```

Final SQLite suite:

```text
77 passed, 3 PostgreSQL-only tests skipped
```

## 13. Frontend integration note path

`docs/integration/ghana_payroll_frontend_contract.md`

Shared Payroll contract:

`docs/integration/payroll_frontend_contract.md`

Together they document the actual API routes, setup flow, permissions, enums, status transitions, calculation display behavior, line-item codes, compliance deadlines, failure handling, and limitations.

## 14. Seed and demo-data support

Implemented deterministic system seed:

- `GH-PAYROLL` / `GH-2026.1` identity and authority source metadata.
- Seven resident monthly PAYE bands and non-resident flat PAYE.
- Employee/employer pension rates, insurable minimum/maximum, and Tier 1/Tier 2 allocations.
- Bonus, overtime, and casual-worker rules.
- Seven personal-relief definitions.
- Five statutory thresholds, including the 2026 daily minimum wage.
- PAYE and pension compliance deadlines.

Operational demo support:

- `python manage.py seed_payroll_demo` creates a reserved development tenant with resident and non-resident employees, compensation, bonus, an approved relief, an approved/applied adjustment, a finalized run, two payslips, and compliance reminders.
- The command is idempotent, accepts a demo password override, and refuses to run with `DEBUG=False`.
- Automated tests run it twice and confirm stable business-record, audit-event, and notification counts.

## 15. Remaining issues

ERD/legal/product decisions:

- `ERD-001` — ratify employee payroll profile as the tax-residency owner.
- `ERD-002` — ratify minimum wage as a `StatutoryThreshold` or define `MinimumWageRule`.
- `GHA-001` — pay-basis/paid-days fields are required for minimum-wage enforcement.
- `GHA-002` — disputed public GHS 18,000 overtime threshold remains fail-closed for resident use.
- `GHA-003` — pension coverage/exemption is not modelled.
- `PAY-003` — annual relief withholding timing needs policy confirmation.
- `PAY-004` — percentage and actual-amount relief validation needs authoritative inputs.
- `GHA-004` — `GH-2026.1` supports monthly GHS payroll only.
- `GHA-005` — statutory compliance is reminder-only.

The authoritative maintained register is `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`.

## Completion decision

**PARTIALLY COMPLETE.** The Ghana preset is functionally operational, API-contract-covered, audit/notification-integrated, and PostgreSQL-green, but the statutory/model items in §15 prevent full completion sign-off.
