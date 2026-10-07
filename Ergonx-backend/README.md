# ErgonX backend

ErgonX is a tenant-aware Django/DRF modular monolith. It contains accounts, institution-scoped RBAC and module enablement, organization records, employees and temporal employment history, configurable Leave, Work Scheduling, Attendance, Compensation, generic Payroll, Ghana payroll localization, and an Accounting Core ledger, plus audit, document, approval, notification, configuration, and import/job foundations.

## Requirements

- Python 3.12+
- PostgreSQL 16+
- pip
- Docker Compose (optional, for the included local PostgreSQL service)

## Local setup

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements/development.txt
Copy-Item .env.example .env
```

Load the variables from `.env` using your shell or development environment. The application reads environment variables directly. To start PostgreSQL with Docker:

```powershell
docker compose up -d postgres
```

Set a real `POSTGRES_PASSWORD` in your environment, then initialize and run the API:

```powershell
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

The API is under `/api/v1/`; Swagger UI is available at `/api/v1/docs/` and the OpenAPI schema at `/api/v1/schema/`. Operations publish summaries, access requirements, query/action contracts, and machine-readable error metadata. Failed API responses retain the standard envelope and field-level errors while exposing a stable top-level `code` such as `validation_error`, `permission_denied`, `module_disabled`, `tenant_mismatch`, or `record_immutable`.

## Tenant selection and authorization

JWT-authenticated tenant endpoints resolve an active `InstitutionMembership`. If the user has one active membership, it is selected automatically. A primary active membership takes precedence. Users with multiple active memberships and no primary membership must send `X-Institution-ID`, and the selected ID must match one of their own active memberships. Client-supplied institution IDs never grant access.

Every tenant-owned queryset is scoped to the resolved institution. Role permissions and institution module enablement are separate gates; both must allow an operation. New institutions receive standard tenant roles, an enabled `CORE_HR` module, and disabled `LEAVE`, `ATTENDANCE`, `PAYROLL`, and `ACCOUNTING` modules that can be configured before activation. Scheduling is governed by the `ATTENDANCE` module gate; Compensation and Payroll are governed by `PAYROLL`; Accounting Core is governed by `ACCOUNTING`.

Tenant-owned models validate cross-table institution invariants on normal ORM saves. Critical Position, Employment, and Membership flows also expose transaction-wrapped service functions; application code should use these services rather than assembling domain writes in views.

## Authentication

```text
POST /api/v1/auth/login/
POST /api/v1/auth/refresh/
GET  /api/v1/auth/me/
GET  /api/v1/institutions/current/
GET  /api/v1/institutions/memberships/
```

Use the access token as `Authorization: Bearer <token>`.

## Migrations and checks

```powershell
python manage.py makemigrations --check --dry-run
python manage.py migrate
python manage.py check
python manage.py spectacular --file openapi-schema.yml --validate
```

## Tests

The test settings use a disposable SQLite database so the suite can run in CI without a service dependency. Runtime development and production settings are PostgreSQL 16-oriented.

```powershell
pytest
pytest --cov=apps --cov=common --cov-report=term-missing
```

The suite covers uniqueness, temporal Employment and ScheduleAssignment history, leave eligibility and approvals, balance accrual/carry-forward, schedule resolution, schedule-aware attendance, overtime, compensation and payroll calculations, payroll lifecycle immutability, double-entry journals, period controls, accounting reports, same-tenant validation, tenant isolation, RBAC, module enablement, and spoofed tenant selection.

CI runs migrations and the full suite against PostgreSQL 16. For the same verification locally:

```powershell
docker compose up -d postgres
$env:DJANGO_SETTINGS_MODULE = "config.settings.test_postgres"
$env:POSTGRES_DB = "ergonx"
$env:POSTGRES_USER = "ergonx"
$env:POSTGRES_PASSWORD = "ergonx"
python manage.py migrate
pytest
```

## Deterministic payroll demo

With development settings and migrated data, create or refresh the Ghana Payroll demonstration dataset with:

```powershell
python manage.py seed_payroll_demo
```

The command creates the reserved `ERGONX-DEMO-GH` tenant, three demo users, two employees with resident/non-resident payroll profiles, compensation and bonus configuration, an approved relief claim and adjustment, a finalized September 2026 run, two payslips, and compliance reminders. It is idempotent: rerunning it reuses the same business records and does not duplicate financial consequences, audit events, or notifications.

Default development credentials use password `ErgonX-Demo-2026!` for:

- `demo.admin@ergonx.local`
- `demo.resident@ergonx.local`
- `demo.nonresident@ergonx.local`

Override the password with `--password`. The command refuses to run when `DEBUG=False` and must never be used as a production data loader.

## Deterministic Accounting Core demo

Create or refresh the Accounting Core demonstration ledger with:

```powershell
python manage.py seed_accounting_demo
```

