# Accounts Payable Frontend Integration Contract

Contract version: 1.0  
API version: v1  
Module: Accounts Payable

## Module

Accounts Payable provides tenant-scoped Vendors and Vendor Bills with service-derived amounts, workflow controls, and balanced AP-journal posting. It does not yet settle payments or manage vendor tax-profile/certificate data.

## Base URL and response envelope

`/api/v1/`

Successful responses use `{success, data, message, errors}`. Errors also include a stable top-level `code`.

## Required module and permissions

All routes require the enabled `ACCOUNTING` module and active tenant context.

- `vendor.view`, `vendor.create`, `vendor.update`
- `vendor_bill.view`, `vendor_bill.create`, `vendor_bill.approve`, `vendor_bill.post`, `vendor_bill.void`

AP posting also traverses the governed journal workflow, so the posting actor must hold the required journal create/approve/post permissions. The seeded Finance Manager has both AP and journal permissions; Accountant can create and submit but cannot approve or post.

## Endpoints

| Method | Path | Purpose | Inputs / filters |
|---|---|---|---|
| GET / POST | `/vendors/` | List or create vendors | filters: active, country, residency, taxpayer type, VAT registration, WHT category; search and ordering |
| GET / PATCH | `/vendors/{id}/` | Read or update a vendor | no delete; set `is_active=false` to deactivate |
| GET / POST | `/vendor-bills/` | List or create a draft bill | filters: vendor, status, currency, accounting period, bill date; nested `lines` on create |
| GET / PATCH | `/vendor-bills/{id}/` | Read or edit a draft bill | nested line replacement supported only while Draft |
| POST | `/vendor-bills/{id}/submit/` | Submit draft for approval | no body |
| POST | `/vendor-bills/{id}/approve/` | Approve pending bill | no body |
| POST | `/vendor-bills/{id}/post/` | Generate and post linked AP journal | no body |
| POST | `/vendor-bills/{id}/void/` | Void a non-posted bill | no body |

List endpoints use shared `page` and `page_size` pagination.

## Bill payload and calculated fields

```json
{
  "vendor": "vendor-uuid",
  "bill_number": "SUPPLIER-001",
  "bill_date": "2026-01-15",
  "due_date": "2026-01-30",
  "currency": "GHS",
  "accounting_period": "period-uuid",
  "lines": [{
    "description": "Consulting services",
    "expense_account": "expense-account-uuid",
    "quantity": "2",
    "unit_price": "100.00",
    "tax_code": "tax-code-uuid",
    "withholding_rule": "withholding-rule-uuid"
  }]
}
```

`subtotal`, `tax_total`, `withholding_total`, `total_amount`, `amount_payable`, `line_total`, `status`, and `journal_entry` are server-derived/read-only. Amounts round to two decimal places using round-half-up. A tax code/rule must be effective on the bill date and come from the institution's selected accounting preset.

## Workflow

```text
DRAFT --submit--> PENDING --approve--> APPROVED --post--> POSTED
  \--void-------------------------------------------------> VOID
```

Only Draft bills/lines are editable. Submission needs at least one line and an open period. Posting creates debit expense/input-tax and credit trade-payable/withholding lines, then uses the controlled journal submit/approve/post path in the same transaction. Failed mapping or journal validation rolls back the complete post.

## Known limitations

- No Payment entity/API yet; `PART_PAID` and `PAID` are reserved ERD statuses, not reachable in this delivery.
- A posted bill cannot be voided; it needs the later cash/payment and reversal workflow.
- `AP-001` calculation semantics, `AP-002` lifecycle audit-only history, `AP-003` template-code mapping dependency, and `ERD-010` transitive bill-line tenancy are maintained in the limitations register.
- Attachments and vendor tax profiles are deferred to their shared/dependent stages.

Canonical schema: `/api/v1/schema/`; Swagger: `/api/v1/docs/`; repository schema: `openapi-schema.yml`.
