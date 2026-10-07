# ErgonX Development Discrepancies and Limitations Register

Last updated: 2026-09-24

## Purpose

This is the durable review register for differences between the governing ErgonX documents and the implementation, unresolved product or legal decisions, deliberate MVP constraints, and technical limitations discovered during development.

Update this file whenever development reveals:

- an ERD field or entity that is missing, ambiguous, or unsuitable for the required behavior;
- an implementation extension or deviation from the governing source set;
- a legal, statutory, security, or data-integrity assumption that still needs validation;
- a feature that is implemented with a fail-closed safeguard;
- an accepted limitation or deferred capability that materially affects users;
- a defect or technical risk that cannot be resolved in the current stage.

Do not silently remove entries. When an item is resolved, move it to **Resolved items**, record the decision and date, and link the migration, test, or document that proves the resolution.

## Status and priority definitions

- `OPEN`: unresolved and requires implementation, research, or a decision.
- `SAFEGUARDED`: unresolved, but the implementation blocks or contains the unsafe behavior.
- `REVIEW`: implemented with an explicit design choice that should be ratified.
- `ACCEPTED_MVP`: intentionally outside the present MVP boundary.
- `RESOLVED`: completed and retained for historical traceability.
- `P0`: release-blocking security, integrity, or statutory risk.
- `P1`: important decision or limitation before the affected workflow is used in production.
- `P2`: material product limitation with a safe workaround.
- `P3`: deferred enhancement or operational convenience.

## Governing source set

- `ERGONX_CODEX_START_PROMPT.md`
- `ERGONX_CODEX_CONTEXT_v1.6.md`
- `ERGONX_CODEX_FOUNDATION_RECONCILIATION_PROMPT.md`
- `ERGONX_CONSOLIDATED_ERD_SPEC_v1.1.md`
- `ERGONX_PRODUCT_ROADMAP_v1.0.md`
- `ERGONX_CODEX_MODULE_DELIVERY_AND_INTEGRATION_CONTRACT_v1.0.md`

Later explicitly approved versions supersede older versions. Statutory source material must be recorded in the relevant preset metadata and revalidated when a new preset version is created.

## Current module completion gate

Under the Module Delivery and Frontend Integration Contract v1.0, the current delivery status is:

| Module | Status | Reason |
|---|---|---|
| Payroll | `COMPLETE WITH DOCUMENTED LIMITATIONS` | Runtime implementation, selector separation, stable API errors, operation-level OpenAPI, endpoint contract matrix, audit/notification transition integration, PostgreSQL tests, deterministic demo data, frontend integration note, and completion report are green. Product limitations remain explicitly recorded below. |
| Ghana Payroll Preset | `PARTIALLY COMPLETE` | Statutory seed, selector-backed localized reads, stable errors, operation-level OpenAPI, endpoint contract matrix, audit/notification integration, calculation tests, frontend integration note, and completion report are green, but open Ghana statutory/model decisions remain. |
| Accounting Core | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD-aligned ledger kernel, API/security matrix, OpenAPI, audit/notifications, deterministic demo, and PostgreSQL 16 gate are complete; explicit limitations remain below. AP/AR/cash/expenses were delivered after the accounting kernel, and the earlier sequencing note is superseded under `RES-017`. |
| Accounting Presets | `COMPLETE WITH DOCUMENTED LIMITATIONS` | Generic preset/version/chart/account-template schema, atomic/idempotent application, 43-operation Accounting API matrix, deterministic demo, OpenAPI, and PostgreSQL 16 gate are complete; provenance/migration/recommendation gaps remain explicit below. |
| Ghana Accounting Localization | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD §§24–25 tax/localization catalog, Ghana preset family, GHS defaults, vendor/customer/institution tax profiles, VAT-withholding certificate issue/void lifecycle, compliance reminders, guarded source provenance, and API access are implemented. Filing, remittance, and legal-rate confirmation remain explicitly outside the MVP. |
| Accounts Payable | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD Vendor/VendorBill/VendorBillLine schema, tenant-safe APIs, derived totals, approval workflow, audit/notifications, balanced AP journal posting, one-bill payment settlement, and VAT-withholding certificates are implemented. Multi-document allocation, posted-bill reversal, AP-specific attachments, and richer supplier tax-profile workflows remain deferred under `CASH-001`, `EXP-001`, and `GHA-ACC-001`. |
| Accounts Receivable | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD Customer/Invoice/InvoiceLine schema, tenant-safe APIs, derived totals, controlled issue-to-AR-journal workflow, audit history, and one-invoice receipt settlement are implemented. Credit notes/reversals, attachments, richer customer tax-profile workflows, and external E-VAT lifecycle remain deferred under `AR-001`, `AR-002`, and `GHA-ACC-001`. |
| Cash / Bank and Settlement | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD BankAccount, Payment, and Receipt, tenant-safe APIs, one-document settlement, balanced CASH journals, reversal-on-void, and auditable bank statement-line reconciliation are implemented. Allocation, file ingest, and bank feeds remain explicitly deferred under `CASH-001` and `CASH-002`. |
| Expenses | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD Expense schema, tenant-safe APIs, Document attachment safeguard, draft/approval workflow, balanced EXPENSE journal posting, RBAC, audit events, focused test, and frontend/completion records are complete. Settlement/reimbursement, allocation, and expense-specific correction remain deferred under `EXP-001`. |
| Payroll-to-Accounting Integration | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD mapping-template and institution mapping entities, tenant-safe APIs, governed Ghana starter templates, idempotent finalized-run draft PAYROLL journals, protected run link, and the standard accounting submit/approve/post flow are implemented. Unmapped special/custom payroll effects fail closed under `PAY-ACC-001`. |
| Shared Frontend Platform Contracts | `COMPLETE WITH DOCUMENTED LIMITATIONS` | A consolidated frontend platform contract now documents shared auth/tenant/envelope rules, the static-only PWA and HttpOnly-session boundaries, dashboard/report endpoints, shared documents, generalized approvals, import/export foundations, background jobs, and links to module-specific contracts. Remaining product limitations are explicit under `PWA-003`, `REPORT-001`, and `OPS-001`; `PWA-001` and `PWA-002` are retained as resolved historical records. |
| Recruitment / ATS | `COMPLETE WITH DOCUMENTED LIMITATIONS` | ERD-required Recruitment entities, tenant/RBAC APIs, explicit workflow services, shared document linkage, audit/notifications, deterministic demo data, and atomic/idempotent Employee conversion are complete. PostgreSQL focused tests and full regression are green; only `RECRUIT-001` and `RECRUIT-002` remain as documented scope/ERD decisions. |

## Open discrepancies and decisions

### HOME-001 - Experience-layer foundation is delivered; reference-code adoption and activity capture remain incremental

- Area: Personalized Home / universal search / settings / reference codes
- Type: Governing-instruction delivery gap
- Status: `OPEN`
- Priority: `P1`
- Governing references: `ERGONX_CODEX_HOME_SEARCH_SETTINGS_REFERENCE_IDS_INSTRUCTIONS_v1.0.md` sections 4-50.
- Historical finding (2026-09-16): Before this increment there was no Home endpoint, search registry, preference/activity storage, reusable reference-sequence service, or settings API hierarchy.
- Current implementation and limitation: `/api/v1/home/`, `/api/v1/search/`, personal preferences, institution/module settings, permission-aware action catalogue, tenant-scoped PostgreSQL provider registry, and locked `ReferenceSequence` issuance are now implemented. Employee, candidate, leave-request, attendance-adjustment, recruitment application submission, interview updates, offers, compensation changes, payroll adjustments, manual-journal, and payroll-run creation append tenant-scoped `UserActivityEvent` records only after their authoritative write succeeds; Home resolves those events to their actual detail route rather than a generic action route. Existing business entities still retain their historical code fields, and not every create workflow has been migrated to request a generated reference or emit an activity event.
- Impact: The platform contract is available now; generated-reference coverage and Home recency will grow per domain without invalidating legacy references.
- Decision or work needed: Integrate `next_reference` and `UserActivityEvent` into each relevant write service only when its existing identifier compatibility is reviewed.
- Evidence: `apps/attendance/services.py`, `apps/compensation/services.py`, `apps/dashboards/home.py`, `apps/institutions/search.py`, `apps/institutions/models.py`, `apps/institutions/services.py`, `apps/institutions/views.py`, `apps/payroll/services.py`, `apps/recruitment/services.py`, `ergonx-frontend/src/components/layout/TopBar.tsx`, `tests/test_scheduling_attendance.py`, `tests/test_payroll.py`, `tests/test_recruitment.py`, `docs/integration/home_frontend_contract.md`, and `docs/integration/reference_codes_frontend_contract.md`. Validation on 2026-09-24 covered the seeded Institution Admin Home and Executive Dashboard in a production browser, visible Search-button and Ctrl/Cmd+K opening, an `EMP-000109` cross-module query returning controlled employee/leave results, controlled employee-result navigation, a 16-route authenticated operational sweep, six 390px routes with no horizontal overflow, payroll-run and payroll-adjustment activity/idempotency regression coverage, attendance-adjustment activity regression, and recruitment activity assertions; the remaining limitation is incremental domain-wide activity/reference adoption, not a broken Home route.

### RECRUIT-001 - Recruitment ERD names entities but leaves field-level and workflow details unspecified

- Area: Recruitment / ATS
- Type: ERD implementation decision
- Status: `REVIEW`
- Priority: `P2`
- Governing references: Consolidated ERD v1.1 Recruitment / ATS capability list and Product Roadmap stage 16.
- Observed behavior or limitation: The governing ERD requires JobPosting, Candidate, Application, RecruitmentStage, Interview, CandidateEvaluation, and Offer, but does not provide a field-level Recruitment schema or state machine.
- Current implementation decision: Tenant-scoped posting, candidate, application, stage-history, interview, evaluation, and offer records use explicit service-backed lifecycles. Offers optionally create the existing compensation record only when both a salary structure and base salary are supplied; successful hiring creates canonical Employee and Employment records atomically.
- Impact: These fields and transition rules are a conservative MVP interpretation rather than a verbatim ERD table specification.
- Decision or work needed: Ratify the field/state model before adding public careers, onboarding handoff, configurable assessments, or external integrations.
- Evidence: `apps/recruitment/models.py`, `apps/recruitment/services.py`, `docs/integration/recruitment_frontend_contract.md`, and `tests/test_recruitment.py`.

### RECRUIT-002 - Public careers, AI screening, and onboarding handoff remain outside the Recruitment MVP