The command creates the reserved `ERGONX-DEMO-ACCOUNTING` tenant, a clearly marked development-only accounting preset/version/chart, three mapped account templates, applied GHS/IFRS configuration, FY2026 and a September period, and two posted journals that produce a balanced trial balance, income statement, and balance sheet. Login is `demo.accounting@ergonx.local`; the default password is `ErgonX-Demo-2026!` and can be changed with `--password`. The command is deterministic, refuses `DEBUG=False`, and does not duplicate records or financial effects on rerun.

## Employee filtering

`GET /api/v1/employees/` supports `status`, `department`, `grade`, `location`, and `employment_type` filters. Assignment filters resolve through the employee's current Employment record. Search and ordering remain available.

## Leave, Scheduling, and Attendance

Leave endpoints are exposed under `/api/v1/leave-*`. Leave types and policies are configuration-driven, including department, grade, location, employment-type, and gender eligibility. Requests use explicit submit/approve/reject/cancel transitions; approved balances are transactionally consumed and restored on cancellation. Cross-year leave must currently be split into separate annual requests.

Scheduling endpoints include `/api/v1/shifts/`, `/api/v1/shift-patterns/`, `/api/v1/rotation-patterns/`, `/api/v1/flexible-work-rules/`, `/api/v1/work-schedules/`, and `/api/v1/schedule-assignments/`. Replacing a current assignment preserves the previous effective-dated record.

Attendance endpoints include `/api/v1/attendance-records/`, `/api/v1/attendance-records/calendar/`, `/api/v1/attendance-adjustments/`, and `/api/v1/overtime-records/`. Clock events resolve the employee's effective schedule, support PWA as a source, classify lateness/early departure/overtime, and prevent clock-in during approved leave. Calendar rows and their status/minute fields provide the derived attendance-alert projection; no duplicate alert table is maintained. Only approved overtime is consumed by Payroll.

## Compensation

Compensation endpoints include `/api/v1/pay-components/`, `/api/v1/salary-structures/`, `/api/v1/salary-structure-components/`, `/api/v1/employee-compensations/`, and `/api/v1/employee-pay-components/`. Compensation changes are effective-dated and preserve the prior salary record. Employee component overrides are also temporal; the resolved endpoint combines structure defaults, base-salary percentages, component-based percentages, and employee overrides without mutating history.

## Payroll

Payroll configuration and rule catalog endpoints expose country-neutral, versioned presets, tax bands, contributions, relief definitions, statutory thresholds, and compliance deadlines. Transaction endpoints include `/api/v1/payroll-periods/`, `/api/v1/payroll-runs/`, `/api/v1/payroll-records/`, `/api/v1/payroll-items/`, `/api/v1/payroll-adjustments/`, `/api/v1/employee-tax-relief-claims/`, and `/api/v1/payslips/`. Payroll-scoped employee tax residency is managed through `/api/v1/employee-payroll-profiles/`. Available country presets and the compliance-aware Custom option are returned by `/api/v1/payroll-configurations/choices/`; calculated dates for a period are available from `/api/v1/payroll-periods/{id}/compliance-deadlines/`.

Run creation requires an idempotency key. Runs follow `DRAFT -> CALCULATING -> CALCULATED -> UNDER_REVIEW -> APPROVED -> FINALIZED`, with cancellation permitted before approval. Calculation snapshots base compensation, resolved components, approved adjustments, approved overtime, unpaid approved leave, and supported generic statutory rules. Approval requires a clean derived reconciliation; finalization closes the period, makes records/items immutable, and creates one checksummed payslip payload per employee. Base salary is currently interpreted as the amount for one configured payroll period; mid-period salary changes require an explicit future proration rule.

Payroll workflow handoffs create service-layer audit events and in-app notifications for the relevant approvers, finalizers, and employees. Critical transition audits include before/after status and capture direct request IP/user-agent when available. Matching transition retries do not duplicate audit or notification side effects.

The generic calculator supports flat and progressive tax plus contribution rules. Complex reusable reads are centralized in `apps/payroll/selectors.py`, where institution ownership, country/effective-date scope, finalized YTD history, and reconciliation prefetches are explicit. Ghana-specific data and special/YTD statutory evaluators are deliberately separate so country logic is not hardcoded into the engine. A `CUSTOM` payroll configuration therefore applies compensation and approved operational inputs but does not invent statutory deductions, and its setup choice includes a compliance warning.

### Ghana payroll preset

Migration `payroll.0003_seed_ghana_payroll_2026` installs the system-managed `GH-PAYROLL` / `GH-2026.1` preset for monthly GHS payroll. It includes resident graduated PAYE, non-resident tax, employee and employer pension contributions with Tier 1/Tier 2 allocations, bonus and casual-worker rules, the legally gated overtime rule, personal-relief definitions, statutory thresholds, the 2026 national daily minimum wage, and PAYE/pension compliance deadlines.

Ghana calculations require an explicit `RESIDENT` or `NON_RESIDENT` employee payroll profile. Statutory values are read from the selected versioned preset, the exact preset and rule data are snapshotted on each run, approved annual reliefs track year-to-date application, and finalized runs generate dated compliance reminders. The public GRA overtime guidance still states a GHS 18,000 annual qualification threshold that appears stale beside current PAYE bands; the seeded rule is therefore marked `requires_validation` and payroll containing overtime fails closed until a reviewed successor preset enables it.

