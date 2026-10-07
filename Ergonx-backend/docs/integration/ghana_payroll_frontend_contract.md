# Ghana Payroll Frontend Integration Contract

## Module

Ghana Payroll Preset (`GH-PAYROLL` / `GH-2026.1`)

Contract version: 1.3  
Implementation baseline: 2026-09-12

This document supplements `payroll_frontend_contract.md`. The generic contract remains authoritative for shared response envelopes, tenant selection, workflow actions, request bodies, status transitions, pagination, and HTTP behavior.

## Base URL

```text
/api/v1/
```

## Required module flag

`PAYROLL`

## Supported configuration

| Setting | Required value |
|---|---|
| Country | `GH` |
| Currency | `GHS` |
| Frequency | `MONTHLY` |
| Setup mode | `PRESET` |
| Preset code | `GH-PAYROLL` |
| Initial version | `GH-2026.1` |

Do not silently select this preset because an institution is in Ghana. The administrator must choose Preset or Custom explicitly.

The backend reads `currency` and `payroll_frequency` constraints from the selected preset version's `source_metadata` and enforces them on both create and PATCH. A rejected PATCH does not alter the stored configuration.

## Permissions

| Frontend task | Permission | Typical seeded roles |
|---|---|---|
| View preset and statutory rules | `payroll.view` | Institution Admin, HR Admin, Accountant, Finance Manager, Auditor |
| Select/configure Ghana payroll | `payroll.configure` | Institution Admin, HR Admin |
| Configure employee tax residency | `payroll.configure` | Institution Admin, HR Admin |
| Create and calculate runs | `payroll.prepare` | Institution Admin, HR Admin, Accountant |
| Approve runs | `payroll.approve` | Institution Admin, HR Admin, Finance Manager |
| Finalize runs | `payroll.finalize` | Institution Admin, HR Admin, Finance Manager |
| Create/submit own relief claim | `tax_relief.claim` | Employee, Institution Admin, HR Admin |
| Decide relief claims | `tax_relief.approve` | Institution Admin, HR Admin, Finance Manager |

## Endpoints

### Ghana setup endpoints

| Method | Path | Purpose | Permission | Query parameters | Request payload | Response data | Major failure conditions |
|---|---|---|---|---|---|---|---|
| GET | `payroll-configurations/choices/` | Return active country-appropriate presets plus Custom | `payroll.view` | — | — | `PayrollSetupChoices` | PAYROLL disabled, no permission/context |
| POST | `payroll-configurations/` | Adopt `GH-2026.1` explicitly | `payroll.configure` | — | `PayrollConfigurationInput` | `PayrollConfiguration` | non-GH country, non-GHS currency, inactive/mismatched preset, unsupported rounding |
| PATCH | `payroll-configurations/{id}/` | Change operational settings or setup mode | `payroll.configure` | — | partial input | updated configuration | same as create |
| GET | `employee-payroll-profiles/` | List configured employee tax classifications | `payroll.configure` | `employee`, `tax_residency`, `search` | — | Paginated profiles | tenant/module/permission denial |
| POST | `employee-payroll-profiles/` | Set required employee residency | `payroll.configure` | — | employee/residency/TIN | profile | tenant mismatch, invalid residency |
| PATCH | `employee-payroll-profiles/{id}/` | Correct residency or TIN | `payroll.configure` | — | partial input | updated profile | tenant mismatch, invalid residency |
| GET | `payroll-periods/{id}/compliance-deadlines/` | Calculate Ghana filing/remittance due dates | `payroll.view` | — | — | Deadline projections | missing/unsupported configuration |

The generic Payroll endpoints calculate, approve, finalize, reconcile, and expose Ghana results; see `payroll_frontend_contract.md`.

## Status enums

