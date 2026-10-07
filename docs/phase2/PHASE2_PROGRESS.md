# Phase 2 implementation progress

Order follows `wave0/WAVE_0_RECONCILIATION_REPORT.md` §10. Commits are local (nothing pushed).
Backend branch `phase2/wave2-platform`; frontend branch `phase2/wave1-design-system`.

Legend: ✅ done · 🔶 partly done · ⬜ not started · ⏸ deferred by decision

## Backend / behaviour

| Item | Status | Commit |
|---|---|---|
| W2-pre security patch (SEC-01/02, AUD-01) | ✅ | 0ced390 |
| OpenAPI 0 errors + CI gate | ✅ | d04d174 |
| Active sessions list/revoke | ✅ | 4ade3be |
| Approval engine (triggers, approver types, RETURN, escalation, requester ≠ approver) | ✅ | 913f6d2 |
| Role data scope / read-only on Role (BQ-11); privileged grant rule (PERM-03) | ✅ | 913f6d2 |
| Module dependencies + toggle audit (MOD-01/02); REPORTS gates CSV reports (BQ-05) | ✅ | 913f6d2 |
| MFA removal step-up (SEC-04); TOTP tests | ✅ | e9de8d0 |
| No hard DELETE routes (API-02); single search mount (API-03) | ✅ | e9de8d0 |
| Governed institution settings per namespace (PERM-05); SoD setting default ON | ✅ | e9de8d0 |
| Notification archive / module / bulk / email preferences | ✅ | e9de8d0 |
| Audit summary + result/category filters | ✅ | e9de8d0 |
| Landing by permission (BQ-01); AUDITOR loses executive dashboard | ✅ | e9de8d0 |
| Employee CRUD audit with masking (AUD-04 helper) | ✅ | e9de8d0 |
| Leave checks `not_evaluated` | ✅ | e9de8d0 |
| Finalized-payroll guard on attendance/overtime approval (LC-ATT-01) | ✅ | e9de8d0 |
| Sign-in activity (S043) | ✅ | 10b96dd |
| W4 recruitment: scorecard permissions (PERM-06), publish only after approval (BQ-06) | ✅ | backend pending commit; frontend 74669e5 |
| Permission coverage guard (only service-authorized endpoints skip a permission code); document download mapped | ✅ | backend pending commit |
| W5 payroll + manual journals: preparer ≠ approver (BQ-04, setting default ON); system journals exempt, record upstream approver | ✅ | backend pending commit; frontend 74669e5 |
| W6 currency guard (FIN-03), account provenance (BQ-09), Expense 2.0 (BQ-02/03): categories, lines, receipts, manager stage via engine, finance review + recode, accrual posting, settle, reverse, self-service, notifications, audit | ✅ | backend pending commit; frontend 712a4f0, a53f573 |
| W7/W8 | ⬜ | |
| Deferred: credit notes, careers portal, candidate retention, reconciliation reopen, PDF/XLSX/XBRL | ⏸ | |

## Screens

All 66 screens are accounted for. "Aligned" means the existing page (from the concept redesign) already follows the Stitch composition; "restyled" means changed in Phase 2.

| Screen(s) | Status | Commit / note |
|---|---|---|
| S001, S002 entry | restyled | 6169bf1 |
| S003, S004/S059, S060, S062 shared states and dialogs | restyled (W1 tokens and primitives) | 2b29cfa |
| S061 lifecycle pattern | built | e6cfd5e |
| S027 approval workflows | rebuilt | 00ea33a |
| S041 modules, S044 roles (matrix) | restyled | bcb1ded, c2d5aea |
| S043 security center | restyled | 3759b1d |
| S045 institution profile | restyled | 4c99b98 |
| S046 users, S058 search | aligned | — |
| S050 personal preferences | rebuilt (preferences take effect) | 45b4638 |
| S011/S007 audit trail | rebuilt | 3ae042e |
| S056 notification center | rebuilt | 00ea33a |
| S066/S064 approvals inbox | aligned + overdue filter | 74669e5 (batch approve-all not built) |
| S013 executive, S031 insights | landing rule | e9de8d0 |
| S014 HR dashboard, S015/S065 employees | restyled | b7e3c4a |
| S017 home, S021 leave, S022 attendance, S023 adjustment review, S024 employee detail, S040 leave review, S049 documents | aligned (S023 guard added) | — |
| S025 emergency contacts | note added; escalation sequence deferred | (latest) |
| S035 my leave, S036 my payslips, S037 my attendance, S038 my profile, S047/S063 employee home, S048 request leave | restyled | b7e3c4a, f9488d5, 4c99b98, 3ae042e, 45b4638 |
| S026, S028, S034, S042, S053, S057 recruitment | aligned (publish-on-draft removed) | 74669e5 |
| S032 run detail, S033 payroll workspace | aligned (SoD hint added) | 74669e5 |
| Expense screens (no Stitch screen) | built | 712a4f0 |
| S005/S010, S006/S009, S018, S020, S029, S039, S051 accounting | aligned (SoD hint on journals; system roles on chart) | a53f573 |
| S008, S012, S016, S019, S052, S054 advanced finance | aligned | — |
| S055 reports | aligned | — |
| S030 public careers | deferred (W8+) | — |

Deferred by decision (not built): credit notes, careers portal, candidate retention, reconciliation reopen, payroll "Paid" state, external calendars, identity verification, performance trajectory, healthcare proxy / escalation order, PDF/XLSX/XBRL exports, SMS OTP, procurement/learning/performance/benefits.

Visual checks: no headless browser is installed, so screens are verified by typecheck and lint only. Check each restyled screen in the browser.