The preset records its verification date and authority links in `source_metadata`, including GRA PAYE and personal-relief guidance, SSNIT's 2026 insurable-earnings notice, NPRA pension guidance, and the 2026 National Daily Minimum Wage notice.

Frontend integration contracts are maintained in [`docs/integration/payroll_frontend_contract.md`](docs/integration/payroll_frontend_contract.md) and [`docs/integration/ghana_payroll_frontend_contract.md`](docs/integration/ghana_payroll_frontend_contract.md).

Current delivery status and the mandatory 15-point handoff are recorded in [`docs/completion/payroll_module_completion_report.md`](docs/completion/payroll_module_completion_report.md) and [`docs/completion/ghana_payroll_module_completion_report.md`](docs/completion/ghana_payroll_module_completion_report.md).

## Accounting Core

Accounting endpoints cover configuration and setup choices, chart of accounts, fiscal years and periods, manual journal lifecycle, read-only journal lines, and four posted-ledger reports. Journals follow `DRAFT -> PENDING_APPROVAL -> APPROVED -> POSTED`, with explicit void and reversal paths. Posting and period/fiscal closure share transactional locks; posted/reversed journals and lines are immutable.

The generic preset framework exposes versioned preset families, chart/account templates, and an explicit apply action. Application accepts only active/effective same-country versions, creates or compatibly reuses the complete chart atomically, binds the exact version, and fails closed on conflicts or unsupported version migration. System-managed catalog records are read-only to tenant APIs.

Ghana Accounting Localization now provides the versioned `GH-LOCALIZATION-2026.1` catalog, GHS Ghana Commercial/SME starter presets, guarded Public/Nonprofit drafts, tax codes, separate 15% VAT/2.5% NHIL/2.5% GETFund components, and withholding/VAT-withholding rule discovery. Tax profiles, VAT certificates, compliance-calendar operations, expenses, and payroll-to-accounting mapping remain later ERD stages.

Accounts Payable and Receivable provide tenant-scoped vendors/customers and nested bills/invoices. Draft documents derive their configured tax totals, and controlled posting creates balanced AP/AR journals. Cash/bank settlement supports one posted Payment per vendor bill and one posted Receipt per invoice; it derives `PART_PAID`/`PAID` and uses journal reversals for voids. Multi-document allocations, bank reconciliation, attachments, tax profiles, certificates, credit notes, and external E-VAT workflows remain pending.

Cash / Bank provides tenant-scoped masked bank accounts tied to active asset ledger accounts plus immutable Payment and Receipt records. Non-cash transactions require an active bank account; cash transactions use the preset's `CASH` mapping. Transaction dates must fall in an open accounting period, and all cash movements create balanced `CASH` journals.

The frontend contracts are [`docs/integration/accounting_frontend_contract.md`](docs/integration/accounting_frontend_contract.md), [`docs/integration/accounting_presets_frontend_contract.md`](docs/integration/accounting_presets_frontend_contract.md), [`docs/integration/ghana_accounting_localization_frontend_contract.md`](docs/integration/ghana_accounting_localization_frontend_contract.md), [`docs/integration/accounts_payable_frontend_contract.md`](docs/integration/accounts_payable_frontend_contract.md), [`docs/integration/accounts_receivable_frontend_contract.md`](docs/integration/accounts_receivable_frontend_contract.md), and [`docs/integration/cash_bank_frontend_contract.md`](docs/integration/cash_bank_frontend_contract.md). Delivery records include [`docs/completion/accounts_payable_completion_report.md`](docs/completion/accounts_payable_completion_report.md), [`docs/completion/accounts_receivable_completion_report.md`](docs/completion/accounts_receivable_completion_report.md), and [`docs/completion/cash_bank_settlement_completion_report.md`](docs/completion/cash_bank_settlement_completion_report.md).

## CORS

`CORS_ALLOWED_ORIGINS` is a comma-separated allowlist. Development defaults only to `http://localhost:3000`; production refuses to start unless the variable is explicitly configured. Cross-origin credentials remain disabled unless `CORS_ALLOW_CREDENTIALS=true` is set.

## Scope boundary

Current ERD differences, statutory uncertainties, safeguards, and accepted development limitations are maintained in [`DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`](DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md).

The backend and companion frontend now cover expenses, bank reconciliation, customer/vendor tax profiles, VAT certificates, accounting compliance operations, payroll-to-accounting mapping, Recruitment, dashboards, onboarding, and employee self-service. The current frontend is online-only; PWA delivery is explicitly deferred under `PWA-001`. Current implementation limits are maintained in `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`; notable boundaries include multi-document settlement allocation, advanced import/export handlers, salary bands and review cycles, holiday-calendar configuration, automated statutory filing/integrations, and offline operational data synchronization. The Ghana minimum wage is versioned for compliance use but cannot yet be enforced against daily/casual compensation because the current ERD has no compensation pay-basis or paid-days field.
