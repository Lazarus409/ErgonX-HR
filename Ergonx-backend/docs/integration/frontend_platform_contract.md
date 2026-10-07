# ErgonX Frontend Platform Contract

Contract version: 1.0  
API version: v1  
Implementation baseline: 2026-09-21

## Scope

This contract governs the shared frontend surfaces that sit across ErgonX modules:

- browser/PWA shell behavior;
- shared response, authentication, tenant, module, permission, pagination, and error rules;
- dashboards and reports;
- shared documents;
- generalized approvals;
- import/export and background-job foundations.

Module-specific workflow contracts remain in the neighboring `docs/integration/*_frontend_contract.md` files. This document does not replace those files; it defines the shared assumptions they rely on.

## Base URL

All API paths below are relative to:

```text
/api/v1/
```

Authenticated tenant requests must send:

```text
Authorization: Bearer <access-token>
X-Institution-ID: <institution-uuid>
```

If the user has exactly one active institution context, the backend may infer it. If the user has multiple active institution memberships, the frontend must send `X-Institution-ID` explicitly.

## Response Envelope

JSON API responses use the shared envelope:

```json
{
  "success": true,
  "data": {},
  "message": "",
  "errors": null
}
```

Paginated list responses wrap the page inside `data`:

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

Errors include a stable top-level `code` when raised through the shared API exception layer:

```json
{
  "success": false,
  "data": null,
  "message": "Only validated import jobs can be confirmed.",
  "code": "invalid_state_transition",
  "errors": {
    "status": ["Only validated import jobs can be confirmed."]
  }
}
```

Frontend behavior:

- Branch on stable `code` values where present.
- Display `message` as the user-facing summary.
- Map `errors` field keys to form inputs when possible.
- Treat non-envelope CSV report responses as file downloads.

## Shared Access Rules

Every operational screen must satisfy all applicable checks:

```text
valid JWT
+ active institution context
+ required module flag
+ required permission
```

Permissions do not bypass disabled modules. Tenant-scoped API results must never be merged across institution contexts in the browser.

Default list pagination uses page-number pagination:

- `page`;
- `page_size`;
- default page size 25;
- maximum page size 100.

## PWA application-shell baseline

The active frontend is `ergonx-frontend/`. It provides a production-only
installable shell: `/manifest.webmanifest` declares the standalone ErgonX app,
`ServiceWorkerRegistration` registers `/sw.js`, and `/offline` is a static,
honest reconnection fallback.

The worker pre-caches only the manifest, logo, and offline page, then
runtime-caches only same-origin static script/style/font/image assets. It never
caches navigation pages, `/api/` requests, report exports, JWTs,
selected-institution values, or tenant data, and it never queues writes. An
offline user sees the reconnection page rather than stale HR, payroll,
attendance, leave, accounting, approval, import, export, or document data.

## Browser session boundary

Browser calls use the same-origin `/api/v1/*` Next.js BFF route. Login and
refresh responses are stripped of bearer tokens before reaching JavaScript;
the BFF stores access and refresh tokens in `HttpOnly`, `SameSite=Lax` cookies
and attaches the access token only when forwarding to Django. The browser keeps
only a non-sensitive local session hint and selected institution UUID.

Unsafe proxy methods reject a supplied cross-origin `Origin` value. The proxy
does not cache API responses, and its own logout route clears both token
cookies. HTTPS deployments receive `Secure` cookies; local HTTP loopback is
supported for development. CSP and related headers remain defence in depth,
not a replacement for server-side authorization.

## Dashboard Contract

Required module/permission:

```text
dashboard.<dashboard-name>.view
```

Routes:

