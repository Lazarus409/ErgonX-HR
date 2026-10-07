# Payroll Frontend Integration Contract

## Module

Payroll

Contract version: 1.3  
Implementation baseline: 2026-09-12

## Base URL

All paths below are relative to:

```text
/api/v1/
```

## Required module flag

`PAYROLL`

Access requires all three conditions:

```text
valid JWT
+ active institution context
+ PAYROLL enabled
+ required permission
```

If a user has multiple active institution memberships and no primary membership, send `X-Institution-ID` with an institution UUID belonging to that user.

## Response contract

All JSON responses use the shared envelope.

Success:

```json
{
  "success": true,
  "data": {},
  "message": "",
  "errors": null
}
```

Paginated list data:

```json
{
  "success": true,
  "data": {
    "count": 1,
    "next": null,
    "previous": null,
    "results": []
  },
  "message": "",
  "errors": null
}
```

The default page size is 25. `page_size` may be set up to 100.

Failure:

```json
{
  "success": false,
  "data": null,
  "message": "Only calculated payroll runs can enter review.",
  "code": "invalid_state_transition",
  "errors": {
    "status": ["Only calculated payroll runs can enter review."]
  }
}
```

Branch on the stable top-level `code`; use `message` and the documented field keys inside `errors` for display and form feedback.

## Permissions

| Permission | Purpose | Seeded role examples |
|---|---|---|
| `payroll.view` | View configuration, rules, periods, runs, records, and items | Institution Admin, HR Admin, Accountant, Finance Manager, Auditor |
| `payroll.configure` | Configure payroll and employee payroll profiles | Institution Admin, HR Admin |
| `payroll.prepare` | Create periods/runs, calculate, submit, cancel, and create adjustments | Institution Admin, HR Admin, Accountant |
| `payroll.approve` | Approve runs and decide adjustments | Institution Admin, HR Admin, Finance Manager |
| `payroll.finalize` | Finalize an approved run | Institution Admin, HR Admin, Finance Manager |
| `payslip.view` | View payslips | Institution Admin, HR Admin, Employee, Accountant, Finance Manager, Auditor |
| `tax_relief.view` | View relief claims within the caller's allowed scope | Institution Admin, HR Admin, Employee, Accountant, Finance Manager, Auditor |
| `tax_relief.claim` | Create and submit a relief claim | Institution Admin, HR Admin, Employee |
| `tax_relief.approve` | Approve or reject relief claims | Institution Admin, HR Admin, Finance Manager |

Role names are examples only. The backend authorizes permission codes, not role labels. Employee users are additionally restricted to their own relief claims and payslips.

## Endpoints

### Common query parameters

List endpoints support:

- `page`: one-based page number;
- `page_size`: 1–100;
- `search`: case-insensitive search across the endpoint's documented search fields;
- `ordering`: an allowed field, prefixed with `-` for descending order;
- endpoint-specific exact filters shown below.

### Read-only rule catalog endpoints

All catalog endpoints require `payroll.view`. They are globally defined system/configuration records, exposed only within authenticated PAYROLL-enabled tenant context. Frontend clients must treat them as read-only.

