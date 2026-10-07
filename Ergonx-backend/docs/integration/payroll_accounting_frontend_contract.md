# Payroll-to-Accounting Frontend Contract

## Scope

This integration creates one idempotent draft `PAYROLL` journal from a finalized payroll run. It does not post a journal automatically: the normal Accounting submit, approval, and posting controls remain mandatory.

## Access and routes

The caller needs an authenticated active tenant, both `PAYROLL` and `ACCOUNTING` modules enabled, and `journal.create` permission.

| Operation | Route | Method | Result |
|---|---|---|---|
| List standard templates | `/api/v1/payroll-account-mapping-templates/` | `GET` | Read-only preset mappings by payroll component code |
| List/create institution mappings | `/api/v1/pay-component-account-mappings/` | `GET`, `POST` | Effective dated component debit/credit accounts |
| Apply preset mappings | `/api/v1/pay-component-account-mappings/apply-templates/` | `POST` | Creates matching institution mappings for active components |
| Generate journal | `/api/v1/payroll-runs/{id}/generate-accounting-journal/` | `POST` | The linked draft `JournalEntry` |

The generated journal is then handled through `/api/v1/journals/{id}/submit/`, `/approve/`, and `/post/` using the existing Accounting permissions.

## Generation rules

- Only a `FINALIZED` payroll run qualifies.
- Each payroll item must resolve to both a debit and credit account. An effective tenant `PayComponentAccountMapping` takes precedence; otherwise the selected accounting preset's standard template for the item snapshot code is used.
- Any missing/incomplete mapping fails the entire request with `policy_not_applicable`; no partial journal is created.
- Effects are aggregated by account and netted into one-sided journal lines. The journal is balanced before it can be submitted.
- A successful retry returns the same linked journal. The run exposes `accounting_journal_entry` after generation.
- The payroll run and its generated journal stay linked; direct payroll changes remain prohibited after finalization.

## Limits

Standard Ghana templates cover base pay, PAYE, and mandatory pension effects. New pay components and localized special-income effects require an institution mapping or a future governed preset version. Payroll payment/export, liability settlement, and remittance confirmation are out of scope.