- Area: Recruitment / ATS scope control
- Type: Intentional MVP boundary
- Status: `ACCEPTED_MVP`
- Priority: `P3`
- Governing references: Product Roadmap Recruitment section allows public careers only where capacity permits; ERD Phase 2 lists AI-assisted screening and advanced onboarding/offboarding.
- Observed behavior or limitation: Recruitment provides internal ATS records and candidate document linkage only. There is no public portal, job-board integration, automated onboarding, AI screening, or configurable assessment engine.
- Current safeguard or workaround: Candidate conversion ends at the existing Employee, Employment, and optional EmployeeCompensation domains; any later onboarding process remains separately governed.
- Decision or work needed: Treat additions as Phase 2 unless explicitly reprioritized after release-candidate freeze.
- Evidence: `apps/recruitment/`, `docs/integration/recruitment_frontend_contract.md`.

### DASH-001 — Cash dashboard is a registered-bank movement view, not a full cash-flow statement

- Area: Finance and Executive dashboards
- Type: Delivery limitation
- Status: `REVIEW`
- Priority: `P2`
- Governing references: UI/UX release-candidate brief §§14–15 and Accounting/Cash-Bank ERD scope.
- Observed behavior or limitation: `/api/v1/dashboards/finance/` and `/api/v1/dashboards/executive/` now return current bank balance and up to twelve monthly inflow/outflow/net-movement points from posted `JournalLine` records belonging to active `BankAccount.ledger_account` records. This is intentionally not an indirect cash-flow statement and does not infer cash from arbitrary asset accounts.
- Impact: The dashboard accurately shows configured bank-ledger movement, but does not classify cash movement into operating, investing, and financing activities or represent unregistered cash accounts.
- Current safeguard or workaround: Zero active bank accounts returns an explicit zero balance and empty trend. Only posted journals and explicitly registered bank ledger accounts contribute, preventing receivables or unrelated assets from being displayed as cash.
- Decision or work needed: Add governed cash-account classification and statement presentation only when accounting policy and account-mapping requirements are approved.
- Evidence: `apps/dashboards/views.py`, `tests/test_dashboards_reports.py`, `docs/integration/frontend_platform_contract.md`, and the Finance/Executive dashboard pages.

### OPENAPI-001 — Generated schema serializer-discovery and operation-ID issues

- Area: OpenAPI contract publishing
- Type: Documentation/runtime-contract limitation
- Status: `RESOLVED`
- Priority: `P2`
- Governing references: UI/UX release-candidate brief §27 and Module Delivery Contract API/OpenAPI requirements.
- Historical finding (2026-09-22): `manage.py spectacular --file openapi-schema.yml --validate` generated a schema but reported 122 discovery errors (19 unique) and eight warnings. The errors were concentrated in APIViews whose request/response shape was already implemented but undisclosed to the schema generator; three operation IDs also collided.
- Resolution (2026-09-22): Existing concrete serializers or object responses were declared on authentication, self-service, preference/settings, onboarding/search, notification, reports, Home, and dashboard actions. Schema-only fake-queryset guards prevent tenant-context access during inspection; serializer method return annotations remove ambiguous fields; and explicit unique operation IDs resolve the three collisions.
- Validation: `manage.py spectacular --file openapi-schema.yml --validate` now exits zero with no errors or warnings. Runtime endpoint behavior is unchanged; regression tests remain the source of behavioral proof.
- Evidence: `openapi-schema.yml`, `common/schema.py`, `apps/accounts/views.py`, `apps/employees/views.py`, `apps/institutions/views.py`, `apps/notifications/views.py`, `apps/audit/views.py`, `apps/reports/views.py`, `apps/dashboards/views.py`, and the 2026-09-22 schema-generation command output.

### OPS-001 — Shared import/export infrastructure needs type-specific handlers

- Area: Platform operations / import-export
- Type: Delivery limitation
- Status: `REVIEW`
- Priority: `P1`
- Governing references: Product Roadmap Shared Infrastructure and Context v1.6 §91.
- Observed behavior or limitation: Shared tenant-safe ImportJob, ImportRowResult, ExportJob, and BackgroundJob APIs and queue records now exist. Validated `EMPLOYEE` and `ATTENDANCE` import handlers and a normalized report CSV export handler are registered; no generic handler can infer a domain's column mapping, validation, idempotency contract, or output layout for arbitrary remaining types.
- Impact: Employee/attendance imports, notification delivery, and report CSV export jobs can execute through the worker. Other domain imports/exports remain safely queued until their explicit handlers are registered.
- Current safeguard or workaround: Import confirmation is permitted only from the validated READY state, and the worker fails unregistered job types visibly rather than silently committing data.
- Decision or work needed: Register any further import/export type only with documented schema/version/idempotency rules; report artifacts are currently bounded to 10 MB inline storage.
- Evidence: `apps/reports/services.py`, `apps/operations/models.py`, `apps/operations/views.py`, `apps/operations/management/commands/run_background_jobs.py`, `docs/integration/frontend_platform_contract.md`, and `tests/test_operations_platform.py`.

### REPORT-001 — MVP exports are CSV only

- Area: Reports and analytics
- Type: Delivery limitation
- Status: `ACCEPTED_MVP`
- Priority: `P2`
- Governing references: Product Roadmap Reports & Analytics requests Excel/PDF export where practical; Context v1.6 §§25 and 80 list PDF and Excel outputs.
- Observed behavior or limitation: The eight tenant-scoped report endpoints provide a practical spreadsheet-ready CSV download. Native XLSX and PDF rendering remain unavailable; queued CSV exports now generate bounded saved artifacts and expose a download endpoint.
- Impact: Users can open exports in Excel-compatible tools, but cannot receive formatted workbook or printable PDF output from ErgonX.
- Current safeguard or workaround: Exports derive directly from authoritative tenant-scoped operational data and require `report.view`; CSV is deliberately not cached by the PWA worker.
- Decision or work needed: Add XLSX/PDF renderers and external/object storage before formatted or large asynchronous exports are required.
- Evidence: `apps/reports/views.py`, `frontend/app/workspace/[name]/page.tsx`, and `tests/test_dashboards_reports.py`.

### PWA-001 — PWA delivery was deferred because the current checkout lacked verifiable assets

- Area: Next.js PWA delivery
- Type: Implementation/documentation discrepancy
- Status: `RESOLVED`
- Priority: `P1`
- Governing references: Context v1.6 §§5 and 159–184; Product Roadmap PWA / Frontend section.
- Historical claim: The prior platform contract and this register stated that a manifest, service worker, static-asset cache, standalone display, and offline fallback had been delivered, with operational data deliberately network-only.
- Historical finding (2026-09-20): The active `ergonx-frontend/` checkout contains no manifest, service worker, offline route, or service-worker registration source, so the prior delivery claim was not verifiable from the code being run.
- Impact at discovery: The app could not be described as installable or offline-capable; its claimed application-shell safety boundary did not exist.
- Resolution (2026-09-22): Added `public/manifest.webmanifest`, a production-only `ServiceWorkerRegistration`, a static `/offline` route, and `public/sw.js`. The worker caches only static same-origin assets plus the generic fallback; it never caches navigation pages, `/api/` requests, exports, JWTs, selected-institution values, or tenant data, and it does not queue writes.
- Validation: `npx tsc --noEmit`, `npm run lint`, and `npm run build` completed after the PWA files were added. A production-mode standalone smoke test returned HTTP 200 for the manifest, worker, and offline route; a real browser confirmed the manifest link and an active worker at the application scope. The manifest is valid JSON and the worker is source-reviewed for the stated cache exclusions.
- Evidence: `ergonx-frontend/public/manifest.webmanifest`, `ergonx-frontend/public/sw.js`, `ergonx-frontend/src/components/pwa/ServiceWorkerRegistration.tsx`, `ergonx-frontend/src/app/offline/page.tsx`, and `Ergonx-backend/docs/integration/frontend_platform_contract.md`.

### PWA-002 — Browser session tokens were stored in local storage

- Area: Frontend authentication
- Type: Security architecture limitation
- Status: `RESOLVED`
- Priority: `P1`
- Governing references: Context v1.6 tenant/RBAC requirements and PWA frontend baseline.
- Historical finding: The frontend stored short-lived JWT access/refresh tokens and the selected institution UUID in browser local storage to attach the existing API's required bearer and `X-Institution-ID` headers.
- Impact at discovery: A future XSS defect could expose bearer credentials. CSP mitigated but could not eliminate that session-boundary risk.
- Resolution (2026-09-22): Added the same-origin `src/app/api/v1/[...path]/route.ts` BFF proxy. It strips tokens from login/refresh JSON, stores them in HttpOnly SameSite cookies, attaches bearer credentials server-side to Django, refreshes with the HttpOnly refresh cookie, applies an unsafe-method origin check, and clears cookies on proxy logout. The client stores only a non-sensitive session hint and institution UUID; it no longer emits an Authorization header.
- Validation: Production-mode login returned no `access` field to JavaScript while `ergonx_access` and `ergonx_refresh` were HttpOnly; authenticated `/auth/me/`, cookie refresh, and logout-through-proxy passed, post-logout `/auth/me/` correctly returned 401, and a hostile `Origin` on an unsafe proxy request returned 403.
- Evidence: `ergonx-frontend/src/app/api/v1/[...path]/route.ts`, `ergonx-frontend/src/lib/api/client.ts`, `ergonx-frontend/src/lib/api/auth.ts`, `ergonx-frontend/src/components/guards/AuthProvider.tsx`, and the 2026-09-22 production smoke output.

### PWA-003 — Initial frontend operational screens are read-oriented

- Area: Frontend module delivery
- Type: MVP implementation limitation
- Status: `ACCEPTED_MVP`
- Priority: `P2`
- Governing references: Context v1.6 §83 route architecture and the Product Roadmap PWA / Frontend section.
- Observed behavior or limitation: The initial responsive module screens cover employee, leave, attendance, payroll, and accounting record browsing, dashboard visibility, and report exports. They do not yet reproduce every backend create, edit, approval, posting, correction, and detail workflow as dedicated forms.
- Impact: Operational staff can inspect live tenant-scoped records from the PWA, but must use the documented API or a subsequent frontend increment for full transaction management.
- Current safeguard or workaround: Each list request remains authenticated, tenant-scoped, and subject to the backend module/RBAC policy; no client-side workflow bypass exists.
- Decision or work needed: Deliver form/workflow screens incrementally by module, starting with employee/leave and then attendance/payroll/accounting actions.
- Evidence: `frontend/app/modules/[module]/page.tsx`, `frontend/app/workspace/[name]/page.tsx`, and existing backend integration contracts.

### ROADMAP-002 — Accounting Core scope order conflicts with the consolidated ERD build order

