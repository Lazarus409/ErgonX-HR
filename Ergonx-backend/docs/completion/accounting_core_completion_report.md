# Accounting Core Completion Report

Report version: 1.0  
Assessment date: 2026-09-12  
Delivery status: **COMPLETE WITH DOCUMENTED LIMITATIONS**

This report covers the ERD v1.1 Accounting Core kernel only: accounting configuration, chart of accounts, fiscal periods, manual journals, general ledger, trial balance, income statement, balance sheet, period controls, auditability, and demo support. The consolidated ERD explicitly schedules accounting presets, Ghana accounting localization, and AP/AR/cash/expenses after this kernel.

## 1. Models added or changed

- `AccountingPreset`, `AccountingPresetVersion` — minimum global references required by accounting configuration; template entities are deferred to the next stage.
- `InstitutionAccountingConfiguration`
- `Account`
- `FiscalYear`, `AccountingPeriod`
- `JournalEntry`, `JournalLine`

The schema matches ERD v1.1 fields/enums. It adds date-validity checks and unique reversal protection. Posted/reversed journals and their lines reject ordinary update/delete operations.

## 2. Migrations added

- `apps/accounting/migrations/0001_initial.py` — Accounting Core schema and constraints.
- `apps/institutions/migrations/0008_seed_accounting_access.py` — ACCOUNTING module row, permission catalog, and standard-role assignments for existing tenants.

Institution bootstrap now creates the disabled ACCOUNTING module and assigns the same permissions to new tenants. Migration drift check is clean.

## 3. Services added

`apps/accounting/services.py` owns:

- accounting configuration;
- account create/update;
- fiscal-year and accounting-period creation;
- balanced journal creation/update, submit, approve, post, void, and reversal creation;
- period close/lock/reopen and fiscal-year close;
- audit and permission-holder notification side effects.

Financial transitions use atomic transactions, state re-checks, shared fiscal/period locks, and an institution lock for monotonically allocated annual journal numbers. Matching transition retries do not duplicate financial effects, audits, or notifications.

## 4. Selectors added

`apps/accounting/selectors.py` provides tenant-explicit reads for:

- posted journal lines;
- account general ledger with brought-forward opening and running balance;
- database-aggregated trial balance;
- income statement;
- balance sheet.

Only `POSTED` journals and the original lines of `REVERSED` journals feed reports; draft, pending, approved, and void journals are excluded. Tenant-owned account input is validated before query execution.

## 5. Permissions added

- `accounting.configure`
- `account.view`, `account.create`, `account.update`
- `journal.view`, `journal.create`, `journal.approve`, `journal.post`, `journal.reverse`
- `financial_report.view`
- `accounting_period.close`, `accounting_period.reopen`

Institution Admin and Finance Manager receive all; Accountant receives account/journal preparation and reports; Auditor is read-only; HR Admin and Employee receive none by default.

## 6. API endpoints added

The original Accounting Core completion exposed 38 GET/POST/PATCH operations. The current Accounting API contains 43 after the subsequent generic preset-framework stage added chart/account template reads and explicit preset application. Core operations remain unchanged across:

- `accounting-presets`, `accounting-preset-versions`;
- `accounting-configurations` and `choices`;
- `accounts`;
- `fiscal-years` and `close`;
- `accounting-periods` and `close`/`lock`/`reopen`;
- `journal-entries` and `submit`/`approve`/`post`/`void`/`reverse`;
- read-only `journal-lines`;
- `accounting-reports` for general ledger, trial balance, income statement, and balance sheet.

Status is server-managed and changed only through action endpoints.

## 7. Filters, search, and ordering supported

- Presets/versions: country, institution type, system-management, preset, status, effective date; catalog search.
- Accounts: type, normal balance, parent, postability, active state; code/name search and ordering.
- Fiscal years/periods: status and dates; name search.
- Journals: period, date, source, status, reversal; number/description/reference search and lifecycle ordering.
- Lines: journal, account, department, location, employee; amount/date ordering.
- Reports: validated date ranges; general ledger additionally requires a tenant-owned account; balance sheet accepts `as_of`.

List endpoints use shared page-number pagination.

## 8. OpenAPI updated