| Method | Path | Purpose | Filters | Search | Ordering | Response data |
|---|---|---|---|---|---|---|
| GET | `payroll-presets/` | List payroll presets | `country_code`, `is_system_managed` | `code`, `name`, `description` | `country_code`, `code`, `name`, `created_at` | Paginated `PayrollPreset[]` |
| GET | `payroll-presets/{id}/` | Retrieve a preset | — | — | — | `PayrollPreset` |
| GET | `payroll-preset-versions/` | List effective preset versions | `payroll_preset`, `status`, `effective_from` | version/preset code or name | `effective_from`, `version_code`, `created_at` | Paginated `PayrollPresetVersion[]` |
| GET | `payroll-preset-versions/{id}/` | Retrieve a preset version | — | — | — | `PayrollPresetVersion` |
| GET | `tax-rules/` | List tax rules | `preset_version`, `method`, `residency`, `basis`, `active` | `code`, `name` | `sequence`, `code`, `created_at` | Paginated `TaxRule[]` |
| GET | `tax-rules/{id}/` | Retrieve a tax rule | — | — | — | `TaxRule` |
| GET | `tax-bands/` | List progressive bands | `tax_rule` | — | `sequence`, `created_at` | Paginated `TaxBand[]` |
| GET | `tax-bands/{id}/` | Retrieve a band | — | — | — | `TaxBand` |
| GET | `contribution-rules/` | List contribution rules | `preset_version`, `basis`, `effective_from` | `code`, `name` | `code`, `effective_from`, `created_at` | Paginated `ContributionRule[]` |
| GET | `contribution-rules/{id}/` | Retrieve a contribution rule | — | — | — | `ContributionRule` |
| GET | `contribution-allocations/` | List contribution destinations | `contribution_rule`, `destination_type` | code/name/destination | default | Paginated `ContributionAllocation[]` |
| GET | `contribution-allocations/{id}/` | Retrieve an allocation | — | — | — | `ContributionAllocation` |
| GET | `special-income-rules/` | List bonus/overtime/casual rules | `preset_version`, `income_type`, `effective_from` | `code`, `name` | default | Paginated `SpecialIncomeRule[]` |
| GET | `special-income-rules/{id}/` | Retrieve a special-income rule | — | — | — | `SpecialIncomeRule` |
| GET | `tax-relief-definitions/` | List available relief definitions | `preset_version`, `requires_evidence` | `code`, `name` | default | Paginated `TaxReliefDefinition[]` |
| GET | `tax-relief-definitions/{id}/` | Retrieve a relief definition | — | — | — | `TaxReliefDefinition` |
| GET | `statutory-thresholds/` | List effective statutory values | `preset_version`, `unit`, `effective_from` | `code`, `name` | default | Paginated `StatutoryThreshold[]` |
| GET | `statutory-thresholds/{id}/` | Retrieve a threshold | — | — | — | `StatutoryThreshold` |
| GET | `compliance-deadlines/` | List deadline definitions | `preset_version`, `authority`, `event_type`, `effective_from` | code/authority/event | default | Paginated `ComplianceDeadline[]` |
| GET | `compliance-deadlines/{id}/` | Retrieve a deadline definition | — | — | — | `ComplianceDeadline` |

### Operational endpoints

