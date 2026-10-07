# Bank Reconciliation Frontend Contract

`BankStatementLine` is the MVP reconciliation extension for an imported bank movement. It is not a bank-feed connector, payment allocation engine, or statement-file parser.

| Operation | Route | Permission |
|---|---|---|
| List lines | `/api/v1/bank-statement-lines/` | `bank_reconciliation.view` |
| Import line | `/api/v1/bank-statement-lines/` | `bank_reconciliation.manage` |
| Match journal | `/api/v1/bank-statement-lines/{id}/match/` | `bank_reconciliation.manage` |
| Unmatch | `/api/v1/bank-statement-lines/{id}/unmatch/` | `bank_reconciliation.manage` |

Import requires a bank-supplied `external_id`; the same bank account plus identifier is idempotent only when the payload is identical. A match is allowed only when a single posted, same-tenant journal has a movement on the selected bank ledger account exactly equal to the signed statement amount. Matching and unmatching do not alter the journal or accounting period; both create audit history.

Statement amount signs follow the bank ledger: money in is positive and money out is negative. A journal can match only one statement line.