`openapi-schema.yml` contains all 43 current Accounting operations with summaries, descriptions, ACCOUNTING module/permission expectations, request and response schemas, enums, query parameters, pagination, enveloped success/errors, and stable `x-error-codes`.

No-body workflow actions advertise no request body; reversal uses `JournalReversal`; report query parameters and response schemas are explicit. GET validation/not-found outcomes are also represented as 400/404 where declared. Schema generation validates successfully.

## 9. Audit events added

- `accounting.configuration.changed`
- `accounting.account.created`, `accounting.account.updated`
- `accounting.fiscal_year.created`, `accounting.fiscal_year.closed`
- `accounting.period.created`, `accounting.period.open`, `accounting.period.closed`, `accounting.period.locked`
- `accounting.journal.created`, `accounting.journal.updated`, `accounting.journal.submitted`, `accounting.journal.approved`, `accounting.journal.posted`, `accounting.journal.voided`, `accounting.journal.reversal_created`, `accounting.journal.reversed`

Critical transitions record before/after status. API-originated service writes inherit request IP/user-agent from the shared audit context middleware.

## 10. Notifications added

- Journal submission notifies users holding `journal.approve`.
- Journal approval notifies users holding `journal.post`.

Notifications originate in the service layer. Idempotent transition retries do not duplicate them.

## 11. Tests added

- `tests/test_accounting.py` — bootstrap/role separation, configuration/chart/period behavior, overlap validation, journal lifecycle, balance enforcement, posting/period controls, reports, brought-forward ledger balance, reversals, void/fiscal closure, immutability, tenant relations, report validation, OpenAPI shape, and PostgreSQL constraints.
- `tests/test_accounting_api_contract.py` — every Accounting operation across authentication, module enablement, operation permission, and cross-tenant object/list isolation.
- `tests/test_accounting_demo_seed.py` — non-debug refusal, deterministic reruns, stable audit/notification counts, credentials, posted journals, and report-ready balances.

Direct database tests cover exactly-one-positive journal lines and unique reversal-per-source constraints on PostgreSQL 16.

## 12. PostgreSQL result

PostgreSQL 16 validation on 2026-09-12:

```text
95 passed in 237.43s
```

The focused Accounting slice passed all 15 tests in 76.46s, including database rejection of invalid zero-sided journal lines and duplicate reversals. The first PostgreSQL run exposed a nullable-join `FOR UPDATE` portability defect that SQLite masked; the journal lock was narrowed to the base row and both the focused and full suites then passed. Final SQLite validation was:

```text
91 passed, 4 PostgreSQL-only tests skipped in 70.05s
```

## 13. Frontend integration note path

`docs/integration/accounting_frontend_contract.md`

It documents module/permissions, all endpoint families/actions, filters, payloads, response shapes, enums, transitions, frontend behavior, stable errors, and limitations.

## 14. Seed and demo-data support

Development-only `python manage.py seed_accounting_demo` creates a reserved Ghana institution, usable admin login, custom IFRS/GHS configuration, FY2026 and September period, three accounts, and two posted illustrative journals. It refuses `DEBUG=False`, refuses to overwrite drifted accounts, and reruns without duplicating entities, audits, notifications, or financial effects.

## 15. Remaining issues

- `ROADMAP-002` — governing documents use different boundaries for Core Accounting; implementation follows the ERD build order.
- `ERD-003` — JournalLine tenant ownership is transitive because ERD v1.1 has no institution field.
- `ERD-004` — dedicated close/void/reversal actor/timestamp fields are absent; the audit log is authoritative.
- `ACC-001` — overlap safety relies on model validation and service locking rather than a database exclusion constraint.
- Accounting preset templates, Ghana localization, AP/AR/cash/expenses, and payroll-accounting integration are subsequent ERD stages, not implied capabilities of this slice.

The maintained authoritative issue list is `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`.

## Completion decision

**COMPLETE WITH DOCUMENTED LIMITATIONS.** The ERD-ordered Accounting Core ledger kernel satisfies the functional, API, OpenAPI, audit/notification, deterministic-demo, tenant/security, SQLite, and PostgreSQL 16 delivery gates. The explicit §15 limitations remain authoritative and the later accounting stages are not implied capabilities.