| Method | Path | Purpose | Permission | Query parameters | Request payload | Response data | Major failure conditions |
|---|---|---|---|---|---|---|---|
| GET | `payroll-configurations/` | List the current institution's configuration | `payroll.view` | pagination | — | Paginated `PayrollConfiguration[]` | tenant/module/permission denial |
| POST | `payroll-configurations/` | Configure payroll | `payroll.configure` | — | `PayrollConfigurationInput` | `PayrollConfiguration` | invalid country/currency, inactive or country-mismatched preset, unsupported rounding |
| GET | `payroll-configurations/{id}/` | Retrieve configuration | `payroll.view` | — | — | `PayrollConfiguration` | not found in tenant |
| PATCH | `payroll-configurations/{id}/` | Update operational configuration | `payroll.configure` | — | partial `PayrollConfigurationInput` | `PayrollConfiguration` | same as create |
| GET | `payroll-configurations/choices/` | Get country-appropriate preset and Custom choices | `payroll.view` | — | — | `PayrollSetupChoices` | tenant/module/permission denial |
| GET | `employee-payroll-profiles/` | List employee tax profiles | `payroll.configure` | `employee`, `tax_residency`, `search` | — | Paginated `EmployeePayrollProfile[]` | tenant/module/permission denial |
| POST | `employee-payroll-profiles/` | Create or configure one employee profile | `payroll.configure` | — | `EmployeePayrollProfileInput` | `EmployeePayrollProfile` | employee belongs to another tenant, invalid residency |
| GET | `employee-payroll-profiles/{id}/` | Retrieve an employee profile | `payroll.configure` | — | — | `EmployeePayrollProfile` | not found in tenant |
| PATCH | `employee-payroll-profiles/{id}/` | Update tax residency/TIN | `payroll.configure` | — | partial `EmployeePayrollProfileInput` | `EmployeePayrollProfile` | tenant mismatch, invalid residency |
| GET | `payroll-periods/` | List periods | `payroll.view` | `status`, `start_date`, `end_date`, `pay_date`, `search`, `ordering` | — | Paginated `PayrollPeriod[]` | tenant/module/permission denial |
| POST | `payroll-periods/` | Open a payroll period | `payroll.prepare` | — | `PayrollPeriodInput` | `PayrollPeriod` | payroll not configured, overlapping active period, invalid dates |
| GET | `payroll-periods/{id}/` | Retrieve a period | `payroll.view` | — | — | `PayrollPeriod` | not found in tenant |
| GET | `payroll-periods/{id}/compliance-deadlines/` | Calculate due dates for the period | `payroll.view` | — | — | `PayrollComplianceDeadline[]` | unsupported configured deadline anchor |
| GET | `payroll-runs/` | List runs | `payroll.view` | `payroll_period`, `preset_version`, `status`, `run_number`, `ordering` | — | Paginated `PayrollRun[]` | tenant/module/permission denial |
| POST | `payroll-runs/` | Create a draft run | `payroll.prepare` | — | `PayrollRunInput` | `PayrollRun` | period not open, duplicate active run, conflicting idempotency key |
| GET | `payroll-runs/{id}/` | Retrieve a run | `payroll.view` | — | — | `PayrollRun` | not found in tenant |
| POST | `payroll-runs/{id}/calculate/` | Calculate all eligible employee records | `payroll.prepare` | — | empty object | updated `PayrollRun` | invalid run state, compensation/schedule/configuration/statutory validation failure |
| POST | `payroll-runs/{id}/submit-review/` | Submit calculated run for review | `payroll.prepare` | — | empty object | updated `PayrollRun` | run is not `CALCULATED` |
| POST | `payroll-runs/{id}/approve/` | Approve reviewed run | `payroll.approve` | — | empty object | updated `PayrollRun` | run is not `UNDER_REVIEW`, reconciliation discrepancy |
| POST | `payroll-runs/{id}/finalize/` | Finalize, close period, create payslips/reminders | `payroll.finalize` | — | empty object | updated `PayrollRun` | run is not `APPROVED`, no records, reconciliation discrepancy |
| POST | `payroll-runs/{id}/cancel/` | Cancel a pre-approval run | `payroll.prepare` | — | empty object | updated `PayrollRun` | approved/finalized run cannot be cancelled |
| GET | `payroll-runs/{id}/reconcile/` | Return derived totals and discrepancies | `payroll.view` | — | — | `PayrollReconciliation` | not found in tenant |
| GET | `payroll-records/` | List employee results | `payroll.view` | `payroll_run`, `employee`, `currency`, `status`, `ordering` | — | Paginated `PayrollRecord[]` | tenant/module/permission denial |
| GET | `payroll-records/{id}/` | Retrieve an employee result | `payroll.view` | — | — | `PayrollRecord` | not found in tenant |
| GET | `payroll-items/` | List result line items | `payroll.view` | `payroll_record`, `pay_component`, `source`, `search`, `ordering` | — | Paginated `PayrollItem[]` | tenant/module/permission denial |
| GET | `payroll-items/{id}/` | Retrieve a result line | `payroll.view` | — | — | `PayrollItem` | not found in tenant |
| GET | `payroll-adjustments/` | List adjustments | `payroll.view` | `employee`, `payroll_period`, `pay_component`, `status`, `ordering` | — | Paginated `PayrollAdjustment[]` | tenant/module/permission denial |
| POST | `payroll-adjustments/` | Create a draft adjustment | `payroll.prepare` | — | `PayrollAdjustmentInput` | `PayrollAdjustment` | tenant mismatch, zero amount, closed period |
| GET | `payroll-adjustments/{id}/` | Retrieve adjustment | `payroll.view` | — | — | `PayrollAdjustment` | not found in tenant |
| POST | `payroll-adjustments/{id}/submit/` | Submit adjustment for approval | `payroll.prepare` | — | empty object | updated `PayrollAdjustment` | not draft, closed period |
| POST | `payroll-adjustments/{id}/approve/` | Approve adjustment | `payroll.approve` | — | empty object | updated `PayrollAdjustment` | not pending |
| POST | `payroll-adjustments/{id}/reject/` | Reject adjustment | `payroll.approve` | — | empty object | updated `PayrollAdjustment` | not pending |
| GET | `employee-tax-relief-claims/` | List claims, self-scoped for Employee role | `tax_relief.view` | `employee`, `relief_definition`, `tax_year`, `status`, `ordering` | — | Paginated `EmployeeTaxReliefClaim[]` | tenant/module/permission denial |
| POST | `employee-tax-relief-claims/` | Create draft claim | `tax_relief.claim` | — | `TaxReliefClaimInput` | `EmployeeTaxReliefClaim` | wrong preset, ineligible employee, evidence/amount validation |
| GET | `employee-tax-relief-claims/{id}/` | Retrieve claim within allowed scope | `tax_relief.view` | — | — | `EmployeeTaxReliefClaim` | not found or hidden by self scope |
| POST | `employee-tax-relief-claims/{id}/submit/` | Submit draft claim | `tax_relief.claim` | — | empty object | updated claim | not draft, ownership violation |
| POST | `employee-tax-relief-claims/{id}/approve/` | Approve pending claim | `tax_relief.approve` | — | optional `TaxReliefDecisionInput` | updated claim | not pending, amount exceeds allowed claim/configured maximum |
| POST | `employee-tax-relief-claims/{id}/reject/` | Reject pending claim | `tax_relief.approve` | — | optional `TaxReliefDecisionInput` | updated claim | not pending |
| GET | `payslips/` | List payslips, self-scoped for Employee role | `payslip.view` | `payroll_record`, `generated_at`, `ordering` | — | Paginated `Payslip[]` | tenant/module/permission denial |
| GET | `payslips/{id}/` | Retrieve payslip and immutable payload | `payslip.view` | — | — | `Payslip` | not found or hidden by self scope |

