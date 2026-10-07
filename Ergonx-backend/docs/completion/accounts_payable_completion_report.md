# Accounts Payable Completion Report

Report version: 1.0  
Assessment date: 2026-09-12  
Delivery status: **PARTIALLY COMPLETE**

## 1. Models added or changed

Added ERD §19 `Vendor`, `VendorBill`, and `VendorBillLine`, including tenant/period/account relation validation, unique vendor/bill identities, money/date checks, and draft-only line edits.

## 2. Migrations added

`accounting.0005_vendor_vendorbill_vendorbillline_and_more` adds AP schema and database constraints. `institutions.0009_seed_accounts_payable_access` adds AP access controls.

## 3. Services added

Vendor create/update plus bill create/update/submit/approve/post/void services. Totals are derived atomically. Posting creates, approves, and posts a balanced `AP` journal in the same transaction.

## 4. Selectors added

No standalone selector is needed yet; tenant-scoped view querysets provide the current operational reads.

## 5. Permissions added

Added `vendor.*` and `vendor_bill.*` permissions. Accountant prepares/submits; Finance Manager has approval/posting plus the underlying journal permissions.

## 6. API endpoints added

Vendor list/detail create/update and Vendor Bill list/detail create/update plus submit, approve, post, and void actions add 12 Accounting operations, taking the API total from 51 to 63.

## 7. Filters, search, and ordering supported

Vendor catalog filters include active/tax-profile fields with code/name/contact search. Bills filter by vendor/status/currency/period/date, search bill/vendor identifiers, and order by number/date/due date/amount.

## 8. OpenAPI updated

`openapi-schema.yml` was regenerated and validated; AP actions declare the state, period, immutability, and mapping error codes.

## 9. Audit events added

Vendor create/update and every bill transition emit immutable AuditLog records; posting records the linked journal identity.

## 10. Notifications added

Submission notifies bill approvers; approval notifies bill posters.

## 11. Tests added

`tests/test_accounts_payable.py` covers derived 20% separated Ghana tax, WHT, tenant/preset rejection, nested API flow, role separation, and balanced AP journals. The shared 63-operation Accounting access matrix was expanded.

## 12. PostgreSQL result

SQLite focused tests are green. PostgreSQL 16 migration replay applied `accounting.0005` and `institutions.0009`; focused AP workflow validation passed:

```text
3 passed in 19.99s
```

The full application regression suite remains a final-release gate; this AP delivery remains partial because its settlement and dependent workflow stages are intentionally absent.

## 13. Frontend integration note path

`docs/integration/accounts_payable_frontend_contract.md`

## 14. Seed and demo-data support

No new demo command is added yet; AP has no payment/settlement stage and the existing accounting demo remains unchanged.

## 15. Remaining issues

Payments, payment allocation, `PART_PAID`/`PAID`, posted-bill reversal, attachments, vendor tax profiles, VAT certificates, and compliance workflows are not implemented. See `ERD-010`, `AP-001`, `AP-002`, and `AP-003`.

## Completion decision

**PARTIALLY COMPLETE.** The ERD AP master/bill/line and controlled bill-to-journal workflow are implemented; settlement and dependent workflow capabilities remain intentionally absent.