- Setup mode: `PRESET`, `CUSTOM`
- Employee tax residency: `RESIDENT`, `NON_RESIDENT`
- Preset-version status: `DRAFT`, `ACTIVE`, `RETIRED`
- Payroll run: `DRAFT`, `CALCULATING`, `CALCULATED`, `UNDER_REVIEW`, `APPROVED`, `FINALIZED`, `CANCELLED`
- Relief claim: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`

## Workflow transitions

### Required onboarding flow

```text
Resolve institution
-> Enable PAYROLL
-> GET payroll-configurations/choices/
-> Administrator explicitly selects Ghana Preset or Custom
-> POST payroll-configurations/
-> If Ghana Preset: collect an EmployeePayrollProfile for every paid employee
-> Create period and run
```

After configuration, payroll processing uses the generic workflow:

```text
DRAFT -> CALCULATING -> CALCULATED -> UNDER_REVIEW -> APPROVED -> FINALIZED
```

## Example payloads

### Recommended Ghana configuration request

```json
{
  "country_code": "GH",
  "currency": "GHS",
  "payroll_frequency": "MONTHLY",
  "payroll_setup_mode": "PRESET",
  "selected_payroll_preset_version": "<GH-2026.1-uuid>",
  "pay_day_rule": {},
  "rounding_rule": {"method": "HALF_UP", "decimal_places": 2},
  "is_configured": true
}
```

Custom mode must use `selected_payroll_preset_version: null`. Display the returned Custom compliance warning prominently; Custom mode does not invent or apply Ghana statutory deductions.

### Employee payroll profile request

```json
{
  "employee": "<employee-uuid>",
  "tax_residency": "RESIDENT",
  "tax_identification_number": "GHA-000000000"
}
```

## Employee tax residency behavior

Ghana calculation requires one explicit payroll profile per paid employee. Allowed values are:

- `RESIDENT`
- `NON_RESIDENT`

The backend does not infer residency from nationality, address, institution country, or job title. Missing residency causes calculation to fail and rolls back the run calculation.

## Statutory catalog

Read the selected version's rules using these generic endpoints:

| Path | Ghana content |
|---|---|
| `payroll-presets/?country_code=GH` | `GH-PAYROLL` identity |
| `payroll-preset-versions/?payroll_preset={id}&status=ACTIVE` | `GH-2026.1`, effective dates, source metadata |
| `tax-rules/?preset_version={id}` | Resident graduated PAYE and non-resident flat PAYE |
| `tax-bands/?tax_rule={id}&ordering=sequence` | Monthly resident graduated bands |
| `contribution-rules/?preset_version={id}` | Mandatory pension rates and insurable basis limits |
| `contribution-allocations/?contribution_rule={id}` | Tier 1 and Tier 2 allocation metadata |
| `special-income-rules/?preset_version={id}` | Bonus, overtime, and casual-worker rules |
| `tax-relief-definitions/?preset_version={id}` | Seven relief definitions and evidence requirements |
| `statutory-thresholds/?preset_version={id}` | Pension thresholds, minimum wage, bonus and overtime thresholds |
| `compliance-deadlines/?preset_version={id}` | PAYE and pension deadline definitions |

Never reproduce these values as frontend constants. Display the version code and effective dates, and read values from the API.

## Calculation behavior

### Resident employment income

- The engine deducts the employee mandatory pension amount from regular chargeable income before applying the selected version's graduated resident PAYE bands.
- Approved relief balances reduce regular chargeable income with year-to-date tracking.
- The employee contribution reduces net pay; the employer contribution is reported separately.

### Non-resident employment income

- Regular chargeable employment income uses the selected version's flat non-resident rule.
- Bonus and overtime use their own versioned non-resident special-income rates.
- Rates are loaded from preset data, not duplicated in frontend or core-engine code.

### Bonus

- The concession threshold is calculated year-to-date from the configured annual-basic percentage.
- Bonus within the remaining concession threshold uses the special bonus rate.
- Excess taxable bonus stays in regular graduated PAYE income.

### Overtime

- The seeded public junior-staff annual-income threshold is marked as requiring legal validation.
- Resident overtime calculation that depends on this disputed threshold fails closed.
- The frontend must surface the returned validation error and must not offer a client-side bypass.
- Non-resident special overtime treatment is versioned separately and does not depend on the disputed junior-staff threshold.

### Casual workers

- Explicit `Employment.employment_type = CASUAL` activates the versioned casual-worker withholding rule.
- Classification is never inferred from title.
- Pension coverage/exemption for exceptional worker classifications is an open legal/product decision; see the limitations register.

### Relief claims

- Claims must use a definition from the institution's selected preset version.
- Ghana definitions require evidence through the shared Document record.
- Residency and configured fixed maximums are validated.
- Only `APPROVED` claims affect calculation.
- Annual relief application timing and calculated disability/mortgage caps remain open policy items.

## Ghana payroll item codes

These codes identify common statutory lines in `payroll-items/` and payslip payloads. The actual amount, rate, basis, and metadata are calculation snapshots.

| Code | Meaning | Effect |
|---|---|---|
| `GH_MANDATORY_PENSION_EMPLOYEE` | Employee mandatory pension | Employee contribution |
| `GH_MANDATORY_PENSION_EMPLOYER` | Employer mandatory pension | Employer contribution |
| `GH_PAYE_RESIDENT` | Resident graduated PAYE | Deduction |
| `GH_PAYE_NON_RESIDENT` | Non-resident regular employment tax | Deduction |
| `GH_BONUS_TAX` | Resident bonus concession tax | Deduction |
| `GH_OVERTIME_TAX` | Qualifying resident overtime tax | Deduction |
| `GH_CASUAL_WORKER_TAX` | Casual-worker withholding | Deduction |
| `GH_NON_RESIDENT_BONUS_TAX` | Non-resident bonus special tax | Deduction |
| `GH_NON_RESIDENT_OVERTIME_TAX` | Non-resident overtime special tax | Deduction |
| `GH_RELIEF_{RELIEF_CODE}` | Applied approved relief | Tax-relief basis reduction; not a cash deduction |

Do not calculate totals by code names alone. Use `PayrollRecord` totals and line-item `metadata.effect`/source snapshots.

## Compliance dates and notifications

For a September 2026 monthly period ending 2026-09-30, the initial preset projects:

```json
[
  {
    "code": "PENSION_MONTHLY_REMITTANCE",
    "authority": "SSNIT / Registered Tier 2 Trustee",
    "event_type": "PENSION_CONTRIBUTION_REMITTANCE",
    "due_date": "2026-10-14"
  },
  {
    "code": "GRA_PAYE_MONTHLY_RETURN",
    "authority": "Ghana Revenue Authority",
    "event_type": "PAYE_MONTHLY_RETURN_AND_PAYMENT",
    "due_date": "2026-10-15"
  }
]
```

Use the endpoint result, not these example dates, in production UI. Finalization creates compliance notifications for permission holders; it does not submit returns or remit funds.

## Statutory snapshot and historical display

Every run references its exact preset version and stores a `statutory_snapshot`. Payroll items snapshot their component code, name, rate, amount, and calculation metadata. Frontend historical views must use the run/record/item snapshot values, not recompute history from the currently active preset.

Finalized runs, records, and items are immutable. Corrections require a future correction-run workflow; ordinary PATCH is not available.

## Frontend behavior notes

- Show `GH-2026.1` and its effective date during setup and review.
- Show statutory-source metadata and any `validation_flags` to authorized configuration users.
- Require every paid employee to have a residency profile before exposing Calculate as ready; the backend will still enforce this.
- Present gross pay, statutory deductions, employee contributions, employer contributions, and net pay as distinct totals.
- Do not subtract employer contributions from employee net pay.
- Treat `GH_RELIEF_*` items as chargeable-income adjustments, not cash paid to the employee.
- Surface overtime validation failures as blocking compliance issues.
- Show compliance deadlines after period creation and again after finalization.
- Require explicit confirmation before finalization because it freezes results, closes the period, generates payslips, and creates reminders.
- Do not claim that a reminder is a filed return or successful remittance.

## Major validation errors to handle

| Error key or condition | Frontend response |
|---|---|
| `employee_payroll_profile` | Identify employees lacking explicit residency and link to payroll-profile configuration |
| `configuration` requiring GH/GHS/monthly | Return to payroll configuration; do not retry unchanged |
| `ghana_overtime_rule` | Block calculation and display legal-validation requirement |
| `preset_version` missing/invalid rule | Block processing and escalate configuration/support issue |
| `tax_relief`/`relief_definition`/`evidence` | Keep claim form open and show field-level validation |
| Reconciliation discrepancy | Disable finalization and show the reconcile response |

Use the shared Payroll error contract's top-level `code` for control flow and the field-level `errors` values for display. Ghana calculation/configuration failures that do not have a more specific workflow code use `validation_error`; their existing keys such as `employee_payroll_profile`, `ghana_overtime_rule`, and `preset_version` remain unchanged inside `errors`.

## Known limitations

- Only monthly GHS payroll is supported by `GH-2026.1`.
- The GHS 18,000 public overtime qualification threshold is legally gated.
- Daily minimum-wage enforcement is unavailable because compensation lacks pay basis and paid-days fields.
- Pension exemption/coverage status is not modelled.
- Approved annual relief timing and percentage/actual-amount validation require policy decisions.
- Automated GRA, SSNIT, NPRA, or trustee filing/remittance is not implemented.
- The complete maintained list is in `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`.

## Demo data

Run `python manage.py seed_payroll_demo` under development settings. The resulting `ERGONX-DEMO-GH` tenant demonstrates Ghana preset onboarding, resident and non-resident calculation, relief and adjustment workflow, finalized payslips, and compliance reminders. The command is idempotent and refuses `DEBUG=False`; login details are documented in the repository README.

## OpenAPI

- Schema: `/api/v1/schema/`
- Swagger UI: `/api/v1/docs/`
- Repository artifact: `openapi-schema.yml`

Use OpenAPI for field-level client generation and this document for Ghana-specific workflow and compliance behavior.

The schema includes operation summaries, access requirements, and `x-error-codes` for all Ghana-facing Payroll operations. Employee payroll-profile list/create/update requires `payroll.configure`; employee-role callers receive `permission_denied`.

The maintained API contract matrix covers every exposed setup-choice, configuration, employee-profile, and calculated-deadline operation for authentication, module gating, permission denial, tenant isolation, filters/search/pagination where applicable, rendered envelopes, stable codes, and documented validation behavior. See `tests/test_ghana_payroll_api_contract.py`.
