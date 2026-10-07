# ErgonX UI/UX Release-Candidate Report

Date: 2026-09-22  
Scope: Current Django source, typed Next.js frontend, current contracts, APEX-DEMO seed, and the discrepancy register.

## 1. Current-state audit

The release candidate uses a tenant-aware Django API and a permission-aware Next.js application. The canonical authenticated landing route is `/`; analytical leadership content remains at `/dashboard`.

## 2. UI defects identified

Historical defects included an unframed Settings route, raw-JSON audit history, Home/dashboard duplication, static detail back links, incomplete route-shell coverage, and an executive view without recruitment activity. These have been corrected in this increment.

## 3. Backend gaps identified

There is no generic export renderer or document-download endpoint. The production PWA uses a static-only offline shell, and its authenticated browser session is protected by a same-origin BFF with HttpOnly cookies. A posted-ledger P&L trend, registered-bank balance/cash-movement aggregate, and current-year leave-balance utilisation are now exposed from authoritative ledger and balance records; the remaining export and document-delivery boundaries are documented limitations, not browser-calculated substitutes.

## 4. Onboarding changes

Onboarding keeps the setup owner and existing active memberships read-only, supports invitations with confirmation/reissue/revoke state, and directs full access management to Settings. READY refreshes bootstrap state and returns to canonical Home.

## 5. Institution classification and locale catalogues

The institution profile persists an optional classification. Backend locale catalogues provide ISO-compatible country/currency values and IANA time-zone identifiers; country, currency, and time zone remain independent. Classification produces an optional accounting recommendation and never applies a preset automatically.

## 6. Home and Executive Dashboard

Home is a personal workspace with one contextual greeting, server-authorized quick actions, resumable work, notifications, and attention items. Executive Dashboard is analytical: workforce, attendance, payroll-by-period, financial position, registered-bank balance and cash movement, posted-ledger P&L, approvals, and tenant-scoped recruitment activity.

## 7. Role and custom-role verification

Navigation and route gates evaluate effective permissions and enabled modules, never role labels alone. A live APEX-DEMO Auditor session exposed only permitted areas; a direct `/hr` request rendered Access Denied. Settings cards and the Settings gate share one permission source.

## 8. Settings implementation

Settings is authenticated and permission-filtered. It includes supported profile/preferences, security, institution, modules, roles, users, workflows, operational configuration links, notifications, and tenant-scoped audit history. Unsupported generic controls are not represented as working UI.

## 9. Notifications, profile, and navigation

The top bar has live tenant/recipient notifications, read actions, full history, profile/security/preference actions, institution switching, and sign-out. The persistent navigation includes permission-gated Approvals. Approvals, Documents, and Operations inherit the common AppShell.

## 10. Download implementation

Reports use the shared authenticated blob-download helper and label exports truthfully as CSV. Controls have a loading state, surfaced failures, and meaningful filenames. No unsupported XLSX, PDF, payslip, or document download button is shown.

## 11. Dashboard additions

Dedicated HR, Recruitment, Leave, Attendance, Payroll, Accounting/Finance, Reports, and Executive dashboards consume server rollups. Charts and bars represent operational query results rather than mutable dashboard records. Finance and Executive include posted-ledger P&L plus registered-bank balance and cash-movement views; Leave includes current-year balance utilisation with an explicit no-entitlement state.

## 12. Reports and analytics

The Reports workspace groups tenant-scoped workforce, recruitment, leave, attendance, payroll, accounting, AP/AR, and expense reports. On-screen table summaries, supported status filters, and source-backed date ranges precede CSV export.

## 13. Audit-log implementation

`/settings/audit` is a paginated, filterable, read-only table with date, actor, action, entity, reference, safe metadata, and sensitive-value redaction. It is restricted by `audit.view`.

## 14. Payroll configuration

Payroll configuration includes setup choice, Ghana statutory read records, components, salary structures, periods, employee profiles, payroll-to-GL mappings, and fail-closed mapping states. The frontend does not calculate statutory rates.

## 15. Accounting configuration

Accounting exposes deliberate preset/custom setup, chart/fiscal/period/bank/reporting routes, Ghana tax/localisation read catalogues, and Payroll-to-GL mappings. Existing applied presets are not silently changed.

## 16. Demo seed coverage