- Area: Accounting roadmap sequencing
- Type: Governing-source scope ambiguity
- Superseded: 2026-09-13 by `RES-017`
- Priority: `P2`
- Governing references: Product Roadmap §3 includes AP, AR, cash/bank, and expenses under Core Accounting; Consolidated ERD v1.1 §32 orders Accounting Core, accounting presets, Ghana accounting localization, then AP/AR/cash/expenses.
- Historical implementation decision: Follow the ERD's explicit dependency order. Build the accounting configuration/chart/fiscal-period/journal/ledger/reporting kernel first; build presets and Ghana localization next; then add AP/AR/cash/expenses. This did not remove any roadmap capability.
- Supersession evidence: AP, AR, cash/bank, settlement, bank reconciliation, and expenses are now delivered with documented limitations; see `RES-017`.

### ROADMAP-003 — Ghana localization scope names entities scheduled after the current ERD stage

- Area: Ghana accounting localization / delivery sequencing
- Type: Governing-source dependency conflict
- Superseded: 2026-09-13 by `RES-018`
- Priority: `P1`
- Original governing conflict: Product Roadmap section 3 listed vendor/customer tax profiles, Ghana compliance calendar behavior, VAT withholding, and payroll mappings before those dependent AP/AR/cash/payroll-accounting workflow entities had been delivered.
- Historical implementation decision: Deliver the ERD sections 24-25 global/versioned Ghana tax catalog, Ghana accounting preset family, starter charts, GHS defaults, source provenance, and read-only discovery API first, then defer dependent workflow behavior until AP/AR/cash/payroll-accounting entities existed.
- Supersession evidence: Vendor/customer statutory profile fields, VAT withholding certificate lifecycle, accounting compliance reminders, and payroll-to-GL mapping templates are now delivered with legal/ERD boundaries retained under `GHA-ACC-001`, `PAY-ACC-001`, `ERD-008`, and `ERD-009`; see `RES-018`.

### ERD-008 — Ghana localization is referenced by a string rather than a relational key

- Area: Ghana accounting localization / version integrity
- Type: ERD relational-integrity gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §23.2 gives `AccountingPresetVersion.localization_version` as a string, while ERD §25.1 defines `GhanaLocalizationVersion` as the versioned configuration entity used by Ghana Accounting Presets.
- Observed limitation: The prescribed field list cannot enforce a database foreign-key relationship between a Ghana accounting preset version and its Ghana localization version.
- Current safeguard: Seeded Ghana preset versions use the canonical `GH-LOCALIZATION-2026.1` code; their immutable migration metadata carries the same source provenance. Application remains restricted to active/effective same-country preset versions.
- Decision needed: Replace the string with a foreign key, or formally designate the canonical localization code as the stable cross-entity contract.

### ERD-009 — Tax and withholding records have no direct statutory-source fields

- Area: Ghana accounting localization / statutory provenance
- Type: ERD auditability gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §§24.1–24.3 define TaxCode, TaxComponent, and WithholdingRule without a source or reference field; Context §§56 and 61 require legal/accounting validation and statutory source/reference metadata.
- Observed limitation: A consumer of an individual tax record cannot retrieve its primary-source reference directly from the ERD-defined field list.
- Current safeguard: `GhanaLocalizationVersion.source_metadata` and the linked preset-version metadata retain the official GRA VAT, withholding-tax, and VAT-withholding URLs. Every seeded withholding rule has `requires_confirmation=true`, so downstream transaction processing must require an explicit applicability review.
- Decision needed: Add a source/reference relation or JSON field to the tax configuration entities before automated tax posting or compliance filing is enabled.

### ERD-010 — VendorBillLine has transitive rather than direct tenant ownership

- Area: Accounts Payable / tenancy
- Type: ERD ownership ambiguity
- Status: `REVIEW`
- Priority: `P2`
- Governing references: ERD §19.3 defines `VendorBillLine.vendor_bill` but no `institution`; ERD §30 requires tenant consistency for accounting data.
- Current implementation decision: Preserve the ERD field set. A bill line inherits tenant scope through its required VendorBill; model validation checks expense-account, tax-code, and withholding-rule compatibility through the bill's institution/configuration, and APIs expose lines only through their bill.
- Impact: Tenant manager filtering cannot be used directly for VendorBillLine; unsupported direct database writes must not bypass service/model validation.
- Decision needed: Ratify transitive ownership or add a denormalized institution FK with synchronization rules in a later ERD revision.

### AP-001 — VendorBill totals and tax applicability are not specified as derived behavior

- Area: Accounts Payable / monetary integrity
- Type: ERD workflow gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §§19.2–19.3 stores bill subtotal/tax/withholding/total/payable values and optional TaxCode/WithholdingRule links, but does not define the calculation, rounding, preset compatibility, or direct-write behavior.
- Current implementation decision: Supported services derive subtotal from `quantity × unit_price`, tax total from separately configured TaxComponents, withholding total from the linked effective rule, total amount as subtotal plus tax, and amount payable as total less withholding. All tax/rule links must be active/effective and belong to the institution's selected accounting preset version; Custom setup therefore cannot silently apply a Ghana catalog rule.
- Impact: Direct SQL, bulk operations, or a future custom tax engine can bypass or require a new explicit calculation contract.
- Decision needed: Ratify these calculation/rounding semantics, then specify per-line tax/withholding snapshots and exceptional tax-base behavior before production tax posting.

### AP-002 — VendorBill status actor/timestamp fields are absent

- Area: Accounts Payable / auditability
- Type: ERD lifecycle-history limitation
- Status: `REVIEW`
- Priority: `P2`
- Governing reference: ERD §19.2 specifies bill status but no submitted, approved, posted, or voided actor/timestamp fields.
- Current implementation decision: Transition actions create immutable AuditLog events with actor, timestamp, before/after state, totals, and linked journal identity. No ungoverned lifecycle columns are added.
- Decision needed: Ratify AuditLog as the authoritative lifecycle history or extend VendorBill in a future ERD version.

### AP-003 — AP posting depends on template-code account resolution

- Area: Accounts Payable / accounting integration
- Type: Follow-on impact of ERD provenance gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §§19.2–19.3 requires VendorBill posting into the general ledger; ERD §23.4 defines mapping codes only on AccountTemplate, while ERD §15.1 omits account-template provenance from instantiated Account.
- Current implementation: AP posting resolves each required mapping code from the selected preset's AccountTemplate, then finds the institution Account with the template's code. Missing, inactive, non-postable, ambiguous, or Custom-mode mappings fail closed before any journal or bill state is written.
- Impact: An unsupported direct account-code rename or a future multi-chart preset requires an explicit mapping/provenance strategy.
- Decision needed: Resolve `ERD-005` with durable Account mapping provenance before enabling unrestricted chart customization or automated posting integrations.

### AR-001 — Invoice lifecycle has no approval state or lifecycle actor fields

- Area: Accounts Receivable / workflow auditability
- Type: ERD workflow gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing reference: ERD §20.2 provides `DRAFT`, `ISSUED`, `PART_PAID`, `PAID`, and `VOID`, but no pending/approved state or submitted/issued actor/timestamp fields.
- Current implementation decision: Preserve the ERD statuses. Issue transitions create and post the associated AR journal only when the actor has the governed journal create/approve/post permissions; the immutable AuditLog records actor, timestamp, state change, and journal identity.
- Impact: There is no separate commercial credit/approval queue before an invoice is issued.
- Decision needed: Define an invoice approval/credit-control workflow and dedicated lifecycle fields if business policy requires reviewer separation.

### AR-002 — Invoice tax calculation and output-account resolution are implicit

- Area: Accounts Receivable / tax and ledger integrity
- Type: ERD workflow gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §§20.2–20.3 stores invoice totals and optional TaxCode but does not specify computation/rounding; Account mapping provenance remains absent under `ERD-005`.
- Current implementation decision: Supported services derive invoice subtotal and separately rounded configured TaxComponents, then resolve output mapping codes through the selected preset's AccountTemplate and instantiated account code. Missing/ambiguous mappings, Custom mode, inactive rules, or date mismatch fail closed.
- Decision needed: Ratify calculation/rounding and introduce durable Account mapping provenance before broad chart customization or external tax integration.

### CASH-001 — The ERD does not specify payment/receipt workflow, allocation, or reconciliation semantics

- Area: Cash / bank and AP/AR settlement
- Type: ERD workflow gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §§21.1–21.3 defines `BankAccount`, `Payment`, and `Receipt` field lists, while §§19.2 and 20.2 reserve `PART_PAID` and `PAID` statuses. It does not define payment/receipt status values, allocation tables, reversal rules, accounting-period selection, cash-account handling, or reconciliation entities.
- Current implementation decision: A posted Payment is linked to exactly one VendorBill and a posted Receipt to exactly one Invoice, as the ERD's nullable direct foreign keys allow. Each transaction creates a balanced `CASH` journal, derives the linked bill/invoice settlement status from non-voided transaction totals, and refuses cross-tenant, currency, closed-period, inactive-bank, missing-cash-mapping, or over-settlement writes. Void uses a posted journal reversal and recomputes the linked document state.
- Current extension: `BankStatementLine` adds an imported signed bank movement, immutable bank external ID, matched posted journal, status, reconciler, and timestamp. Matching is one statement line to one posted journal only when the movement on the selected bank ledger account exactly equals the statement amount; matching/unmatching is audited and does not change ledger entries or period status.
- Impact: Split allocation across multiple bills/invoices, unallocated deposits/payments, statement-file parsing, automatic matching, and bank feeds remain out of scope.
- Decision needed: Ratify `BankStatementLine` as the MVP reconciliation extension and specify `PaymentAllocation`/`ReceiptAllocation` plus richer reconciliation entities if multi-document settlement or automated matching is required.

### CASH-002 — Payment/receipt journal period is not represented in the ERD

- Area: Cash / bank accounting-period integrity
- Type: ERD field omission
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §§21.2–21.3 gives only transaction dates and a journal link; §15.3 requires every JournalEntry to have an AccountingPeriod.
- Current implementation decision: The service resolves the sole active-institution accounting period containing `payment_date` or `receipt_date` and fails closed if no single open period exists. No non-ERD period foreign key is added to Payment or Receipt.
- Impact: Clients cannot explicitly select a period; period ownership is deterministic from the transaction date.
- Decision needed: Ratify date-derived period resolution or add an explicit `accounting_period` field in a future ERD revision.

### EXP-001 — Expense attachment, settlement, and posting semantics are underspecified

- Area: Expenses / accounting workflow
- Type: ERD workflow and relation gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §22.1 defines one nullable `attachment`, an expense account, amount, currency, status, actors, and a journal link. It does not name the attachment entity, define approval authority or transition conditions, provide a payment/bank/AP relationship, or describe journal lines and correction of a posted expense.
- Current implementation decision: `attachment` is implemented as an optional same-tenant FK to the existing shared `documents.Document` record. Expenses follow `DRAFT -> PENDING -> APPROVED -> POSTED` or `REJECTED`; a post creates a balanced `EXPENSE` journal that debits the selected expense account and credits the selected preset's `CASH` mapping. The actor must hold the existing controlled journal create/approve/post permissions as well as the appropriate expense permission. A posted Expense remains immutable; its journal must use the core journal reversal path, with no undocumented expense status added.
- Impact: The bounded MVP treats this as a cash-paid expense. AP/reimbursement/card/bank-payment linkage, multi-attachment support, reimbursement approval policies, allocation, and an Expense-specific reversal state remain out of scope.
- Decision needed: Define a canonical attachment relation, settlement/reimbursement model, approval policy, and post-correction status/link if those workflows are required.