| Method | Path | Purpose | Response data |
|---|---|---|---|
| GET | `/dashboards/executive/` | Institution-level executive rollup | employee counts, pending leave/journals, finalized payroll cost, current attendance, operational financial position including registered-bank balance/account count, tenant-scoped recruitment activity (open jobs, active candidates, applications, scheduled interviews, and extended offers), finalized payroll-by-period series, posted-ledger P&L, and registered-bank cash movement (`month`, `inflow`, `outflow`, `net_movement`) |
| GET | `/dashboards/hr/` | HR workforce rollup | employee counts, status mix, hire-year distribution, active-current-employment distributions (department, grade, location, employment type), and five recent active hires |
| GET | `/dashboards/leave/` | Leave rollup | pending, currently-on-leave, upcoming counts, approved leave-type distribution, six-month approved-leave activity series, and current-year aggregated balance utilisation (`entitlement_days`, `used_days`, `available_days`, nullable `utilisation_percent`) |
| GET | `/dashboards/attendance/` | Attendance operations rollup | today's present/late/absent/overtime totals, a seven-day attendance series, and today-by-current-department attendance counts |
| GET | `/dashboards/payroll/` | Payroll operations rollup | latest run, pending runs, finalized gross/net pay, deductions, employer contributions, run-status mix, and finalized payroll-by-period series |
| GET | `/dashboards/finance/` | Finance operations rollup | pending journals, open AP, open AR, posted expenses, registered-bank balance/account count, AP/AR aging buckets, journal status mix, a six-point maximum posted-ledger P&L series (`month`, `income`, `expenses`, `net_income`), and a six-point maximum registered-bank cash-movement series (`month`, `inflow`, `outflow`, `net_movement`) |

Frontend behavior:

- Treat all numeric totals as tenant-scoped summaries, not ledger-grade financial statements.
- `weekly_attendance` contains exactly the current date and six preceding calendar dates; a day without recorded attendance is returned as zero values rather than omitted.
- HR employment distributions include only active employees with one current employment record. They must not be interpreted as all historical employment assignments.
- Render missing latest payroll run fields as an empty state when `latest_run_id` is `null`.
- Refresh dashboards after workflow actions that can change counts or totals.
- `bank_balance` and `cash_flow_trend` include only active `BankAccount.ledger_account` records and posted journals. An arbitrary asset account is not treated as cash; empty bank configuration yields zero balance and an empty movement series.

## Audit History Contract

## Accounting localisation catalogue contract

The Accounting module exposes the authoritative tax and withholding catalogue
attached to a preset. These are read-only catalogue endpoints: a browser must
never derive, modify, or substitute statutory rates.

All routes require an active institution, the `ACCOUNTING` module, and
`account.view`:

| Method | Path | Supported selectors | Purpose |
|---|---|---|---|
| GET | `/tax-codes/` | `preset_version`, `code`, `tax_treatment`, `is_active`, `effective_from` | Tax codes and their effective dates |
| GET | `/tax-components/` | `tax_code`, `code`, `sequence` | Rate components for a tax code |
| GET | `/withholding-rules/` | `preset_version`, `code`, `residency`, `transaction_category`, `is_vat_withholding_rule`, `requires_confirmation`, `effective_from` | Withholding rules and thresholds |
| GET | `/ghana-compliance-reminders/` | `code`, `status`, `due_date` | Institution-owned Ghana compliance reminders |

Frontend behaviour:

- Read the current institution accounting configuration first. Only request
  catalogue records for its `selected_accounting_preset_version`.
- If no preset is selected, render the configuration-required state and link
  to the authorized accounting-setup route; do not display country-default
  rates or inferred rules.
- Query tax components by each returned tax-code UUID. Do not download a
  global component list and filter it in the browser.
- Treat all rates and effective dates as display-only data. Applying a preset
  remains the separately confirmed backend workflow.
- `/ghana-compliance-reminders/` requires `financial_report.view` for reads;
  only show that optional compliance section when the active membership has
  that permission. Never represent an inaccessible reminder list as empty.

`GET /audit/` requires `audit.view`, an active institution context, and returns
only that institution's audit records. It is read-only and paginated. Supported
filters are `from`, `to`, `actor`, `action`, `entity_type`, `entity_id`, and
`q`. `entity_id` must be a UUID. Sensitive metadata values are redacted by the
API before the frontend receives them.

## Notifications Contract

All notification endpoints require `home.view`, an active institution context,
and return only the authenticated recipient's in-app notifications in that
institution. They never expose notification metadata to another recipient.

| Method | Path | Purpose |
|---|---|---|
| GET | `/notifications/` | Paginated notification history; pass `unread=true` for unread items only |
| POST | `/notifications/{id}/mark-read/` | Mark one recipient-owned notification read |
| POST | `/notifications/mark-all-read/` | Mark the active recipient's in-app notifications read |

The frontend top-bar tray may show a compact unread subset. `/notifications`
is the full history surface. A successful mark-read response is authoritative;
the UI must not optimistically claim a notification is read before that
response returns.

## Reports Contract

Required permission:

```text
report.view
```

Routes:

