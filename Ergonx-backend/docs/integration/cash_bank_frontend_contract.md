# Cash / Bank and Settlement Frontend Integration Contract

Module: Cash / Bank and AP/AR settlement  
Status: `COMPLETE WITH DOCUMENTED LIMITATIONS` — ERD §21 entity/API delivery; bank reconciliation remains deferred.

## Scope

The current MVP supports tenant-scoped bank accounts and a controlled, immediate posting flow:

- a Payment settles exactly one posted VendorBill;
- a Receipt settles exactly one issued Invoice;
- a transaction creates and posts a balanced `CASH` journal;
- the linked bill or invoice derives `PART_PAID` or `PAID` from non-voided totals;
- void creates and posts a journal reversal, then recomputes settlement.

There are no allocation, unallocated-cash, statement-import, matching, reconciliation, or bank-feed endpoints in this delivery. See `CASH-001` and `CASH-002` in the development limitations register.

## API resources

All routes live beneath `/api/v1/`, require an active institution context, an enabled Accounting module, and tenant RBAC.

| Resource | Methods | Permission | Notes |
|---|---|---|---|
| `bank-accounts/` | GET, POST | `bank_account.view`, `bank_account.create` | `ledger_account` must be an active, postable asset account in the institution. Store masked identifiers only. |
| `bank-accounts/{id}/` | GET, PATCH | `bank_account.view`, `bank_account.update` | Deactivation blocks future bank transactions. |
| `payments/` | GET, POST | `payment.view`, `payment.create` | POST immediately posts the payment journal; no draft/edit route. |
| `payments/{id}/` | GET | `payment.view` | Immutable posted/voided transaction. |
| `payments/{id}/void/` | POST | `payment.void` and journal reversal/post permissions | Body supplies `void_date`. |
| `receipts/` | GET, POST | `receipt.view`, `receipt.create` | POST immediately posts the receipt journal; no draft/edit route. |
| `receipts/{id}/` | GET | `receipt.view` | Immutable posted/voided transaction. |
| `receipts/{id}/void/` | POST | `receipt.void` and journal reversal/post permissions | Body supplies `void_date`. |

The posting service also requires the actor to hold `journal.create`, `journal.approve`, and `journal.post`; void additionally requires `journal.reverse`. This preserves the accounting kernel’s separation of duties.

## Create examples

```json
POST /api/v1/payments/
{
  "payment_number": "PAY-2026-0001",
  "payment_date": "2026-01-20",
  "amount": "250.00",
  "currency": "GHS",
  "payment_method": "BANK_TRANSFER",
  "bank_account": "bank-account-uuid",
  "vendor_bill": "vendor-bill-uuid"
}
```

```json
POST /api/v1/receipts/
{
  "receipt_number": "REC-2026-0001",
  "receipt_date": "2026-01-20",
  "amount": "250.00",
  "currency": "GHS",
  "payment_method": "BANK_TRANSFER",
  "bank_account": "bank-account-uuid",
  "invoice": "invoice-uuid"
}
```

Use `payment_method: "CASH"` and omit `bank_account` for the configured cash ledger mapping. Every non-cash method requires an active bank account. The transaction currency must match the linked bill/invoice and the bank account currency when a bank account is supplied.

## Client rules

- Do not optimistically set `PART_PAID`/`PAID`; refresh the linked bill or invoice after success.
- Surface validation errors without retrying a successful request: payment/receipt numbers are institution-unique and a duplicate may represent a real cash movement.
- A transaction date must fall in exactly one open accounting period. The backend derives that period; it is intentionally not supplied by the client.
- Reject an amount above the currently displayed outstanding balance, but still treat the backend over-settlement response as authoritative.
- A void date must fall in an open period. Display that the original cash journal is reversed rather than deleted.
- Do not expose raw bank account numbers; only `masked_account_number` is persisted by this model.

## Deferred flows

Credit notes, bill/invoice reversals, multi-document allocation, partial allocation of one deposit, write-offs, bank-statement import, reconciliation, bank feeds, attachments, and customer/vendor tax profile workflows remain separate MVP work.