### GHA-ACC-001 — Remaining Ghana-accounting roadmap workflows have no ERD-owned transaction entities

- Area: Ghana accounting localization
- Type: Governing-source/model gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: Product Roadmap §3 calls for vendor/customer tax profiles, VAT-withholding certificates, and an accounting compliance calendar; ERD §§24–25 defines only the versioned localization and tax-rule catalogs. No profile, certificate, accounting-deadline, filing, remittance, or relation fields are specified.
- Current implementation decision: Add minimal, explicit extensions: statutory profile metadata on Institution/Vendor/Customer; `VATWithholdingCertificate` for tenant-unique issue/void audit history on posted bills; and `GhanaComplianceReminder` for authority/reference/due-date/status tracking. Certificate issuance requires an explicit VAT-withholding-agent configuration and a VAT withholding rule selected from the active preset. Tax-code/rule use remains effective-date and preset-scoped; uncertain classifications continue to require confirmation.
- Legal-review boundary: The product does not establish appointment as an agent, validate a taxpayer identifier against GRA, determine legal eligibility, certify statutory rate currency, file a return, remit money, confirm authority acceptance, or automatically mark a reminder compliant. These decisions require finance/legal review and authoritative current sources.
- Impact: The MVP can retain tax-profile evidence, calculate only catalog-backed tax mappings, issue/void internal certificate records, and surface reminders. It must not be represented as GRA filing/remittance or legal-advice software.
- Decision needed: Ratify the extensions in the next ERD revision; provide prescribed certificate evidence/numbering, filing/remittance, and statutory-deadline rules before those capabilities are automated.

### PAY-ACC-001 — Payroll-to-journal aggregation and finalization linkage are not specified

- Area: Payroll-to-accounting integration
- Type: ERD workflow gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §18.1 and §26.1 define component mappings/templates, but do not specify how PayrollItem/PayrollRecord amounts aggregate, how a PayrollRun links to its journal, which date/period applies, or whether finalization automatically posts.
- Current implementation decision: `PayrollRun.accounting_journal_entry` is an explicit protected extension. A finalized run creates one idempotent draft `PAYROLL` journal dated to its pay date. Effective tenant component mappings take precedence; standard payroll-item snapshot codes resolve through the selected preset template. Every item must have a complete debit/credit pair, account effects net by account, and the linked journal then uses the independent submit/approve/post controls.
- Impact: Standard Ghana templates cover base pay, PAYE, and mandatory pension only. New localized effects and arbitrary item codes fail closed until governed templates or explicit component mappings exist; the system does not infer accounting treatment.
- Decision needed: Ratify the run-to-journal extension and aggregation behavior before an automated payroll post is enabled.

### ERD-001 — Employee tax residency has no ERD-owned storage location

- Area: Payroll / Ghana localization
- Type: ERD extension
- Status: `REVIEW`
- Priority: `P1`
- Governing reference: ERD §12.3 defines `TaxRule.residency`, but the Employee and Payroll transaction models do not define the corresponding employee classification.
- Current implementation: `EmployeePayrollProfile` is a tenant-owned one-to-one payroll extension containing explicit `RESIDENT` or `NON_RESIDENT` status and an optional tax identification number. Ghana calculation fails closed when the profile is missing.
- Evidence: `apps/payroll/models.py`, `apps/payroll/migrations/0002_employeepayrollprofile.py`, and `tests/test_ghana_payroll.py`.
- Decision needed: Ratify the payroll-scoped extension in the next ERD revision or designate a different canonical employee tax-profile entity.

### ERD-002 — MinimumWageRule is suggested but not defined in consolidated ERD v1.1

- Area: Payroll / Ghana localization
- Type: Source-model inconsistency
- Status: `REVIEW`
- Priority: `P2`
- Governing reference: Context §45.2 suggests `MinimumWageRule`; ERD §12 defines `StatutoryThreshold` but no `MinimumWageRule` entity.
- Current implementation: The 2026 national daily minimum wage is stored as the effective-dated `NATIONAL_DAILY_MINIMUM_WAGE` statutory threshold in `GH-2026.1`.
- Evidence: `apps/payroll/migrations/0003_seed_ghana_payroll_2026.py`.
- Decision needed: Confirm `StatutoryThreshold` as the canonical representation or add a fully specified minimum-wage entity to the ERD.

### ERD-003 — JournalLine has transitive rather than direct tenant ownership

- Area: Accounting Core / tenancy
- Type: ERD ownership ambiguity
- Status: `REVIEW`
- Priority: `P2`
- Governing references: ERD §17.2 omits `institution` from JournalLine while ERD §30 requires tenant consistency for accounting data.
- Current implementation: JournalLine follows the ERD field list and is tenant-scoped through its required JournalEntry. Model validation checks that account and optional dimensions match `journal_entry.institution`; APIs filter through that same relationship.
- Impact: The shared `TenantOwnedModel` manager cannot be used directly for JournalLine, and unsupported direct database queries must remember the journal relationship.
- Decision needed: Ratify transitive ownership or add a denormalized `institution` FK plus database synchronization constraints in a future ERD.
- Evidence: `apps/accounting/models.py`, `apps/accounting/views.py`, and `tests/test_accounting_api_contract.py`.

### ERD-004 — Accounting lifecycle actor/timestamps exist only in the audit log

- Area: Accounting Core / auditability
- Type: ERD lifecycle-history limitation
- Status: `REVIEW`
- Priority: `P2`
- Governing reference: ERD §16.1 gives FiscalYear only `status`; ERD §17.1 has approval/posting fields but no voided/reversed actor or timestamp fields.
- Current implementation: Fiscal-year closure and journal void/reversal transitions record the actor, timestamp, institution, entity, and before/after status in immutable shared AuditLog events. No ungoverned columns were added to the ERD entities.
- Impact: Clients that need these lifecycle facts must query future audit-history presentation APIs rather than reading dedicated model fields.
- Decision needed: Ratify AuditLog as authoritative or add explicit lifecycle fields in a future ERD revision.
- Evidence: `apps/accounting/services.py` and `apps/audit/models.py`.

### ACC-001 — Period overlap protection is not a database exclusion constraint

- Area: Accounting Core / fiscal periods
- Type: Direct-write integrity limitation
- Status: `SAFEGUARDED`
- Priority: `P2`
- Governing reference: ERD §16 requires only exact date uniqueness and does not state whether overlapping fiscal years or periods are permitted.
- Current implementation: Model validation rejects overlaps, and supported creation services lock the institution/fiscal-year parent row so concurrent application requests serialize. Exact duplicates and date ordering also have database constraints.
- Impact: Unsupported direct SQL or `bulk_create` can bypass model validation and insert a non-identical overlap.
- Decision needed: Confirm that overlaps are forbidden; if direct database ingestion becomes supported, add PostgreSQL exclusion constraints with a documented portability strategy.
- Evidence: `apps/accounting/models.py`, `apps/accounting/services.py`, and `tests/test_accounting.py`.

### ERD-005 — Instantiated accounts cannot retain template mapping identity

- Area: Accounting presets / future integrations
- Type: ERD provenance gap
- Status: `OPEN`
- Priority: `P1`
- Governing reference: ERD §23.4 gives AccountTemplate an optional `system_mapping_code`, while ERD §15.1 gives Account no source-template or system-mapping field.
- Observed limitation: A preset can instantiate account code/name/type/hierarchy/balance/postability, but the resulting Account cannot retain an explicit stable link to its AccountTemplate or mapping code.
- Impact: Future default tax and payroll-account mapping templates may have to resolve instantiated accounts by code unless the ERD adds durable provenance.
- Current safeguard: Preset application snapshots the preset version/template and created/reused account IDs/codes in AuditLog and never silently overwrites a conflicting account.
- Decision needed: Add `source_account_template` and/or `system_mapping_code` to Account, or explicitly ratify code-based mapping as canonical.

### ERD-006 — Preset application and version migration semantics are unspecified

- Area: Accounting presets / onboarding
- Type: ERD workflow gap
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing references: ERD §23 defines versioned templates; Context §§55 and 64–65 require optional preset onboarding and later customization but do not define conflict or migration behavior.
- Current implementation decision: Application is explicit and atomic. Only an active/effective same-country version can be applied. Compatible existing codes may be reused, conflicts abort all writes, and a matching same-version retry is idempotent. Switching an already preset-configured institution to another version fails closed.
- Impact: Automated preset upgrades and chart migrations are unavailable.
- Decision needed: Specify review, diff, account-remapping, rollback, and historical-version rules before enabling preset-version migration.

### GHA-001 — Daily and casual minimum-wage compliance cannot be calculated

- Area: Compensation / Ghana payroll
- Type: Data-model limitation
- Status: `OPEN`
- Priority: `P1`
- Governing reference: Context §45.10 requires the GHS 21.77 daily minimum wage to support compliance checks and daily/casual scenarios.
- Limitation: `EmployeeCompensation` stores `base_salary` but has no pay basis, salary frequency, paid-days quantity, or daily-rate field. A monthly amount therefore cannot be safely compared with a daily minimum.
- Current safeguard: The threshold is versioned and exposed, but the engine does not claim to enforce it.
- Decision needed: Define compensation pay basis/frequency and the authoritative paid-days source before enabling minimum-wage checks.

### GHA-002 — Public overtime eligibility threshold appears stale

- Area: Ghana payroll
- Type: Statutory-source uncertainty
- Status: `SAFEGUARDED`
- Priority: `P1`
- Governing reference: Context §45.6 records the public GRA GHS 18,000 annual-income threshold and explicitly requires legal/accounting validation.
- Limitation: The threshold appears inconsistent with the current PAYE schedule but no newer authoritative public value has been identified.
- Current safeguard: `GH_OVERTIME_TAX.requires_validation` is true. Resident overtime calculation that depends on this threshold fails closed. The separate non-resident 20% special-income treatment is data-driven and does not depend on the disputed junior-staff threshold.
- Decision needed: Obtain written legal/accounting confirmation and release a successor preset version rather than mutating `GH-2026.1` in place.

### GHA-003 — Pension coverage and exemption status are not modelled