`Payslip` includes a server-owned `payroll_period` summary with `id`, `name`,
`start_date`, `end_date`, `pay_date`, and `status`. The frontend must render
this returned summary and must not infer a period from a label or local date.

## Example payloads

### Request data shapes

UUID fields are strings. Dates use `YYYY-MM-DD`. Datetimes use ISO 8601. Decimal values are JSON strings in responses and may be sent as strings in requests.

#### PayrollConfigurationInput

```json
{
  "country_code": "GH",
  "currency": "GHS",
  "payroll_frequency": "MONTHLY",
  "payroll_setup_mode": "PRESET",
  "selected_payroll_preset_version": "<uuid>",
  "pay_day_rule": {},
  "rounding_rule": {"method": "HALF_UP", "decimal_places": 2},
  "is_configured": true
}
```

Use `selected_payroll_preset_version: null` with `payroll_setup_mode: CUSTOM`. MVP rounding is fixed to half-up with two decimal places.

#### EmployeePayrollProfileInput

```json
{
  "employee": "<uuid>",
  "tax_residency": "RESIDENT",
  "tax_identification_number": "GHA-000000000"
}
```

#### PayrollPeriodInput

```json
{
  "name": "September 2026",
  "start_date": "2026-09-01",
  "end_date": "2026-09-30",
  "pay_date": "2026-09-30"
}
```