| Method | Path | Purpose | Optional query | Response |
|---|---|---|---|---|
| GET | `/reports/workforce-cost/` | Employee count by status plus payroll totals | `export=csv`, `status` | JSON rows or CSV download |
| GET | `/reports/recruitment/` | Recruitment applications by status | `export=csv`, `status` | JSON rows or CSV download |
| GET | `/reports/leave/` | Leave requests by status | `export=csv`, `status` | JSON rows or CSV download |
| GET | `/reports/attendance/` | Attendance records by status | `export=csv`, `status` | JSON rows or CSV download |
| GET | `/reports/payroll/` | Payroll records by run status | `export=csv`, `status` | JSON rows or CSV download |
| GET | `/reports/accounting/` | Journal count by source/status | `export=csv`, `status` | JSON rows or CSV download |
| GET | `/reports/ap-ar/` | Open AP and AR amounts | `export=csv` | JSON rows or CSV download |
| GET | `/reports/expenses/` | Expense count and amount by status | `export=csv`, `status` | JSON rows or CSV download |

JSON shape:

```json
{
  "success": true,
  "data": {
    "report": "workforce-cost",
    "rows": []
  },
  "message": "",
  "errors": null
}
```

Frontend behavior:

- Use `export=csv` for spreadsheet-ready downloads. Report selectors also accept `date_from` and `date_to` (`YYYY-MM-DD`) where the source model has a date boundary; invalid or reversed ranges fail clearly rather than returning misleading totals.
- Treat CSV responses as file downloads, not JSON.
- Native XLSX/PDF rendering and scheduled/generated report artifacts are not part of the current MVP contract; see `REPORT-001`.

## Documents Contract

Required permissions:

- `document.view`;
- `document.create`;
- `document.update`;
- `document.delete`.