- Area: Ghana payroll / pensions
- Type: ERD eligibility gap
- Status: `OPEN`
- Priority: `P1`
- Governing reference: ERD §12.5 defines contribution rates and bases but no employee eligibility, exemption, scheme-membership, or coverage fields.
- Limitation: The current Ghana evaluator applies mandatory pension to every compensated employee, including employees explicitly classified as `CASUAL`.
- Decision needed: Confirm the required legal treatment and add an explicit, auditable pension coverage/exemption model before using exceptional worker scenarios in production.

### PAY-001 — Base salary has no explicit pay-period basis

- Area: Compensation / Payroll
- Type: Data-model ambiguity
- Status: `SAFEGUARDED`
- Priority: `P1`
- Current implementation: `EmployeeCompensation.pay_basis` now explicitly records `PAYROLL_PERIOD` for the supported engine behavior. Existing rows are backfilled to that value by migration; the API exposes it to configuration clients.
- Current safeguard: Payroll calculation fails closed for any unsupported future basis instead of treating annual, daily, or hourly amounts as a configured-period amount.
- Decision needed: Add conversion rules and additional approved basis values before enabling annual, weekly, daily, or hourly compensation in localized production payroll.
- Evidence: `apps/compensation/models.py`, `apps/compensation/serializers.py`, `apps/compensation/migrations/0002_employeecompensation_pay_basis.py`, and `apps/payroll/calculation.py`.

### PAY-002 — Mid-period compensation changes have no proration rule

- Area: Compensation / Payroll
- Type: Calculation limitation
- Status: `SAFEGUARDED`
- Priority: `P1`
- Limitation: The ERD supports effective-dated compensation but does not specify how a salary change inside an active payroll period is prorated.
- Current safeguard: Payroll calculation fails closed when the effective compensation begins after the payroll period start.
- Decision needed: Specify calendar-day, working-day, scheduled-minute, or jurisdiction-specific proration behavior and its rounding rules.

### PAY-003 — Annual relief application timing needs policy confirmation

- Area: Ghana payroll / PAYE reliefs
- Type: Operational tax-policy assumption
- Status: `REVIEW`
- Priority: `P1`
- Limitation: An approved annual relief amount is treated as a year-to-date pool and applied against available chargeable income until exhausted. It is not automatically divided across twelve months or remaining payroll periods.
- Current safeguard: Only eligible, approved, evidence-backed claims are applied, and prior finalized applications are tracked by claim ID.
- Decision needed: Confirm whether Ghana payroll withholding should apply approved relief immediately, prorate it, or follow certificate-effective dates.

### PAY-004 — Percentage and actual-amount reliefs depend on the approved amount

- Area: Ghana payroll / PAYE reliefs
- Type: Calculation limitation
- Status: `OPEN`
- Priority: `P1`
- Limitation: The engine applies `approved_amount` for disability and mortgage-interest claims. It does not independently derive the disability cap from annual qualifying income or reconcile mortgage interest against an external repayment schedule.
- Current safeguard: Evidence and approval are required, and applied relief cannot exceed the approved claim balance or available chargeable income.
- Decision needed: Define authoritative income and mortgage inputs, calculation periods, and reviewer responsibilities before relying on automated validation of these relief types.

## Accepted MVP limitations

### GHA-004 — Ghana preset supports monthly GHS payroll only

- Status: `ACCEPTED_MVP`
- Priority: `P2`
- Behavior: `GH-2026.1` rejects non-GHS and non-monthly configurations rather than converting or approximating statutory values.
- Future work: Add new versioned preset behavior only after other frequencies and currencies have explicit calculation contracts.

### GHA-005 — Compliance is reminder-only

- Status: `ACCEPTED_MVP`
- Priority: `P3`
- Limitation: PAYE and pension due dates produce API projections and notifications, but ErgonX does not file returns, remit funds, or confirm authority acceptance.
- Future work: Direct GRA, SSNIT, NPRA, and trustee integrations belong to the advanced-integration roadmap.

### PAY-005 — Advanced payroll operations are deferred

- Status: `ACCEPTED_MVP`
- Priority: `P2`
- Deferred: correction runs, off-cycle payroll, payment/export workflows, richer statutory validation, preset migration tooling, and guided compliance checks.

### LEAVE-001 — Cross-year leave requests must be split

- Status: `ACCEPTED_MVP`
- Priority: `P2`
- Limitation: A leave request spanning calendar years must be submitted as separate annual requests.

### ATT-001 — Holiday-calendar configuration is not implemented

- Status: `ACCEPTED_MVP`
- Priority: `P2`
- Impact: Scheduling and attendance do not yet have an institution-specific public-holiday calendar.

## Superseded historical entries

The entries below are retained for traceability only. They no longer carry current `Status:` lines; each points to the active limitation or resolved-history item that superseded it.

### PWA-001 - Historical no-frontend limitation superseded

- Superseded: 2026-09-13 by current `PWA-001` and `RES-019`
- Priority: `P2`
- Existing provisions: API-first architecture, CORS configuration, PWA attendance source, JWT authentication, and immutable payroll/payslip records.
- Deferred: installable frontend, service worker, offline synchronization, offline payroll/payslip persistence, and web push.

### OPS-001 - Historical background/import limitation superseded

- Superseded: 2026-09-13 by current `OPS-001` and `RES-020`
- Priority: `P3`
- Limitation: Celery execution, advanced import workflows, and production-grade asynchronous processing are not implemented.

### ROADMAP-001 - Historical pending-domain snapshot superseded

- Superseded: 2026-09-13 by `RES-021`
- Priority: `P2`
- Pending roadmap stages: Ghana Accounting localization, AP/AR/cash/expenses, Payroll-to-Accounting integration, module dashboards, reports/analytics, and Recruitment after critical core workflows are stable.
- Note: Pending roadmap work is recorded here for review context, not classified as an implementation defect.

## Resolved items

### RES-029 - Integrated demo seeding applied recruitment stages only on rerun

- Resolved: 2026-09-24
- Original issue: The integrated demo command submitted newly-created recruitment applications but retained the stale pre-submit object in memory, so target pipeline stages were not applied until a second run; that second run also emitted duplicate stage-moved audit events.
- Resolution: The seed now uses the submitted application returned by the authoritative service before applying its target stage. Progressed leave workflows are preserved and reported rather than reset.
- Validation: `tests/test_integrated_demo_seed.py` runs the command twice and proves stable institution, employee, leave, audit, and notification counts; the current PostgreSQL APEX-DEMO rerun completes while preserving its progressed leave request.
- Evidence: `apps/institutions/management/commands/seed_ergonx_demo.py`, `tests/test_integrated_demo_seed.py`, and the 2026-09-24 seed command output.

### RES-030 - Employee Details had no document action or document list

- Resolved: 2026-09-24
- Original issue: The Employee Details screen rendered an empty Documents panel without a way to upload, inspect, or download employee-associated documents, despite the shared backend document contract already supporting those records.
- Resolution: Employee Details now loads active tenant-scoped documents for the employee, validates supported uploads in the browser, exposes upload progress and errors, lists document metadata, and downloads through the protected operations endpoint.
- Validation: Frontend lint and production build pass; a live browser smoke against the backend returned the scoped document list successfully and rendered the `Documents` section with its `Add Document` action and empty state.
- Evidence: `ergonx-frontend/src/app/hr/employees/[id]/page.tsx`, `ergonx-frontend/src/lib/api/operations.ts`, `apps/documents/views.py`, and the 2026-09-24 Playwright smoke output.

### RES-031 - Financial report filters were only visible for Trial Balance

- Resolved: 2026-09-24
- Original issue: Income Statement and Balance Sheet requests accepted date parameters, but the frontend rendered the date controls only inside the Trial Balance panel, leaving the other report actions effectively unfilterable and displaying amounts without the active institution currency.
- Resolution: Financial Reports now uses one shared filter surface for Trial Balance, Income Statement, and Balance Sheet; the Balance Sheet end date is labelled as its as-of date. Report metrics and trial-balance rows use the institution currency and the canonical currency-symbol formatter, with loading, empty, error, and retry states retained.
- Validation: `npm run lint` and `npm run build` pass after the change; the production build includes `/accounting/reports` and TypeScript validation succeeds. The focused accounting/report regression run passed `17` tests with one explicit PostgreSQL-only skip. A live APEX-DEMO browser smoke switched to Income Statement and Balance Sheet and confirmed the shared filters remained visible with `GH₵`-formatted values.
- Evidence: `ergonx-frontend/src/app/accounting/reports/page.tsx`, `ergonx-frontend/src/lib/format.ts`, and the 2026-09-24 frontend command output.

### RES-032 - Country changes silently overwrote explicit currency choices

- Resolved: 2026-09-24
- Original issue: Institution Settings replaced the saved/default currency whenever the country field changed, which violated the requirement that country-to-currency be a convenience proposal and not a silent override. Onboarding had no visible proposal action.
- Resolution: Settings and onboarding now preserve the current currency while showing the authoritative catalogue suggestion and an explicit `Use suggestion` action. The backend-owned country catalogue remains the source of default mappings.
- Validation: Frontend lint and production build pass after the change; the implementation uses the shared locale catalogue rather than a duplicated country list.
- Evidence: `ergonx-frontend/src/app/settings/institution/page.tsx`, `ergonx-frontend/src/app/onboarding/profile/page.tsx`, `ergonx-frontend/src/lib/api/institutions.ts`, and the 2026-09-24 frontend command output.

### RES-033 - Disabled-module propagation lacked a centralized Leave regression

- Resolved: 2026-09-24
- Original issue: Executive aggregation and endpoint gating had coverage, but no single regression proved that a disabled Leave module was removed consistently from Home actions, Home attention items, Universal Search, and Reports.
- Resolution: Added a tenant-scoped test that disables Leave while preserving a historical leave request, then verifies all four active surfaces are gated without deleting the record.
- Validation: Full SQLite suite passes `148 passed, 6 skipped`; the six skips are explicitly PostgreSQL-only.
- Evidence: `tests/test_access_experience_foundation.py::test_disabled_leave_is_removed_from_home_search_and_reports`, `apps/dashboards/home.py`, `apps/institutions/search.py`, and `apps/reports/views.py`.

### RES-034 - Employee Documents lacked a governed deactivate/replace action

- Resolved: 2026-09-24
- Original issue: Employee Details could upload, list, and download documents but did not expose the shared document layer's safe deactivation capability, leaving replacement/deactivation dependent on an unrelated API client.
- Resolution: Added a protected `deactivateDocument` adapter and Employee Details Deactivate action. The backend's existing tenant-scoped soft-delete behavior marks the document inactive and preserves its historical record; a new upload can be used as the replacement.
- Validation: Frontend lint and production build pass after the change; the Employee Details document list continues to request active records only.
- Evidence: `ergonx-frontend/src/lib/api/operations.ts`, `ergonx-frontend/src/app/hr/employees/[id]/page.tsx`, `Ergonx-backend/common/viewsets.py`, and `Ergonx-backend/apps/institutions/migrations/0019_seed_document_access.py`.

