# Expenses Frontend Integration Contract

The Expense API provides tenant-scoped cash-paid expenses: list/create/patch at `expenses/`, with `submit`, `approve`, `reject`, and `post` detail actions. Create/edit is Draft-only; posting creates a balanced EXPENSE journal and requires the controlled journal permissions in addition to `expense.post`.

Required create fields: `expense_date`, `account` (an institution expense account), `amount`, `currency`, and `description`. `attachment` is an optional same-tenant Document UUID. The supported lifecycle is `DRAFT → PENDING → APPROVED → POSTED` or `PENDING → REJECTED`; posted/rejected records are immutable.

The ERD has no settlement model. This MVP credits the configured `CASH` mapping on post. Reimbursements, AP/card/bank links, multi-attachments, allocation, and expense-specific correction flows are deferred under `EXP-001`.
