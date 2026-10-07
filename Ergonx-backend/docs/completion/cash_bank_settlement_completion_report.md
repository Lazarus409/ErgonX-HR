# Cash / Bank and Settlement Completion Report

Status: `COMPLETE WITH DOCUMENTED LIMITATIONS`

## Implemented boundary

This delivery implements the ERD §21 `BankAccount`, `Payment`, and `Receipt` entities together with controlled AP/AR settlement. A bank account is tenant-bound and tied to an active, postable asset ledger account. Payment and Receipt are immutable after posting/voiding, create balanced `CASH` journals, and update their single linked VendorBill or Invoice to the appropriate reserved ERD settlement status.

The service derives the journal period from the transaction date and reverses, rather than deletes, a posted cash movement on void. Tenant, ledger-account type, bank activity, period, currency, source-journal, status, and over-settlement checks run in model/service validation.

## Explicit scope limits

The ERD does not specify allocation, status, period, cash-fallback, or reconciliation behavior. The implementation therefore deliberately supports one Payment-to-one VendorBill and one Receipt-to-one Invoice only. Multi-document allocation, unallocated transactions, bank matching/reconciliation, statement ingestion, bank feeds, and raw account-number storage are not implemented. The durable decisions are `CASH-001` and `CASH-002` in `DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`.

## Validation gate

Focused behavior passes for balanced payment/receipt journals, derived `PART_PAID`/`PAID` statuses, reversal-on-void, cross-tenant bank-account rejection, and over-settlement rejection. Django structural checks, migration-drift verification, and the generated OpenAPI operation-level contract also pass.
