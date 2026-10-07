# Accounting Core Frontend Integration Contract

Contract version: 1.0  
API version: v1  
Module: Accounting Core

## Module

Accounting Core provides institution accounting setup, chart of accounts, fiscal periods, manual double-entry journals, an immutable posted ledger, reversals, and core financial statements. AP, AR, cash-management workflows, expenses, country presets, and Ghana localization are separate later modules under the consolidated ERD build order.

## Base URL

`/api/v1/`

All responses use the shared envelope:

```json
{"success": true, "data": {}, "message": "", "errors": null}
```

Errors additionally contain a stable top-level `code`.

## Required module flag

`ACCOUNTING`

The user must also have an active membership in the selected institution. A permission does not bypass a disabled module.

## Permissions

- `accounting.configure` — accounting configuration, fiscal years, and periods
- `account.view`, `account.create`, `account.update` — chart of accounts
- `journal.view`, `journal.create`, `journal.approve`, `journal.post`, `journal.reverse` — journal workflow
- `financial_report.view` — ledger and statements
- `accounting_period.close`, `accounting_period.reopen` — period/fiscal controls

Standard roles: Institution Admin and Finance Manager have all Accounting permissions; Accountant can maintain accounts and draft/submit journals and view reports; Auditor is read-only; HR Admin and Employee receive no Accounting permissions by default.

## Endpoints

All list endpoints use page-number pagination (`page`, `page_size`; default 25, maximum 100).

| Method | Path | Purpose | Permission | Query/payload | Response data |
|---|---|---|---|---|---|
| GET | `/accounting-presets/` | List global preset headers | `account.view` | `country_code`, `institution_type`, `is_system_managed`, `search` | paginated presets |
| GET | `/accounting-preset-versions/` | List global preset versions | `account.view` | `accounting_preset`, `status`, `effective_from`, `search` | paginated versions |
| POST | `/accounting-preset-versions/{id}/apply/` | Instantiate a selected chart and bind configuration | `accounting.configure` | application payload below | configuration, chart, counts, accounts |
| GET | `/chart-of-accounts-templates/` | List charts for preset versions | `account.view` | `preset_version`, `search` | paginated chart templates |
| GET | `/account-templates/` | Inspect template accounts and hierarchy | `account.view` | chart/type/balance/parent/postability/mapping filters, search/order | paginated account templates |
| GET/POST | `/accounting-configurations/` | Read/create institution setup | view/configure | configuration payload below | paginated/single configuration |
| GET/PATCH | `/accounting-configurations/{id}/` | Read/update setup | view/configure | partial configuration | configuration |
| GET | `/accounting-configurations/choices/` | Setup-mode and active country-preset choices | `account.view` | none | institution defaults and choices |
| GET/POST | `/accounts/` | List/create accounts | view/create | filters below / account payload | paginated accounts/account |
| GET/PATCH | `/accounts/{id}/` | Read/update account | view/update | partial account | account |
| GET/POST | `/fiscal-years/` | List/create fiscal years | view/configure | `status`, dates, `search` / year payload | paginated years/year |
| POST | `/fiscal-years/{id}/close/` | Close after all periods are closed/locked | `accounting_period.close` | no body | fiscal year |
| GET/POST | `/accounting-periods/` | List/create periods | view/configure | `fiscal_year`, `status`, dates, `search` / period payload | paginated periods/period |
| POST | `/accounting-periods/{id}/close/` | Close after resolving unposted journals | `accounting_period.close` | no body | period |
| POST | `/accounting-periods/{id}/lock/` | Lock after resolving unposted journals | `accounting_period.close` | no body | period |
| POST | `/accounting-periods/{id}/reopen/` | Reopen unless fiscal year is closed | `accounting_period.reopen` | no body | period |
| GET/POST | `/journal-entries/` | List/create manual journals | view/create | filters below / nested journal payload | paginated journals/journal |
| GET/PATCH | `/journal-entries/{id}/` | Read/update a draft journal | view/create | partial nested payload | journal |
| POST | `/journal-entries/{id}/submit/` | Validate balance and submit | `journal.create` | no body | journal |
| POST | `/journal-entries/{id}/approve/` | Approve submitted journal | `journal.approve` | no body | journal |
| POST | `/journal-entries/{id}/post/` | Post approved journal | `journal.post` | no body | immutable journal |
| POST | `/journal-entries/{id}/void/` | Void an unposted journal | `journal.create` | no body | journal |
| POST | `/journal-entries/{id}/reverse/` | Create a draft reversing journal | `journal.reverse` | reversal payload below | reversal journal |
| GET | `/journal-lines/` | List tenant-scoped lines | `journal.view` | journal/account/dimension filters, ordering | paginated lines |
| GET | `/accounting-reports/general-ledger/` | Account ledger with brought-forward opening | `financial_report.view` | required `account`; optional `date_from`, `date_to` | ledger object |
| GET | `/accounting-reports/trial-balance/` | Posted debit/credit totals | `financial_report.view` | optional `date_from`, `date_to` | rows and totals |
| GET | `/accounting-reports/income-statement/` | Posted income and expense activity | `financial_report.view` | optional `date_from`, `date_to` | income, expenses, net income |
| GET | `/accounting-reports/balance-sheet/` | Posted balances at a date | `financial_report.view` | optional `as_of` | assets, liabilities, equity |

