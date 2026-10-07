# Accounts Receivable Completion Report

Assessment date: 2026-09-12  
Delivery status: **PARTIALLY COMPLETE**

## 1. Models added or changed

Added ERD §20 `Customer`, `Invoice`, and `InvoiceLine` with tenant/account/tax/preset validation, unique identifiers, dates, and monetary constraints.

## 2. Migrations added

`accounting.0006_customer_invoice_invoiceline_and_more` and `institutions.0010_seed_accounts_receivable_access`.

## 3. Services added

Customer create/update; invoice create/update/issue/void. Issuance derives totals and posts a balanced AR journal atomically.

## 4. Selectors added

Tenant view querysets are sufficient for current reads.

## 5. Permissions added

Added `customer.*` and `invoice.*` access controls.

## 6. API endpoints added

Customer list/detail create/update and Invoice list/detail create/update plus issue/void add 10 Accounting operations, taking the API total from 63 to 73.

## 7. Filters, search, and ordering supported

Customer tax-profile filters and Invoice customer/status/currency/period/date filters are supported, with identifier/contact search and date/amount ordering.

## 8. OpenAPI updated

The generated `openapi-schema.yml` validates with the expanded Accounting surface.

## 9. Audit events added

Customer changes and invoice draft/issue/void transitions create AuditLog events; issued events retain the journal identity.

## 10. Notifications added

None: the ERD defines no invoice approval state.

## 11. Tests added

AR journal coverage proves a GHS 200 taxed invoice becomes a GHS 240 balanced AR journal with separate output-tax credits. The shared access matrix includes all Customer/Invoice routes.

## 12. PostgreSQL result

PostgreSQL AR regression validation remains pending.

## 13. Frontend integration note path

`docs/integration/accounts_receivable_frontend_contract.md`

## 14. Seed and demo-data support

No AR demo seed is added before Receipt/settlement support.

## 15. Remaining issues

Receipts, settlement states, credit notes/reversals, attachments, tax profiles, and external E-VAT lifecycle remain pending. See `AR-001` and `AR-002`.

## Completion decision

**PARTIALLY COMPLETE.** The ERD customer/invoice/line foundation and issue-to-journal workflow are implemented, but settlement and dependent commercial workflows are not.