#### PayrollRunInput

```json
{
  "payroll_period": "<uuid>",
  "idempotency_key": "payroll-2026-09-regular-v1"
}
```

Retrying with the same institution, key, and period returns the existing run. Reusing the key for a different period fails.

#### PayrollAdjustmentInput

```json
{
  "employee": "<uuid>",
  "payroll_period": "<uuid>",
  "pay_component": "<uuid>",
  "amount": "125.50",
  "reason": "Approved correction"
}
```

The sign and component type determine financial effect. Zero is rejected.

#### TaxReliefClaimInput

```json
{
  "employee": "<uuid>",
  "relief_definition": "<uuid>",
  "tax_year": 2026,
  "claimed_amount": "1200.00",
  "evidence": "<document-uuid>"
}
```

Attachments must already exist in the shared Document framework and belong to the same institution.

#### TaxReliefDecisionInput

```json
{
  "approved_amount": "1000.00"
}
```

The body is optional. If omitted during approval, the claimed amount is used.

### Important response data shapes

#### PayrollSetupChoices

```json
{
  "country_code": "GH",
  "currency": "GHS",
  "choices": [
    {
      "mode": "PRESET",
      "preset_version_id": "<uuid>",
      "preset_code": "GH-PAYROLL",
      "version_code": "GH-2026.1",
      "name": "Ghana Payroll",
      "recommended": true,
      "compliance_warning": null
    },
    {
      "mode": "CUSTOM",
      "preset_version_id": null,
      "preset_code": null,
      "version_code": null,
      "name": "Custom payroll configuration",
      "recommended": false,
      "compliance_warning": "No country statutory rules will be applied automatically. The institution is responsible for configuring and validating all applicable payroll obligations."
    }
  ]
}
```

#### PayrollReconciliation

```json
{
  "payroll_run_id": "<uuid>",
  "status": "CALCULATED",
  "record_count": 10,
  "totals": {
    "gross_pay": "30000.00",
    "total_deductions": "3868.80",
    "employee_contributions": "1650.00",
    "employer_contributions": "3900.00",
    "net_pay": "24481.20"
  },
  "source_totals": {},
  "component_totals": {},
  "discrepancy_count": 0,
  "discrepancies": []
}
```

#### PayrollComplianceDeadline

```json
{
  "compliance_deadline_id": "<uuid>",
  "code": "GRA_PAYE_MONTHLY_RETURN",
  "authority": "Ghana Revenue Authority",
  "event_type": "PAYE_MONTHLY_RETURN_AND_PAYMENT",
  "due_date": "2026-10-15"
}
```

## Status enums

Published status values:

- Payroll preset version: `DRAFT`, `ACTIVE`, `RETIRED`
- Payroll period: `OPEN`, `PROCESSING`, `CLOSED`
- Payroll run: `DRAFT`, `CALCULATING`, `CALCULATED`, `UNDER_REVIEW`, `APPROVED`, `FINALIZED`, `CANCELLED`
- Payroll record: `CALCULATED`, `FINALIZED`, `ERROR`
- Payroll adjustment: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `APPLIED`
- Employee tax relief claim: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`

### PayrollPresetVersion

| Status | Meaning | Mutable through tenant API |
|---|---|---|
| `DRAFT` | Version being prepared | No |
| `ACTIVE` | Selectable effective version | No |
| `RETIRED` | Historical/non-selectable version | No |

## Workflow transitions

### PayrollPeriod

```text
OPEN -> PROCESSING -> CLOSED
```

| Status | Available frontend actions | Mutable |
|---|---|---|
| `OPEN` | Create run | Only through services/actions |
| `PROCESSING` | Work with active run | Only through services/actions |
| `CLOSED` | View historical results | No |

### PayrollRun

```text
DRAFT -> CALCULATING -> CALCULATED -> UNDER_REVIEW -> APPROVED -> FINALIZED
  |             |             |
  +-------------+-------------+-> CANCELLED (only before approval)