Chart filters: `account_type`, `normal_balance`, `parent`, `is_postable`, `is_active`; search by code/name; order by code, name, type, or creation date. Journal filters: `accounting_period`, `entry_date`, `source`, `status`, `reversal_of`; search by journal number, description, or reference; order by journal number, entry/posting dates, or creation date.

## Status enums

Accounting setup mode: `PRESET`, `CUSTOM`.

Preset version: `DRAFT`, `ACTIVE`, `RETIRED`.

Fiscal year: `OPEN`, `CLOSED`.

Accounting period: `OPEN`, `CLOSED`, `LOCKED`.

Journal source: `MANUAL`, `PAYROLL`, `AP`, `AR`, `EXPENSE`, `CASH`, `SYSTEM`.

Journal status:

- `DRAFT` — mutable; submit or void
- `PENDING_APPROVAL` — immutable through ordinary PATCH; approve or void
- `APPROVED` — awaiting posting; post or void
- `POSTED` — immutable; create reversal
- `REVERSED` — immutable terminal state after its reversal posts
- `VOID` — terminal, excluded from ledger reports

Account type: `ASSET`, `LIABILITY`, `EQUITY`, `INCOME`, `EXPENSE`.

Normal balance: `DEBIT`, `CREDIT`.

## Workflow transitions

```text
DRAFT -> PENDING_APPROVAL -> APPROVED -> POSTED -> REVERSED
  |              |             |
  +--------------+-------------+-> VOID

OPEN period -> CLOSED -> OPEN
OPEN period -> LOCKED -> OPEN
OPEN fiscal year -> CLOSED (only when every period is CLOSED/LOCKED)
```

Creating a reversal does not immediately change the source journal. The reversal follows the ordinary submit/approve/post flow; posting it changes the source from `POSTED` to `REVERSED`. Matching submit, approve, post, void, close, and reversal-creation retries are idempotent.

## Frontend behavior notes

- Never PATCH status fields. Render explicit action buttons from status plus permissions.
- Treat `journal_number`, actor fields, posting fields, source, status, and reversal link as server-managed.
- Send all journal lines with create or draft PATCH; each line must have exactly one positive debit/credit value.
- Show live debit and credit totals, but rely on submit/post validation as authoritative.
- Confirm post, void, period close/lock, fiscal close, and reversal actions.
- Posted/reversed journals and their lines are immutable; corrections use a reversal/correcting journal.
- A period cannot close or lock while it has unresolved journals. A period cannot reopen after fiscal-year closure.
- A date-range report rejects malformed dates and `date_from > date_to`.
- Report values are serialized as decimal strings. General-ledger running balances use debit-minus-credit sign and include `opening_balance` before `date_from`.
- Empty reports return empty row arrays and zero decimal totals; they are successful responses, not 404s.

## Example payloads

Configuration:

```json
{
  "country_code": "GH",
  "base_currency": "GHS",
  "accounting_setup_mode": "CUSTOM",
  "selected_accounting_preset_version": null,
  "reporting_framework": "IFRS",
  "fiscal_year_start_month": 1,
  "is_configured": true
}
```

Preset application:

```json
{
  "coa_template": "chart-template-uuid",
  "base_currency": "GHS",
  "fiscal_year_start_month": 1
}
```

Manual journal:

```json
{
  "accounting_period": "period-uuid",
  "entry_date": "2026-09-10",
  "description": "Cash sale",
  "reference": "SALE-001",
  "lines": [
    {"account": "cash-account-uuid", "debit": "100.00", "credit": "0.00"},
    {"account": "income-account-uuid", "debit": "0.00", "credit": "100.00"}
  ]
}
```

Reversal:

```json
{
  "accounting_period": "open-period-uuid",
  "entry_date": "2026-09-20",
  "description": "Reverse SALE-001"
}
```

General-ledger response data:

```json
{
  "account_id": "account-uuid",
  "account_code": "1000",
  "account_name": "Cash",
  "opening_balance": "25.00",
  "entries": [
    {
      "journal_entry_id": "journal-uuid",
      "journal_number": "JE-2026-000002",
      "entry_date": "2026-09-10",
      "description": "Cash sale",
      "debit": "100.00",
      "credit": "0.00",
      "running_balance": "125.00"
    }
  ],
  "closing_balance": "125.00"
}
```

## Major error codes

- `authentication_required`, `authentication_failed`
- `tenant_mismatch`, `module_disabled`, `permission_denied`, `not_found`
- `validation_error`, `invalid_state_transition`
- `record_immutable`, `period_closed`, `unbalanced_journal`, `duplicate_operation`

## Known limitations

- No accounting preset templates are seeded in this slice; preset mode becomes operational in the next ERD stage.
- The development demo includes a clearly marked non-production preset; production Ghana templates remain part of the next localization stage.
- AP, AR, cash/bank workflow, expenses, Ghana taxes, and payroll-to-GL mapping are later ERD stages.
- Fiscal-year close actor/time and journal void/reversal actor/time are retained in the shared audit log because ERD v1.1 provides no dedicated fields.
- Accounting-period/fiscal-year overlap rejection is enforced by model validation plus parent-row service locks; unsupported direct SQL/bulk writes can bypass model validation.
- Journal lines are tenant-scoped transitively through `JournalEntry` because ERD v1.1 omits a direct institution field.

Canonical runtime schema: `/api/v1/schema/`; Swagger UI: `/api/v1/docs/`; repository artifact: `openapi-schema.yml`.