### RES-028 - Universal Search pointer trigger was closed by the global menu handler

- Resolved: 2026-09-24
- Original issue: The visible Search button set the search state, but the document-level outside-click handler immediately closed it before a pointer user could type. Keyboard `Ctrl/Cmd+K` remained functional, masking the integration defect.
- Resolution: The Search trigger now stops propagation and is explicitly treated as an in-scope search surface by the shared TopBar menu boundary. The existing single search API, permission/module filtering, controlled route hints, and debounce behavior remain unchanged.
- Validation: Browser smoke opened Search by pointer and `Ctrl/Cmd+K`, queried `EMP-000109`, displayed employee and leave results, and navigated the employee result to its controlled detail route.
- Evidence: `ergonx-frontend/src/components/layout/TopBar.tsx`, `apps/institutions/search.py`, and the 2026-09-24 Playwright smoke output.

### RES-027 - Settings institution classification values diverged from the backend enum

- Resolved: 2026-09-22
- Original issue: The Settings institution editor offered `COMMERCIAL`, `PUBLIC_SECTOR`, `NONPROFIT`, and `EDUCATIONAL`, while the persisted backend choices are `PRIVATE`, `GOVERNMENT`, `NGO`, and `EDUCATION`. A Settings edit could therefore submit a value rejected by the serializer even though onboarding used the correct choices.
- Resolution: Settings now uses the same server-owned enum values and human labels as onboarding, while preserving an unknown stored legacy value as a visible option instead of silently replacing it.
- Validation: Frontend lint, TypeScript, production build, and a live APEX-DEMO browser pass confirmed the corrected values in read-only and edit states.
- Evidence: `ergonx-frontend/src/app/settings/institution/page.tsx`, `ergonx-frontend/src/app/onboarding/profile/page.tsx`, `Ergonx-backend/apps/institutions/models.py`, and `Ergonx-backend/apps/institutions/serializers.py`.

### RES-026 - ERD-007 institution type could not be retained for onboarding and preset recommendation

- Resolved: 2026-09-21
- Superseded item: `ERD-007`.
- Original issue: The ERD did not retain the Commercial/SME/Public/Nonprofit/Other onboarding answer needed to contextualize an accounting-preset recommendation.
- Resolution: `Institution.institution_type` now persists the governed classification. The authenticated locale catalogue and onboarding profile contract expose the controlled choices independently of country, currency, and timezone. Preset selection remains explicit: this field is context for a recommendation, not permission to silently apply a preset.
- Evidence: `apps/institutions/models.py`, `apps/institutions/migrations/0032_institution_institution_type.py`, `apps/institutions/catalogues.py`, `apps/institutions/serializers.py`, and `ergonx-frontend/src/app/onboarding/profile/page.tsx`.

### RES-025 - Payslip detail API omitted the payroll-period summary required by the frontend

- Resolved: 2026-09-21
- Original issue: The typed frontend payslip detail screen rendered `payslip.payroll_period.name`, but `PayslipSerializer` supplied only the immutable calculation payload. Viewing a payslip therefore raised a browser runtime error instead of rendering its period information.
- Resolution: `PayslipSerializer` now returns the server-owned payroll-period summary from the linked run. The frontend retains an explicit incomplete-response state so a malformed or stale API response cannot crash the route.
- Validation: Focused payroll regression now asserts the summary; a live APEX-DEMO payslip response includes `payroll_period.name`.
- Evidence: `apps/payroll/serializers.py`, `tests/test_payroll.py`, `ergonx-frontend/src/app/payroll/payslips/[id]/page.tsx`, and `docs/integration/payroll_frontend_contract.md`.

### RES-023 - Tracked local environment example exposed non-placeholder credentials

- Resolved: 2026-09-19
- Original issue: The repository-root `.env.example` contained a database password, pgAdmin password, and personal pgAdmin email.
- Resolution: Replaced committed values with non-sensitive placeholders. Local credentials remain untracked and must be supplied through `.env` or `.env.production`.
- Evidence: repository-root `.env.example` and `.gitignore`.

### RES-024 - Post-sync frontend lockfile and invitation tests were not reproducible

- Resolved: 2026-09-19
- Original issue: `ergonx-frontend` could not run `npm ci` because its lockfile omitted required `@emnapi` package entries. The invitation tests also recreated the bootstrap-provided Employee role and omitted the required invitation issuer.
- Resolution: Regenerated the frontend lockfile from the declared dependency graph and corrected invitation fixtures to use the seeded role and an active HR-admin issuer. The full frontend lint/build path and invitation coverage now execute from a clean install.
- Validation: `npm ci`, `npm run lint`, `npm run build`, and focused backend invitation/lifecycle tests.
- Evidence: `ergonx-frontend/package-lock.json` and `apps/accounts/tests.py`.

### RES-022 - ACCESS-001 invitation and rehire lifecycle gap was superseded

- Resolved: 2026-09-19
- Superseded item: `ACCESS-001`.
- Original issue: Institution invitation acceptance and a service-backed rehire flow were absent from the access/onboarding lifecycle foundation.
- Resolution: Expiring invitation acceptance, role/membership activation, HR-prepared employee linking, new employee-profile creation, and rehire actions now exist. Employee-to-user linkage was changed from globally one-to-one to institution-compatible foreign-key profiles, preserving a single login across institutions while retaining tenant ownership validation.
- Evidence: `apps/accounts/views.py`, `apps/employees/services.py`, `apps/employees/views.py`, `apps/employees/migrations/0006_allow_multi_institution_employee_profiles.py`, and `apps/accounts/tests.py`.

### RES-021 - Historical ROADMAP-001 pending-domain snapshot was superseded

- Resolved: 2026-09-13
- Superseded item: `ROADMAP-001`
- Original historical note: Ghana Accounting localization, AP/AR/cash/expenses, Payroll-to-Accounting integration, module dashboards, reports/analytics, and Recruitment were recorded as pending roadmap stages and were not classified as implementation defects.
- Current state: Ghana Accounting localization, AP/AR/cash/expenses, Payroll-to-Accounting integration, module dashboards, reports/analytics, and shared platform hardening have since been implemented with documented limitations. Recruitment and final QA/demo remain the current roadmap stages.
- Evidence: Current module completion gate above; `apps/accounting`, `apps/dashboards`, `apps/reports`, `apps/operations`, `docs/integration/frontend_platform_contract.md`, and PostgreSQL full suite result recorded in the latest development handoff.

### RES-020 - Historical OPS-001 background/import limitation was superseded

- Resolved: 2026-09-13
- Superseded item: `OPS-001`
- Original historical note: Celery execution, advanced import workflows, and production-grade asynchronous processing were not implemented.
- Current state: Shared tenant-safe `BackgroundJob`, `ImportJob`, `ImportRowResult`, and `ExportJob` APIs now exist; a management-command worker processes notification delivery and the registered `EMPLOYEE` import handler. The current `OPS-001` entry remains active for type-specific import/export handlers and production-grade execution decisions.
- Evidence: `apps/operations/models.py`, `apps/operations/services.py`, `apps/operations/views.py`, `apps/operations/management/commands/run_background_jobs.py`, `tests/test_operations_platform.py`, and `docs/integration/frontend_platform_contract.md`.

### RES-019 - Historical PWA-001 no-frontend limitation was superseded

- Resolved: 2026-09-13
- Superseded: 2026-09-20 by the reopened current `PWA-001` checkout audit.
- Superseded item: `PWA-001`
- Original historical note: Backend provisions existed, but installable frontend, service worker, offline synchronization, offline payroll/payslip persistence, and web push were deferred.
- Historical resolution record: A prior review reported that an installable Next.js frontend, manifest, service worker, offline fallback, and app-shell cache existed.
- Current status: That claimed asset set is absent from the current `ergonx-frontend/` checkout. `PWA-001` is the sole current implementation status and is `ACCEPTED_MVP`; this item is retained only as historical evidence of the prior report.
- Evidence: `ergonx-frontend/public/` current file inventory and `docs/ai_context/ERGONX_UI_AND_FRONTEND_BACKEND_CONTEXT.md`.

### RES-018 - Ghana localization sequencing note was superseded by delivered dependent workflows

- Resolved: 2026-09-13
- Superseded item: `ROADMAP-003`
- Original issue: The roadmap named vendor/customer tax profiles, VAT withholding, accounting compliance reminders, and payroll-to-GL mappings before their dependent AP/AR/cash/payroll-accounting workflows existed.
- Resolution: The dependent workflows now exist with explicit guarded extensions: vendor/customer statutory profile fields, VAT withholding certificate issue/void lifecycle, Ghana compliance reminders, and payroll-to-accounting mapping templates and institution mappings.
- Remaining decisions: `GHA-ACC-001`, `PAY-ACC-001`, `ERD-008`, and `ERD-009` remain the current ERD/legal review items for exact entity ratification, source fields, and filing/remittance boundaries.
- Evidence: `apps/accounting/models.py`, `apps/accounting/migrations/0009_payroll_account_mappings.py`, `apps/accounting/migrations/0013_vat_withholding_certificate.py`, `apps/accounting/migrations/0014_ghana_compliance_reminders.py`, `tests/test_accounts_payable.py`, and `docs/integration/ghana_accounting_localization_frontend_contract.md`.

### RES-017 - Accounting roadmap sequencing note was superseded by delivered stages

- Resolved: 2026-09-13
- Superseded item: `ROADMAP-002`
- Original issue: Product Roadmap section 3 grouped AP, AR, cash/bank, and expenses under Core Accounting, while Consolidated ERD v1.1 section 32 ordered the accounting kernel, presets, Ghana localization, then AP/AR/cash/expenses.
- Resolution: Implementation followed the ERD dependency order and then delivered AP, AR, cash/bank, settlement, bank reconciliation, and expenses as later stages. The earlier sequencing ambiguity is no longer an active implementation blocker.
- Evidence: Current module completion gate above; `apps/accounting/models.py`, `apps/accounting/services.py`, `docs/integration/accounts_payable_frontend_contract.md`, `docs/integration/accounts_receivable_frontend_contract.md`, `docs/integration/cash_bank_frontend_contract.md`, `docs/integration/expenses_frontend_contract.md`, and `tests/test_accounts_payable.py`.

### RES-016 — PostgreSQL rejected a journal row lock joined to nullable reversal data

- Resolved: 2026-09-12
- Discovery context: Final Accounting Core PostgreSQL 16 gate.
- Original issue: `post_journal` combined `select_for_update()` with `select_related("reversal_of")`. PostgreSQL correctly rejected `FOR UPDATE` on the nullable side of that outer join; SQLite ignored the locking clause and masked the defect.
- Resolution: The transaction now locks only the JournalEntry base row, then locks its AccountingPeriod separately under the shared close/post boundary. Related reversal data is loaded without broadening the row lock.
- Validation: Focused PostgreSQL Accounting suite: 15 passed. Full PostgreSQL 16 suite: 95 passed in 237.43s. SQLite: 91 passed/4 expected PostgreSQL-only skips.
- Evidence: `apps/accounting/services.py` and `tests/test_accounting.py`.