```

| Status | Actions to show | Terminal | Mutable through ordinary PATCH |
|---|---|---:|---:|
| `DRAFT` | Calculate, Cancel | No | No PATCH endpoint |
| `CALCULATING` | Refresh/status only | No | No |
| `CALCULATED` | Reconcile, Submit review, Cancel | No | No |
| `UNDER_REVIEW` | Reconcile, Approve, Cancel | No | No |
| `APPROVED` | Reconcile, Finalize | No | No |
| `FINALIZED` | View records/items/payslips | Yes | No; run, records, and items are immutable |
| `CANCELLED` | View | Yes | No |

`CALCULATING` is normally transient because calculation is synchronous in the MVP.

### PayrollRecord

- `CALCULATED`
- `FINALIZED` — immutable
- `ERROR`

### PayrollAdjustment

```text
DRAFT -> PENDING -> APPROVED -> APPLIED
               \-> REJECTED
```

`APPLIED` is terminal and immutable. An approved adjustment becomes applied when consumed by a payroll calculation.

### EmployeeTaxReliefClaim

```text
DRAFT -> PENDING -> APPROVED
               \-> REJECTED
```

### Other published enums

- Payroll frequency: `WEEKLY`, `BIWEEKLY`, `SEMIMONTHLY`, `MONTHLY`
- Setup mode: `PRESET`, `CUSTOM`
- Tax residency: `RESIDENT`, `NON_RESIDENT`
- Tax method: `FLAT`, `PROGRESSIVE`, `SPECIAL`
- Tax/contribution basis: `BASE_SALARY`, `GROSS_PAY`, `TAXABLE_INCOME`
- Payroll item source: `COMPENSATION`, `ATTENDANCE`, `LEAVE`, `STATUTORY`, `ADJUSTMENT`, `MANUAL`

## Frontend behavior notes

- Never send an institution ID in a request body as authorization. Use authenticated tenant context and `X-Institution-ID` only when selection is required.
- Fetch `payroll-configurations/choices/` before setup. Do not infer or auto-select a preset solely from country.
- Display the Custom choice's compliance warning before saving it.
- Treat catalog data and all calculated/finalized records as read-only.
- Render workflow buttons from both the current status and the caller's permission. The backend remains authoritative.
- Require explicit user confirmation before Approve, Finalize, Reject, or Cancel actions.
- Run Reconcile before presenting Finalize. Finalization will reject discrepancies regardless.
- Calculation and finalization are synchronous in the MVP. Prevent duplicate clicks and retain the run's idempotency key on safe retries.
- Display money using the response currency; do not perform statutory calculations in the frontend.
- Employee-role claim and payslip lists are self-scoped. A missing foreign record may appear as 404 rather than revealing its existence.
- Finalization closes the period, freezes results, creates one payslip per record, and creates configured compliance notifications.
- Empty list screens should distinguish no records from module/permission failure using HTTP status and the error envelope.

## Workflow notifications and retry behavior

The service layer creates in-app notifications for these workflow handoffs:

| Trigger | Recipients | Notification type | Key metadata |
|---|---|---|---|
| Run submitted for review | `payroll.approve` holders | `PAYROLL_ACTION_REQUIRED` | `payroll_run_id` |
| Run approved | `payroll.finalize` holders | `PAYROLL_ACTION_REQUIRED` | `payroll_run_id` |
| Adjustment submitted | `payroll.approve` holders | `PAYROLL_ACTION_REQUIRED` | `payroll_adjustment_id` |
| Relief claim submitted | `tax_relief.approve` holders | `TAX_RELIEF_ACTION_REQUIRED` | `tax_relief_claim_id` |
| Relief claim approved | Linked employee user | `TAX_RELIEF_CLAIM_APPROVED` | claim ID, status, approved amount |
| Relief claim rejected | Linked employee user | `TAX_RELIEF_CLAIM_REJECTED` | claim ID, status, approved amount |
| Run finalized | Linked employee user | `PAYSLIP_AVAILABLE` | `payslip_id` |
| Configured statutory deadline | `payroll.finalize` holders | `PAYROLL_COMPLIANCE_DEADLINE` | run ID, deadline ID, due date |

Matching retries of submit, run approval, adjustment decision, or relief decision are side-effect safe: they return the current resource without creating duplicate audit events or notifications. An opposite decision or otherwise incompatible transition still returns `invalid_state_transition`.

Critical transition audit events carry `before.status` and `after.status`. Requests made through the API also capture the direct remote IP and user agent when available; trusted-proxy interpretation is intentionally left to deployment infrastructure rather than accepting a spoofable forwarding header by default.

## Major HTTP/error behavior

Every failed API response includes a stable top-level `code` and retains the existing field-level `errors` object:

```json
{
  "success": false,
  "data": null,
  "message": "The PAYROLL module is disabled.",
  "code": "module_disabled",
  "errors": {
    "detail": "The PAYROLL module is disabled."
  }
}
```

The added `code` field is backward-compatible. Existing clients may continue rendering `message` and field keys inside `errors`; new clients should branch on `code` rather than matching human-readable text.

| HTTP status | Code | Meaning |
|---|---|---|
| `400` | `validation_error` | Serializer, field, or uncategorized business validation failed |
| `400` | `invalid_state_transition` | The requested workflow action is not valid from the current status |
| `400` | `record_immutable` | A finalized or otherwise immutable record rejects the operation |
| `400` | `period_closed` | The operation cannot be applied to a closed payroll period |
| `400` | `duplicate_operation` | The request would duplicate or conflict with an idempotent operation |
| `400` | `invalid_request` | The request body could not be parsed |
| `401` | `authentication_required` | Authentication credentials are missing |
| `401` | `authentication_failed` | Supplied credentials or token are invalid |
| `403` | `tenant_mismatch` | The requested institution is invalid, ambiguous, or not in the user's active memberships |
| `403` | `module_disabled` | The endpoint's institution module is disabled |
| `403` | `permission_denied` | The active role lacks the required permission |
| `404` | `not_found` | Record absent or outside the caller's tenant/self scope |
| `405` | `method_not_allowed` | The route does not support the HTTP method |

The full shared error-code enum is published in OpenAPI's `ErrorEnvelope`. Do not use a 404 to infer whether a foreign-tenant record exists.

## Known limitations

- Base salary is currently interpreted as the amount for one configured payroll period.
- Mid-period compensation changes require an explicit proration rule and fail closed.
- Correction runs, off-cycle payroll, payment/export workflows, and async job execution are deferred.
- Direct statutory filing/remittance is not implemented.
- See `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md` for the maintained authoritative register.

## Demo data

Run `python manage.py seed_payroll_demo` with development settings to create the deterministic Ghana payroll demonstration. It includes administrator and employee logins, resident/non-resident records, compensation, an adjustment and relief claim, a finalized run, payslips, and reminders. The command refuses `DEBUG=False`; setup and credentials are documented in the repository README.

## OpenAPI

- Schema: `/api/v1/schema/`
- Swagger UI: `/api/v1/docs/`
- Repository artifact: `openapi-schema.yml`

OpenAPI is the field-level source for generated clients. This note defines workflow, permission, and frontend behavior that cannot be inferred safely from schemas alone.

Every current Payroll-related operation includes a summary, purpose, authentication/tenant/module/permission requirements, and `x-error-codes`. Workflow actions accurately distinguish no-body transitions from relief approval's `TaxReliefDecision` payload. Custom deadline/reconciliation actions do not inherit unrelated list filters or pagination.