`seed_ergonx_demo` supplies APEX-DEMO personas, organization records, recruitment, leave, attendance, payroll, accounting, audit events, notifications, dashboard data, and idempotent Home activity records. Two live runs retained: 4 Home activity events, 1 payroll run, 30 payroll records, 5 journals, 1 invoice, and 1 vendor bill. Home events resume relevant detail pages for the Institution Admin, Recruitment Officer, and an Employee. A live Institution Admin browser pass also confirmed that a Recent Work entry opens the source-backed posted-journal table.

## 17. PostgreSQL results

`manage.py migrate --check --plan` completed with no planned operations against the available PostgreSQL service. Application servers were stopped after browser verification.

## 18. Backend test results

Historical full-suite evidence in the reconciliation audit is `133 passed, 6 skipped`. The latest local full suite completed at `139 passed, 6 skipped` on 2026-09-22, including Home/recruitment activity, queued-export, and approval-workspace regressions. CI should retain machine-readable test artefacts before production sign-off.

The 2026-09-22 dashboard regression additionally covers Finance and Executive posted-ledger P&L values plus the Leave dashboard's zero-entitlement utilisation state. Its PostgreSQL-backed process completed without a pytest failure record. The APEX-DEMO selector check independently returned a September posted-ledger point and 50 entitlement / 4 used leave days.

## 19. Frontend lint and build

TypeScript, ESLint, and Next production build passed after the final navigation/dashboard changes. The generated app route manifest includes the authenticated route trees.

## 20. Migrations created

This increment contains additive migrations for institution classification, audit access, employee multi-institution profile handling, reconciled Accountant payroll permission data, queued export artifacts, and explicit employee compensation pay basis. Migration drift check reports none.

## 21. OpenAPI and contracts

The frontend platform contract documents current dashboard routes, including Executive recruitment activity, registered-bank cash movement, audit/history, notification, localisation, and CSV-only report boundaries. Typed frontend adapters mirror these contracts. Dashboard and legacy APIViews now carry explicit response/request metadata where needed; `manage.py spectacular --file openapi-schema.yml --validate` completes with no errors or warnings, resolving `OPENAPI-001`.

## 22. Discrepancy-register updates

`DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md` retains historical facts and one current status per limitation ID. UI-specific evidence is tracked in `UI_UX_ONBOARDING_RECONCILIATION_AUDIT.md`.

## 23. Remaining P0/P1 defects

No current P0 implementation defect was identified. P1 release-owner decisions remain: incremental Home activity/reference adoption (`HOME-001`), further non-report type-specific import/export handlers (`OPS-001`), and jurisdictional payroll-policy/ERD decisions recorded in the discrepancy register. `PWA-001` is resolved by the static-only production shell, `PWA-002` by the verified HttpOnly-cookie/BFF session boundary, and `OPS-001` now includes governed Employee/Attendance imports plus normalized report CSV export jobs with a bounded download artifact. `PAY-001` is now safeguarded by an explicit `PAYROLL_PERIOD` compensation basis and fail-closed calculation behavior.

## 24. Accepted MVP limitations

CSV-only exports; no generated payslip/document renderer; no public careers/AI screening; no arbitrary import/export handler; and no formatted scheduled exports. The production PWA shell is installable and provides an honest offline fallback, but deliberately never caches tenant/API data or queues writes. Registered-bank cash movement is available, but it is not a full indirect cash-flow statement and deliberately excludes unregistered asset accounts. Each remaining boundary has an explicit safe limitation in the discrepancy register.

## 25. Release-candidate readiness

The audited UI paths are ready for MVP testing: navigation is persistent and permission-aware, Home and Executive are distinct, audit data is usable, dashboards are source-backed, the production PWA shell is browser-verified, and the demo seed is idempotent. This is not unconditional production sign-off until P1 architecture and delivery limitations are accepted or resolved by the release owner.

## Evidence index

- `docs/release_candidate/UI_UX_ONBOARDING_RECONCILIATION_AUDIT.md`
- `docs/release_candidate/RELEASE_CANDIDATE_RECONCILIATION_AUDIT.md`
- `docs/demo/APEX_DEMO_ROUTE_COVERAGE_AUDIT.md`
- `Ergonx-backend/DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`
- `Ergonx-backend/docs/integration/frontend_platform_contract.md`
