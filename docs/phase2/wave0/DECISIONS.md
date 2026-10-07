# Wave 0 — Product Decisions (2026-10-05)

The product owner approved every recommendation in `WAVE_0_RECONCILIATION_REPORT.md` §6 and §11 ("go with your recommendations", 2026-10-05). These answers are now binding on Phase 2 implementation.

| ID | Decision |
|---|---|
| BQ-01 | Landing is resolved in bootstrap from **effective permissions**:<br>• `dashboard.executive.view` → `/dashboard` (Executive)<br>• otherwise any operational module permission → `/insights`<br>• otherwise → `/me` (Employee Home)<br>`dashboard.executive.view` is **removed from the AUDITOR system-role default**, so auditors land on Insights. `/` stays the general Home page and remains reachable from navigation. |
| BQ-02 | Expense 2.0 **evolves `Expense` in place** into the claim header and adds line items, so API paths stay stable and history is kept. A reversed posted claim ends in the terminal status **REVERSED**, with a link to the reversing journal. |
| BQ-03 | Reimbursable claims post **Cr employee-payable** (new system mapping `EMPLOYEE_PAYABLE`) and are settled by an explicit `settle` action (Dr payable / Cr bank-or-cash). "Paid from petty cash" remains an option and credits the `CASH` mapping at posting. The AP `Payment` model is **not** reused. "Settled" means a settlement was recorded, never that money was sent. |
| BQ-04 | Separation of duties is an **institution setting, default ON for payroll and journals**: preparer ≠ approver, and journal creator ≠ approver. System-generated journals (expense, payroll, AP, AR) stay auto-approved but record the upstream approver. Expense: the claimant can never approve their own claim (always enforced). |
| BQ-05 | **REPORTS gates every reports surface**, including `/reports/{module}/` CSV endpoints. |
| BQ-06 | **Remove the publish-from-DRAFT shortcut.** A requisition must go PENDING_APPROVAL → APPROVED, approved by someone other than the submitter, before `publish`. |
| BQ-07 | Candidate data retention: **deferred to W8** (non-blocking). |
| BQ-08 | Credit notes: **deferred**. Hide "Issue credit" in S029. |
| BQ-09 | **Add durable account provenance** (`system_mapping_code` on `Account`, plus an institution override) before introducing `EMPLOYEE_PAYABLE`. Code-based matching is kept only as a migration backfill. |
| BQ-10 | Sign-in and email-OTP limits:<br>• code TTL 5 min; 5 attempts per code;<br>• resend cooldown 60 s; at most 5 codes per user per 15 min;<br>• 5 failed sign-ins per account per 15 min, then locked until the oldest of them is 15 min old;<br>• 20 attempts per client IP per minute (IP forwarded by the BFF with a shared secret);<br>• OTP destination masked (`d•••@g•••.com`). |
| BQ-11 | **Move data scope and read-only onto `Role`** in W2 (migration), defaulted from the current system roles so behaviour does not change. |
| G0-05 | The bounded approval-engine design in `approval_engine_gap_analysis.md` §3 is approved. |
| G0-10 / G0-12 | The test matrix and the new audit-event list are adopted as the Phase 2 baseline. |
| Next | Approved order: (1) security patch ahead of Wave 2 — SEC-01 throttling and OTP cooldown, SEC-02 server-side logout revocation, AUD-01 append-only audit log; (2) Wave 1 Design System in parallel. |

## Gate status after the decisions

| Gate | Status | Why |
|---|---|---|
| G0-01 | COMPLETE | unchanged |
| G0-02 | PARTIAL | OpenAPI repair and CI gate not yet done (non-behavioural, W2) |
| G0-03 | COMPLETE | BQ-01 and BQ-11 decided |
| G0-04 | COMPLETE | BQ-02, BQ-03 and BQ-04 decided; lifecycle targets fixed |
| G0-05 | COMPLETE | boundary approved |
| G0-06 | COMPLETE | parameters decided (BQ-10) and implemented (security patch below) |
| G0-07 | COMPLETE | BQ-02, BQ-03 and BQ-09 decided; posting model fixed |
| G0-08 | COMPLETE | unchanged |
| G0-09 | COMPLETE | unchanged |
| G0-10 | COMPLETE | matrix adopted |
| G0-11 | COMPLETE | unchanged |
| G0-12 | COMPLETE | taxonomy adopted |

**11 COMPLETE, 1 PARTIAL.** The open gate (G0-02, OpenAPI repair) is an implementation item with no remaining ambiguity.

## Security patch status (2026-10-05, implemented; owner authorised the auth changes)

| Item | Implementation | Tests |
|---|---|---|
| SEC-01 account lockout | `AuthAttempt` (migration `accounts/0007_auth_attempt.py`) + `apps/accounts/security.py`. `LoginView` refuses with 429 `login_locked` after 5 failures in 15 min (wrong password or MFA code). Unknown emails lock the same way. Rows are pruned after a day. | `tests/test_auth_security.py` |
| SEC-01 per-IP limit | 20/min per client IP, applied only when the BFF forwards `X-ErgonX-Client-IP` with `X-ErgonX-Proxy-Secret` = `BFF_PROXY_SECRET`. Without the secret there is no IP limit; the account lock still applies. | ✓ |
| SEC-01 email OTP | 60 s resend cooldown (the open code is kept); ≤5 codes per 15 min (429 `email_otp_throttled`); masked destination in the login challenge and MFA enrolment; `resend_available_in` returned. | ✓ |
| SEC-02 logout | `POST /api/v1/auth/logout/` blacklists the refresh token; the BFF calls it before clearing cookies. Access tokens still live ≤15 min (stateless). | ✓ |
| SEC-02 password | Change revokes every other session's refresh token (the BFF passes this session's). Reset revokes all. | ✓ |
| AUD-01 | `AuditLog` append-only: model save/delete, queryset update/delete refused (except the SET_NULL actor update on user deletion); read-only admin. | ✓ |
| AUD-02 (partial) | New events: `account.login.succeeded/failed`, `account.logout`, `account.mfa.email_otp.issued/locked`, `account.password.changed/reset_requested/reset_completed`. Audit IP now uses the forwarded client IP. | ✓ |
| Deploy | `render.yaml` (workspace root) gains `BFF_PROXY_SECRET`: generated on `ergonx-api`, read by `ergonx-web` via `fromService`. Apply the same change to the monorepo's `render.yaml`. | — |

Gate **G0-06 → COMPLETE**. Gates now: **11 COMPLETE, 1 PARTIAL** (G0-02, OpenAPI repair).

## Gate status update (2026-10-05, after the OpenAPI repair)

| Gate | Status | Evidence |
|---|---|---|
| G0-02 | COMPLETE | Backend `d04d174`: `manage.py spectacular --validate` reports 0 errors; CI fails on schema errors or a stale committed `openapi-schema.yml`. Kept at 0 errors through every later commit. |

**All 12 Wave 0 gates are COMPLETE.** Implementation then proceeded wave by wave with the owner's approval; progress is tracked in `../PHASE2_PROGRESS.md`.
