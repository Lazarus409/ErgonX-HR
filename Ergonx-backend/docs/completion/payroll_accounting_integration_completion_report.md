# Payroll-to-Accounting Integration Completion Report

## Delivered

- ERD §18.1 `PayComponentAccountMapping` and §26.1 `PayrollAccountMappingTemplate` models, migrations, RBAC, serializers, and tenant-safe APIs.
- Effective-dated institution component account mappings with preset-template application.
- Governed Ghana starter templates for base salary, PAYE, and mandatory pension effects.
- A protected `PayrollRun.accounting_journal_entry` extension that records the single generated journal.
- Finalized-run journal generation with fail-closed complete mapping checks, per-account aggregation/netting, audit history, and retry idempotency.
- Existing Accounting journal submit, approval, posting, period-close, reversal, audit, and ledger safeguards remain the authoritative posting workflow.

## Validation

`tests/test_payroll.py::test_finalized_payroll_generates_one_mapped_draft_journal_and_posts_it` covers mapping resolution, a balanced draft, idempotent generation, the run-to-journal link, and the subsequent submit/approve/post lifecycle.

## Boundaries

This intentionally does not infer mappings for arbitrary pay-item codes, create bank/payment exports, settle payroll liabilities, or submit statutory returns. These constraints are recorded in `PAY-ACC-001`.
