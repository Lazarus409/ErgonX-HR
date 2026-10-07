# Accounts Receivable Frontend Integration Contract

API version: v1  
Module: Accounts Receivable

## Access

All endpoints require active tenant context and the enabled `ACCOUNTING` module.

- `customer.view`, `customer.create`, `customer.update`
- `invoice.view`, `invoice.create`, `invoice.issue`, `invoice.void`

Issuance also executes the controlled journal workflow, so the actor must have journal create/approve/post authority. Finance Manager has those permissions; Accountant can prepare drafts.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/customers/` | List or create customers |
| GET / PATCH | `/customers/{id}/` | Read/update customer; deactivate through `is_active=false` |
| GET / POST | `/invoices/` | List/create draft invoices with nested lines |
| GET / PATCH | `/invoices/{id}/` | Read/edit a Draft invoice |
| POST | `/invoices/{id}/issue/` | Issue invoice and post the controlled AR journal |
| POST | `/invoices/{id}/void/` | Void a Draft invoice |

Filters: customers support active/country/residency/taxpayer/VAT fields; invoices support customer, status, currency, period, and date. Lists support shared pagination, search, and ordering.

## Payload and workflow

Create an invoice with customer, number, dates, currency, accounting period, optional `external_tax_reference`, and one or more `{description, income_account, quantity, unit_price, tax_code}` lines. `line_total`, `subtotal`, `tax_total`, `total_amount`, `status`, and `journal_entry` are server-derived/read-only.

```text
DRAFT --issue--> ISSUED
  \--void-----> VOID
```

Issuing derives separately rounded tax components, debits Trade Receivables, credits income and each configured output-tax account, and posts the AR journal atomically. Tax codes must be active/effective and originate from the institution's selected preset.

## Limitations

`PART_PAID` and `PAID` require the later Receipt/cash stage. Issued invoices need a future credit-note/reversal workflow rather than voiding. Customer tax profiles, attachments, E-VAT integration, and a separate credit-approval workflow are not implemented. See `AR-001` and `AR-002` in the limitations register.