Routes:

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/documents/` | List tenant documents | `document.view` |
| POST | `/documents/` | Create document metadata record | `document.create` |
| GET | `/documents/{id}/` | Read document metadata | `document.view` |
| PATCH | `/documents/{id}/` | Update document metadata | `document.update` |
| DELETE | `/documents/{id}/` | Delete document metadata record | `document.delete` |

Supported filters:

- `category`;
- `classification`;
- `entity_type`;
- `entity_id`;
- `is_active`;
- search by `original_filename`, `category`, or `entity_type`.

Fields:

```json
{
  "id": "document-uuid",
  "institution": "institution-uuid",
  "uploaded_by": "user-uuid",
  "file_reference": "storage/key/or/url",
  "original_filename": "contract.pdf",
  "content_type": "application/pdf",
  "size_bytes": 12345,
  "category": "employee-document",
  "classification": "CONFIDENTIAL",
  "checksum": "optional-checksum",
  "entity_type": "employee.Employee",
  "entity_id": "entity-uuid",
  "is_active": true,
  "created_at": "2026-09-13T00:00:00Z",
  "updated_at": "2026-09-13T00:00:00Z"
}
```

Classification values:

- `INTERNAL`;
- `CONFIDENTIAL`;
- `RESTRICTED`.

Frontend behavior:

- This API stores document metadata and storage references; it is not a binary upload endpoint.
- `institution`, `uploaded_by`, `created_at`, and `updated_at` are server-managed.
- `file_reference` is required and must not be blank.
- Use `entity_type` plus `entity_id` to attach a document to a domain record.
- Use `is_active=false` for soft hiding where product policy prefers retention.

## Approval Contract

Required permissions:

- `approval_workflow.view`;
- `approval_workflow.create`;
- `approval_workflow.update`;
- `approval_workflow.delete`;
- `approval_request.view`;
- `approval_request.create`.

Routes:

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET/POST | `/approval-workflows/` | List/create workflow definitions | `approval_workflow.view/create` |
| GET/PATCH/DELETE | `/approval-workflows/{id}/` | Read/update/delete workflow definition | `approval_workflow.view/update/delete` |
| GET/POST | `/approval-workflow-steps/` | List/create workflow steps | `approval_workflow.view/create` |
| GET/PATCH/DELETE | `/approval-workflow-steps/{id}/` | Read/update/delete workflow step | `approval_workflow.view/update/delete` |
| GET/POST | `/approval-requests/` | List/create approval requests | `approval_request.view/create` |
| GET | `/approval-requests/{id}/` | Read approval request | `approval_request.view` |
| POST | `/approval-requests/{id}/approve/` | Approve current step | tenant context plus assigned approver/role service gate |
| POST | `/approval-requests/{id}/reject/` | Reject current request | tenant context plus assigned approver/role service gate |
| POST | `/approval-requests/{id}/cancel/` | Cancel own pending request | tenant context plus requester service gate |
| GET | `/approval-actions/` | List read-only action history | `approval_request.view` |
| GET | `/approval-actions/{id}/` | Read action history item | `approval_request.view` |

Workflow definition fields:

```json
{
  "code": "EXPENSE_APPROVAL",
  "name": "Expense approval",
  "workflow_type": "EXPENSE",
  "entity_type": "accounting.Expense",
  "is_active": true
}
```

Workflow step fields:

```json
{
  "workflow": "workflow-uuid",
  "order": 1,
  "name": "Finance review",
  "approver_role": "role-uuid",
  "approver_user": null,
  "due_after_hours": 24
}
```

Approval request create payload:

```json
{
  "workflow": "workflow-uuid",
  "entity_type": "accounting.Expense",
  "entity_id": "entity-uuid",
  "metadata": {
    "display_label": "Expense EXP-001"
  }
}
```

Decision payload:

```json
{
  "comments": "Approved for posting."
}
```

Request status values:

- `PENDING`;
- `APPROVED`;
- `REJECTED`;
- `CANCELLED`.

Action values:

- `APPROVE`;
- `REJECT`;
- `RETURN`;
- `CANCEL`.

Current transition behavior:

```text
PENDING -> APPROVED
PENDING -> REJECTED
PENDING -> CANCELLED
```

For multi-step workflows, approval advances to the next configured step until the final step approves the request.

Frontend behavior:

- Do not PATCH `status`, `current_step`, `requested_by`, `due_at`, or `completed_at`.
- Render action buttons from request `status`, current user assignment/role, and tenant context. Decision endpoints are currently guarded by the approval service's assignment checks, not by separate `approval_request.approve` or `approval_request.reject` permission codes.
- Treat approval actions as immutable audit history.
- A workflow step must have either `approver_role` or `approver_user`.
- Same-tenant role/user validation is enforced by the backend.
- Current generalized approval requests do not automatically mutate the domain entity. Domain modules must still perform their own state transition or call their own workflow action.

## Import, Export, And Background Jobs Contract

Required permissions:

- `import_job.view`;
- `import_job.create`;
- `export_job.view`;
- `export_job.create`;
- `background_job.view`.

Import routes:

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET/POST | `/import-jobs/` | List/create import job records | `import_job.view/create` |
| GET | `/import-jobs/{id}/` | Read import job | `import_job.view` |
| POST | `/import-jobs/{id}/confirm/` | Confirm a validated import for commit | `import_job.create` |
| GET | `/import-row-results/` | List row validation/import results | `import_job.view` |
| GET | `/import-row-results/{id}/` | Read row result | `import_job.view` |

Import create payload:

```json
{
  "import_type": "ATTENDANCE",
  "file_reference": "imports/attendance-2026-09.csv",
  "metadata": {
    "schema_version": "attendance-import-v1"
  }
}
```

Import status values:

- `UPLOADED`;
- `VALIDATING`;
- `READY`;
- `COMMITTING`;
- `COMPLETED`;
- `FAILED`;
- `CANCELLED`.

Row result status values:

- `VALID`;
- `INVALID`;
- `IMPORTED`;
- `SKIPPED`.

Implemented import handler schemas:

- `EMPLOYEE`: existing employee-import v1 schema.
- `ATTENDANCE`: `attendance-import-v1` requires normalized
  `employee_number`, `attendance_date` (ISO date), and `status`. It accepts
  optional ISO `check_in`/`check_out`, minute totals, and `notes`. Employee
  lookup is tenant-scoped; a row is skipped if that employee already has any
  attendance record on that date (scheduled or unscheduled). Successfully
  committed records are always marked with source `IMPORT`.

Export routes:

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET/POST | `/export-jobs/` | List/create export job records | `export_job.view/create` |
| GET | `/export-jobs/{id}/` | Read export job | `export_job.view` |
| GET | `/export-jobs/{id}/download/` | Download completed CSV artifact | `export_job.view`; returns `409` until complete |

Export create payload:

```json
{
  "export_type": "REPORT_WORKFORCE_COST",
  "metadata": {
    "format": "csv"
  }
}
```

Export status values:

- `QUEUED`;
- `RUNNING`;
- `COMPLETED`;
- `FAILED`;
- `CANCELLED`.

Background job routes:

| Method | Path | Purpose | Permission |
|---|---|---|---|
| GET | `/background-jobs/` | List tenant-visible background jobs | `background_job.view` |
| GET | `/background-jobs/{id}/` | Read tenant-visible background job | `background_job.view` |

Background job status values:

- `QUEUED`;
- `RUNNING`;
- `SUCCEEDED`;
- `FAILED`;
- `CANCELLED`.

Frontend behavior:

- Create an import job only after the file has a durable `file_reference`.
- Enable import confirmation only when `status` is `READY` and `invalid_rows` is zero or policy accepts warnings.
- `confirm` returns HTTP 409 when the job is not `READY`.
- Poll the import/export/background-job record for completion status; do not assume create means the work has finished.
- Display `error_summary` for failed jobs.
- Committed import handlers are `EMPLOYEE` and `ATTENDANCE`; use their versioned
  schemas rather than inferring a generic column format.
- Export job creation records and queues a normalized report type (`REPORT_WORKFORCE_COST` or `workforce-cost` forms are accepted). The worker generates a tenant-scoped CSV artifact and the download action returns `409` until the job is complete; artifacts are bounded to 10 MB inline storage. Non-report exports still require explicit handlers.

## Current Frontend Limitations

The following limitations are intentionally part of the current contract and are tracked in `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`:

- `PWA-001`: resolved by the static-only production PWA shell; see the cache boundary above.
- `PWA-002`: resolved by the same-origin HttpOnly-cookie/BFF session boundary.
- `PWA-003`: initial operational module screens are read-oriented.
- `REPORT-001`: MVP report exports are CSV only.
- `OPS-001`: report CSV export jobs are now handled; non-report import/export types still require explicit schema/version/idempotency handlers.

## Existing Module Contracts

## Release-candidate cross-cutting additions

- Authentication accepts an optional `mfa_code` on `POST /api/auth/login/`. When MFA is enabled for the user, the API returns `401` with `api_code=mfa_required` until a valid six-digit TOTP is supplied. MFA setup is managed through `GET|POST|PUT|DELETE /api/auth/security/mfa/`; setup returns an `otpauth_uri`, while confirmation enables the secret.
- Profile payloads expose `avatar_key`; the self-service profile screen persists the selected key through the normal profile update endpoint.
- Audit rows expose `ip_address` and `user_agent`; clients should display the IP as a normal table column and treat null as unavailable.
- Notification payloads may expose `route_hint`. Clicking a notification marks it read and navigates to that route when present.
- Accounting reports use `GET /api/accounting/reports/income-statement/` and `GET /api/accounting/reports/balance-sheet/`; trial balance remains available through its existing endpoint. Report cards are responsive and must not be shown as payroll setup controls.
- Payslip detail must tolerate a missing or deleted payroll period and render the institution name from the active institution context.
- Executive and finance dashboard payloads include `currency`, `profit_and_loss_trend`, and `cash_flow_trend`. These series are derived from posted journals, are tenant-scoped, and include up to twelve available monthly periods. The Accounting dashboard renders detailed full-width P&L and inflow/outflow visualizations; the Executive dashboard renders compact financial KPIs and one summarized performance chart.
- Document uploads may use multipart `POST /api/v1/documents/` with `uploaded_file` plus `category`, `classification`, and optional entity fields. Managed uploads accept PDF/JPEG/PNG files up to 10 MB, validate file signatures, and expose protected `GET /api/v1/documents/{id}/download/`; leave supporting uploads use category `LEAVE_SUPPORTING` and the `leave.request` permission.
- Attendance dashboard responses include `repeated_lateness`, `lateness_trend`, and `lateness_by_department`, all tenant-scoped and permission-gated. The frontend presents the employee name, number, department, late occurrences, and total minutes late in a neutral Repeated Lateness table.

Use these module contracts for domain-specific workflows:

- `docs/integration/payroll_frontend_contract.md`;
- `docs/integration/ghana_payroll_frontend_contract.md`;
- `docs/integration/accounting_frontend_contract.md`;
- `docs/integration/accounting_presets_frontend_contract.md`;
- `docs/integration/ghana_accounting_localization_frontend_contract.md`;
- `docs/integration/payroll_accounting_frontend_contract.md`;
- `docs/integration/accounts_payable_frontend_contract.md`;
- `docs/integration/accounts_receivable_frontend_contract.md`;
- `docs/integration/cash_bank_frontend_contract.md`;
- `docs/integration/bank_reconciliation_frontend_contract.md`;
- `docs/integration/expenses_frontend_contract.md`.