### RES-015 — Journal posting and period closing did not share a lock boundary

- Resolved: 2026-09-12
- Discovery context: Accounting Core concurrency-contract reconciliation.
- Original issue: Posting locked the JournalEntry while period close/lock locked the AccountingPeriod, leaving a race in which both operations could validate stale state.
- Resolution: Journal create/update/post now locks the target AccountingPeriod before validating openness. Period transitions and fiscal-year closure share a FiscalYear-then-AccountingPeriod lock order, and reopening an AccountingPeriod under a closed FiscalYear fails closed.
- Migration impact: None.
- Evidence: `apps/accounting/services.py`, `apps/accounting/models.py`, and `tests/test_accounting.py`.

### RES-014 — Reversal validation preceded tenant-scoped journal resolution

- Resolved: 2026-09-12
- Discovery context: Accounting Core full API tenant-isolation matrix.
- Original issue: The reverse action validated its payload before `get_object()`, so a request targeting a foreign/nonexistent journal could return payload validation 400 instead of tenant-hiding 404.
- Resolution: The action now resolves the tenant-scoped source journal before parsing reversal input. The matrix pins all foreign detail/actions to `not_found`.
- Migration impact: None.
- Evidence: `apps/accounting/views.py` and `tests/test_accounting_api_contract.py`.

### RES-013 — Accounting module and permissions were absent from tenant bootstrap

- Resolved: 2026-09-12
- Discovery context: ERD reconciliation before Accounting Core implementation.
- Original issue: ACCOUNTING existed as a module-code enum but new/existing institutions had no Accounting module row, permission catalog, or finance-role assignments.
- Resolution: Bootstrap now creates ACCOUNTING disabled by default and seeds least-privilege Accounting permissions. An additive migration backfills existing institutions and roles.
- Evidence: `apps/institutions/services.py`, `apps/institutions/migrations/0008_seed_accounting_access.py`, and `tests/test_accounting.py`.

### RES-012 — Payroll workflow audit and notification transitions were incomplete

- Resolved: 2026-09-12
- Resolved item: `CONTRACT-008`
- Original issue: Adjustment and relief-claim submission lacked dedicated audit events; run approval did not notify finalizers; relief decisions did not notify claimants; workflow audit metadata lacked consistent before/after state and HTTP request context.
- Resolution: Added submission events, adjustment application/reversal events, before/after status metadata across run/adjustment/relief transitions, finalizer notifications after run approval, relief-review notifications after submission, and claimant notifications after approval/rejection. A context-local middleware now supplies service-layer audit writes with the request's direct remote IP and user agent when available.
- Retry behavior: Repeated matching submit, run-approval, adjustment-decision, and relief-decision calls return the current resource without duplicating audit events or notifications. Opposite or incompatible decisions continue to fail as invalid transitions.
- Migration impact: None; existing audit and notification models already contain the required fields.
- Validation: Dedicated workflow integration suite: 3 passed. Deterministic demo reruns retain stable counts with 18 audit events and 9 notifications. Final SQLite suite: 77 passed/3 PostgreSQL-only skipped. PostgreSQL 16: 80 passed in 95.91s.
- Evidence: `apps/audit/context.py`, `apps/audit/middleware.py`, `apps/audit/services.py`, `apps/payroll/services.py`, `tests/test_payroll_workflow_integration.py`, `tests/test_payroll.py`, and `tests/test_payroll_demo_seed.py`.

### RES-011 — Ghana setup/profile/deadline API contract coverage was incomplete

- Resolved: 2026-09-12
- Resolved item: `CONTRACT-007`
- Original issue: Ghana setup choices, payroll configuration, employee payroll profiles, and calculated compliance deadlines lacked the Module Delivery Contract's complete API matrix.
- Resolution: Added rendered-response tests across all eight exposed operations for authentication, PAYROLL-module gating, operation permissions, tenant-scoped object hiding and relation rejection, success/error envelopes, employee/residency filters, search, pagination, setup choices, exact deadline projections, create/PATCH validation, and stable error codes.
- Validation: Focused Ghana API contract suite: 7 passed. Final SQLite suite: 74 passed/3 PostgreSQL-only skipped. PostgreSQL 16: 77 passed in 97.38s.
- Evidence: `tests/test_ghana_payroll_api_contract.py`, `docs/integration/ghana_payroll_frontend_contract.md`, and `openapi-schema.yml`.

### RES-010 — Payroll configuration did not enforce selected preset constraints

- Resolved: 2026-09-12
- Discovery context: `CONTRACT-007` runtime-to-frontend reconciliation.
- Original issue: `GH-2026.1` metadata declared `GHS` and `MONTHLY`, and its evaluator failed closed for other values, but `configure_payroll` did not enforce those preset constraints. Its create path also bypassed `InstitutionPayrollConfiguration.full_clean()`, allowing a country-mismatched preset to be persisted even though the model declared that invalid.
- Resolution: The service now normalizes country/currency, generically enforces any selected preset's metadata-declared currency and payroll frequency, validates the complete proposed model before both insert and update, and persists only after validation succeeds. Rejected PATCH requests leave stored configuration unchanged.
- Migration impact: None. The constraints already existed in versioned `source_metadata`; no schema or seed-history mutation was required.
- Validation: API tests reject non-GHS currency, non-monthly frequency, country-mismatched presets, and unsupported rounding with `validation_error` plus field errors, and prove failed updates are non-mutating.
- Evidence: `apps/payroll/services.py`, `apps/payroll/migrations/0003_seed_ghana_payroll_2026.py`, and `tests/test_ghana_payroll_api_contract.py`.

### RES-009 — Payroll OpenAPI lacked delivery-level operation detail

- Resolved: 2026-09-12
- Resolved item: `CONTRACT-006`
- Original issue: Payroll paths existed in OpenAPI, but operations lacked summaries and useful descriptions, access expectations were implicit, workflow POST actions advertised incorrect full-model request bodies, and the compliance-deadline action inherited irrelevant filters and pagination.
- Resolution: Added an access-aware schema class that provides summaries, purpose, tenant/module/permission requirements, documented error codes, and `x-error-codes`. Added explicit Payroll action descriptions, request/response overrides, and selected setup/run/reconciliation examples. No-body transitions now have no request body; relief approval uses `TaxReliefDecision`; compliance deadlines expose only the path ID and an unpaginated array.
- Validation: All 60 current Payroll-related operations have non-empty summaries, descriptions, and error-code metadata. The generated schema validates, and automated tests pin representative permission text, examples, action bodies, parameters, response shapes, and errors. Final SQLite suite: 67 passed/3 PostgreSQL-only skipped. PostgreSQL 16: 70 passed.
- Evidence: `common/schema.py`, `config/settings/base.py`, `apps/payroll/views.py`, `tests/test_payroll.py`, and `openapi-schema.yml`.

### RES-008 — Employee payroll-profile permission declaration was not enforced

- Resolved: 2026-09-12
- Original issue: `EmployeePayrollProfileViewSet` declared `required_permission = "payroll.configure"`, but `TenantModelViewSet.get_required_permission()` ignored that declaration. Any active tenant member could therefore list or attempt to create payroll profiles while PAYROLL was enabled, contrary to the published frontend contract.
- Resolution: The shared tenant viewset now honors an explicit `required_permission` before deriving resource/action permissions.
- Validation: Employee-role API tests verify both profile listing and creation return HTTP 403 with `permission_denied`; HR-admin profile setup remains green on SQLite and PostgreSQL.
- Evidence: `common/viewsets.py`, `apps/payroll/views.py`, and `tests/test_ghana_payroll.py`.

### RES-007 — Machine-readable API error codes were incomplete

- Resolved: 2026-09-12
- Resolved item: `CONTRACT-005`
- Original issue: Runtime failures used the standard envelope, but permission, module-disabled, tenant-selection, workflow-state, immutable-record, closed-period, and duplicate-operation responses lacked a consistent machine-readable code.
- Resolution: The shared exception handler now adds a required top-level `code` while preserving the existing `success`, `data`, `message`, and field-level `errors` values. Permission classes emit explicit tenant/module codes, coded domain validation preserves business codes through the serializer boundary, and Payroll transitions use the governed codes.
- Published codes: `authentication_required`, `authentication_failed`, `permission_denied`, `module_disabled`, `tenant_mismatch`, `invalid_state_transition`, `record_immutable`, `period_closed`, `duplicate_operation`, `insufficient_leave_balance`, `policy_not_applicable`, `unbalanced_journal`, `validation_error`, `invalid_request`, `not_found`, `method_not_allowed`, `unsupported_media_type`, `throttled`, and `api_error`.
- Compatibility: This is additive. Existing HTTP statuses, human-readable messages, and `errors` field mappings remain available to current clients.
- Validation: OpenAPI regenerated and validated. Final SQLite suite: 65 passed/3 PostgreSQL-only skipped. PostgreSQL 16: 68 passed.
- Evidence: `common/exceptions.py`, `common/permissions.py`, `common/serializers.py`, `common/schema.py`, `apps/payroll/services.py`, `tests/test_foundation.py`, `tests/test_payroll.py`, and `openapi-schema.yml`.

### RES-006 — Payroll had no explicit selector/query boundary

- Resolved: 2026-09-12
- Original issue: Complex reusable payroll, effective-rule, reconciliation, and year-to-date reads were embedded in services, the generic calculator, and the Ghana evaluator, making tenant-scope and query-shape review harder.
- Resolution: Added `apps/payroll/selectors.py` with institution-aware selectors for active country presets, eligible employees, approved reliefs, finalized YTD records/items, effective special-income/contribution/deadline rules, and reconciliation records with prefetched items. Services and Ghana calculations now consume this boundary; simple single-use reads remain local.
- Tenant safeguard: Every selector receiving a tenant-owned record validates that it belongs to the supplied institution before querying. Selector tests exercise explicit cross-tenant rejection and country/effective-date scope.
- Validation: Focused Payroll tests: 17 passed. Final SQLite suite: 63 passed/3 PostgreSQL-only skipped. PostgreSQL 16: 66 passed.
- Evidence: `apps/payroll/selectors.py`, `tests/test_payroll_selectors.py`, `apps/payroll/services.py`, `apps/payroll/calculation.py`, and `apps/payroll/localizations/ghana.py`.

### RES-005 — Deterministic operational Payroll demo data was missing

- Resolved: 2026-09-11
- Original issue: System permissions and Ghana statutory configuration were seeded, but there was no repeatable operational dataset for frontend demonstrations.
- Resolution: Added development-only `seed_payroll_demo`. It creates a stable Ghana tenant, three users, two employees, organization/employment, compensation, explicit resident/non-resident profiles, a bonus, an approved relief and adjustment, a finalized run, two payslips, and compliance reminders through domain services.
- Safety: The command refuses to run when `DEBUG=False`, uses a reserved demo namespace, and refuses to rewrite drifted effective-dated compensation.
- Validation: Two-run tests verify persisted login passwords and unchanged business-record, audit-event, and notification counts. Final results: SQLite 61 passed/3 PostgreSQL-only skipped; PostgreSQL 16 64 passed.
- Evidence: `apps/payroll/management/commands/seed_payroll_demo.py` and `tests/test_payroll_demo_seed.py`.

### RES-004 — Formal Payroll completion reports were missing

- Resolved: 2026-09-11
- Original issue: Generic Payroll and Ghana Payroll had conversational handoffs but no durable completion reports following all 15 headings mandated by Module Delivery Contract §26.
- Resolution: Added separate reports with explicit models, migrations, services, selectors, permissions, endpoints, filters, OpenAPI, audits, notifications, tests, PostgreSQL results, integration-note paths, seed/demo support, remaining issues, and partial-completion decisions.
- Validation: Both reports were mechanically checked for all 15 numbered sections and the required `PARTIALLY COMPLETE` status.
- Evidence: `docs/completion/payroll_module_completion_report.md` and `docs/completion/ghana_payroll_module_completion_report.md`.

### RES-003 — Required Payroll frontend integration notes were missing

- Resolved: 2026-09-11
- Original issue: Generic Payroll and Ghana Payroll had no durable frontend contracts in the format mandated by Module Delivery Contract §25.
- Resolution: Added separate integration notes covering base URL, module flag, permissions, all endpoint families/actions, filters, request and response examples, published enums, workflow transitions, frontend behavior, errors, and known limitations.
- Validation: 33 documented route families/actions were matched against `openapi-schema.yml`.
- Evidence: `docs/integration/payroll_frontend_contract.md` and `docs/integration/ghana_payroll_frontend_contract.md`.

### RES-001 — Non-resident special-income rate was embedded in evaluator code

- Resolved: 2026-09-11
- Original issue: The Ghana evaluator initially contained a literal 20% non-resident bonus/overtime rate even though the rate existed in versioned `SpecialIncomeRule.calculation_json`.
- Resolution: The evaluator now loads each non-resident special-income rate from the selected preset version and fails closed if the value is absent or invalid.
- Evidence: `apps/payroll/localizations/ghana.py` and `test_ghana_non_resident_bonus_rate_is_loaded_from_versioned_rule_data`.

### RES-002 — Custom payroll onboarding did not expose its compliance warning

- Resolved: 2026-09-11
- Original issue: Custom mode correctly avoided Ghana defaults, but the setup-choice response did not communicate the institution's compliance responsibility.
- Resolution: The Custom choice now includes an explicit `compliance_warning` in the API and OpenAPI schema.
- Evidence: `apps/payroll/services.py`, `apps/payroll/serializers.py`, and `openapi-schema.yml`.

## Current release-candidate reconciliation notes (2026-09-23)

- `UI-001` — **RESOLVED**: Payslip detail now guards missing payroll-period relations and renders the active institution name. Evidence: `ergonx-frontend/src/app/payroll/payslips/[id]/page.tsx`.
- `UI-002` — **RESOLVED**: Audit history is rendered as a structured table with actor, action, object, timestamp, IP address, and expandable metadata rather than raw JSON-only records. Evidence: `ergonx-frontend/src/app/settings/audit/page.tsx`, `apps/audit/serializers.py`.
- `UI-003` — **RESOLVED**: Optional TOTP MFA setup/confirmation/disable and login challenge flow are implemented; password-strength guidance is shown at login and password change. Evidence: `apps/accounts/models.py`, migration `apps/accounts/migrations/0003_usermfa.py`, and the security/login screens.
- `UI-004` — **RESOLVED**: Module-aware dashboards, collapsible module navigation, notification route hints, dark/light theme, responsive report cards, and global top-right status toasts are implemented. Evidence: frontend dashboard, navigation, `ToastProvider`, and theme files.
- `UI-005` — **OPEN / ACCEPTED_MVP**: Employment type remains a governed backend enum (`PERMANENT`, `CONTRACT`, `TEMPORARY`, `INTERN`, `CASUAL`) rather than an institution-defined catalogue. This is safe and validated by serializers and leave eligibility, but custom institution-defined types require an ERD/product decision and a future migration.
- `DASH-003` — **RESOLVED (2026-09-24)**: Finance and executive dashboards now share posted-ledger monthly rollups, carry institution currency, and use distinct detailed versus summarized visualizations. Evidence: `apps/dashboards/views.py`, the dashboard seed command, and the two dashboard pages.
- `ATT-001` — **RESOLVED (2026-09-24)**: Attendance reporting now includes tenant-scoped employee identity, employee number, department, late-occurrence totals, minutes late, a 90-day lateness trend, and department rollups. The UI uses neutral “Repeated Lateness” language and remains behind attendance/report permissions. Evidence: `apps/dashboards/views.py`, `src/app/attendance/dashboard/page.tsx`, and `src/types/dashboards.ts`.
- `ACCESS-001` — **RESOLVED (2026-09-24)**: HR administration could previously mutate the signed-in user's own Employee record through generic update, delete, lifecycle, or employment endpoints. The backend now rejects those mutations with `self_hr_record_edit_not_allowed`; self-service profile, preferences, security, and emergency-contact routes remain available. Evidence: `apps/employees/services.py`, `apps/employees/views.py`, and `tests/test_access_experience_foundation.py`.
- `DASH-002` — **RESOLVED (2026-09-24)**: The executive dashboard endpoint calculated optional-module metrics regardless of the institution's enabled modules, creating a backend data-leakage risk even when the frontend hid those cards. The endpoint now omits Leave, Attendance, Payroll, Accounting, and Recruitment rollups unless the corresponding module is enabled; the frontend treats those fields as optional. Evidence: `apps/dashboards/views.py`, `src/app/dashboard/page.tsx`, and `src/types/dashboards.ts`.
- `SETTINGS-001` — **RESOLVED (2026-09-24)**: Users & Access was duplicated as a Settings card while also being an administration route. It is now standalone in navigation at `/settings/users`; the Settings landing page no longer advertises it. Evidence: `src/app/settings/page.tsx` and `src/components/navigation/navigation.ts`.
- `UI-006` — **RESOLVED (2026-09-24)**: The top-right profile popover could be closed by the document-level click handler before its menu actions were usable. The popover now has explicit menu semantics, a stable stacking layer, deterministic close-before-navigation behavior, and a guarded Sign out action that clears auth state and routes to `/login`; interaction remains protected from the document-level close handler. Evidence (2026-09-24): `ergonx-frontend/src/components/layout/TopBar.tsx`, frontend lint, and production build.
- `DOCS-001` — **SAFEGUARDED / ACCEPTED_MVP**: Tenant-scoped multipart document upload now supports PDF/JPEG/PNG files up to 10 MB with MIME/signature validation, managed storage, protected download, leave-request upload progress/removal, and Employee Details upload/list/download actions. Production object-storage offload, malware scanning, and resumable uploads remain deployment decisions. Evidence: `apps/documents/models.py`, `apps/documents/serializers.py`, `apps/documents/views.py`, `ergonx-frontend/src/app/hr/employees/[id]/page.tsx`, `ergonx-frontend/src/lib/api/operations.ts`, `src/app/me/leave/request/page.tsx`, and migration `apps/documents/migrations/0002_document_stored_file_alter_document_file_reference.py`.
- `MFA-001` — **SAFEGUARDED / ACCEPTED_MVP**: TOTP enrollment, QR rendering, and challenge remain implemented. Optional email OTP is now implemented with a dedicated hashed challenge model, five-minute expiry, one-time consumption, five-attempt limit, resend invalidation, Security settings selection, login challenge handling, and audit events for meaningful MFA changes. Production email delivery remains a deployment prerequisite and is rejected when `EMAIL_DELIVERY_ENABLED` is false. Evidence (2026-09-24): `apps/accounts/models.py`, migration `apps/accounts/migrations/0004_usermfa_method_emailotpchallenge.py`, `apps/accounts/serializers.py`, `apps/accounts/views.py`, `apps/accounts/emails.py`, `src/app/settings/security/page.tsx`, and `src/app/login/page.tsx`.
- `IMG-001` — **SAFEGUARDED / ACCEPTED_MVP**: Private tenant-scoped binary image upload and protected delivery are now exposed for USER, EMPLOYEE, and INSTITUTION owners, with JPEG/PNG/GIF signature and 5 MB validation, active-owner replacement, permission checks, and profile/institution UI previews. Production image processing, object storage, malware scanning, and persisted current-image references for USER/EMPLOYEE owners remain follow-up hardening. Update (2026-09-25): the current institution logo is exposed as `active_institution.logo_image_id` on `/auth/bootstrap/`, any member may view (retrieve/content) the active institution's logo while only `settings.institution.manage` may replace or remove it, and the frontend renders it in the sidebar header and official documents. Evidence (2026-09-24): `apps/documents/models.py`, `apps/documents/serializers.py`, `apps/documents/views.py`, migration `apps/documents/migrations/0003_imageasset.py`, `src/lib/api/images.ts`, `src/app/me/profile/page.tsx`, and `src/app/settings/institution/page.tsx`; (2026-09-25): `apps/accounts/views.py`, `apps/documents/views.py`, `tests/test_institution_logo.py`, `src/components/brand/SidebarLogo.tsx`, `src/components/brand/DocumentFrame.tsx`.
- `UI-007` — **RESOLVED (2026-09-24)**: Several recruitment create flows and Payroll Configuration lacked the shared back-navigation pattern required for detail/create/configuration subpages. They now use `BackNavigation` with logical parent fallbacks while retaining history-based navigation for same-origin in-app entry; Settings subpages were verified to inherit the control from the shared Settings layout. Evidence (2026-09-24): `ergonx-frontend/src/app/recruitment/*/new/page.tsx`, `ergonx-frontend/src/app/payroll/configuration/page.tsx`, `ergonx-frontend/src/app/settings/layout.tsx`, `ergonx-frontend/src/components/ui/BackNavigation.tsx`, frontend lint, and production build.

## Review template for new entries

```text
### ID — Short title

- Area:
- Type:
- Status: OPEN | SAFEGUARDED | REVIEW | ACCEPTED_MVP | RESOLVED
- Priority: P0 | P1 | P2 | P3
- Governing reference:
- Observed behavior or limitation:
- Impact:
- Current safeguard or workaround:
- Decision or work needed:
- Evidence:
```
