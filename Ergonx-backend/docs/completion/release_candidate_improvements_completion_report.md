# ErgonX Priority Release-Candidate Improvements — Completion Report

Status: PARTIALLY COMPLETE WITH DOCUMENTED LIMITATIONS — 2026-09-24

## 1. Initial audit findings

The audit found a working BFF/HttpOnly session boundary, tenant-scoped APIs, module-aware navigation, TOTP MFA, audit APIs, financial report actions, and persisted HR lifecycle services. Gaps included backend executive payload leakage for disabled modules, missing self-HR denial coverage, no true leave-document upload path, limited attendance analytics, report cards that ignored module state, and a profile popover click-interception defect.

## 2. Existing capabilities reused

The increment reused `TenantModelViewSet`, `TenantRBACPermission`, the existing Document model, BFF multipart pass-through, typed API adapters, PageHeader, shared formatting, current module bootstrap state, audit services, and existing leave policy validation.

## 3. Backend changes

Added self-HR mutation protection, executive module gating, attendance lateness rollups, report module gates, managed document/image upload validation, and protected document/image download.

## 4. Frontend changes

Fixed the profile popover event boundary, added report module filtering, leave supporting-document upload/progress/removal, profile/institution image upload/progress/preview, QR rendering for TOTP, repeated-lateness table, Ctrl/Cmd+K search focus, centralized light/dark ErgonX scrollbar styling with hover states, and shared back navigation on applicable recruitment create flows and Payroll Configuration. These flows use logical parent fallbacks while preserving history-based navigation for same-origin in-app entry.

## 5. Migrations created

`apps/institutions/migrations/0034_institution_executive_title.py`, `apps/documents/migrations/0002_document_stored_file_alter_document_file_reference.py`, `apps/documents/migrations/0003_imageasset.py`, and `apps/accounts/migrations/0004_usermfa_method_emailotpchallenge.py` are present. `makemigrations --check --dry-run` reports no drift.

## 6. Self-edit protection result

HR administrative updates, deletes, lifecycle transitions, and employment mutations targeting the authenticated user’s own Employee record now return `self_hr_record_edit_not_allowed`. A regression test is present.

## 7. HR navigation restructuring

HR is a collapsible domain with dashboard, Employees/Core HR, Recruitment, Leave, Attendance, and Payroll children. Child visibility remains permission/module driven; Accounting remains separate.

## 8. Privacy/encryption changes

Password hashing and HttpOnly sessions remain intact; business fields were not hashed. API CSP and secret boundaries remain active. Field-level encryption for retrievable tax/bank/private fields remains an approved design item, not an invented migration.

## 9. Backup/restore implementation

`docs/operations/database_backup_restore.md` documents encrypted scheduled `pg_dump`, retention, off-primary storage, restore verification, and recovery assumptions. It makes no HA/PITR or zero-loss claim.

## 10. Executive view implementation

The configurable `executive_title` is persisted and rendered in the executive dashboard. Access remains `dashboard.executive.view`; financial, workforce, recruitment, attendance, leave, and payroll sections are module-aware.

## 11. Audit module migration

`/audit` is canonical, read-only, filterable, and permission-gated by `audit.view`. The legacy Settings route remains for compatibility but is no longer advertised in Settings navigation. Audit history is not removed when business modules are disabled.

## 12. Profile/institution image support

Private tenant-scoped image upload and protected content delivery are implemented for USER, EMPLOYEE, and INSTITUTION owners. JPEG/PNG/GIF signature checks, a 5 MB limit, active-owner replacement, and permission checks are covered in `apps/documents/`. The profile and institution settings screens provide upload/progress/preview controls. Production object storage, malware scanning, image transformations, and persisted current-image references remain follow-up hardening.

## 13. Leave supporting-document implementation

Leave requests now expose a required/optional supporting-document control. PDF/JPEG/PNG uploads are validated client and server side, uploaded through the BFF with progress, removable before submission, and attached by ID. Leave detail/approval views resolve the linked document and provide a protected download action. Existing backend policy/type enforcement remains authoritative.

## 14. Currency/localization fixes

Money formatting remains centralized through locale-aware `Intl.NumberFormat` helpers and active institution currency. Dashboard, accounting, payroll, payslip, and report surfaces use the shared formatter.

## 15. MFA status by method

Authenticator-app TOTP is implemented with provisioning URI, QR rendering, confirmation, challenge, and disable flow. Email OTP is implemented as an optional second method with hashed five-minute challenges, one-time consumption, five-attempt limits, resend invalidation, email-delivery gating, login UI, Security settings controls, and audit events for MFA setup/enable/method-change/disable actions. It still requires a configured production email provider before it can be enabled operationally.

## 16. Disabled-module propagation results

Navigation, home actions, executive aggregation, report cards/endpoints, and universal search providers respect enabled modules. A centralized regression now proves that disabling Leave removes its Home actions/attention items, Search results, and report endpoint access while preserving historical records.

## 17. Attendance report changes

Attendance dashboard responses now include employee identity, number, department, 90-day repeated-lateness ranking, monthly trend, department rollups, occurrence counts, and total minutes late. The UI uses neutral “Repeated Lateness” language.

## 18. Leave Type management

Leave Type and policy screens remain permission-driven (`leave.configure`), support create/edit/activate/deactivate, and do not delete referenced history.

## 19. Country/currency/timezone catalogue status

Institution and onboarding forms consume the backend-owned country, ISO-compatible currency, and IANA timezone catalogues. Country selection now exposes an explicit default-currency suggestion in both forms without overwriting an explicit choice; the administrator must choose `Use suggestion`.

## 20. Financial statement action fixes

Trial balance, income statement, and balance sheet actions navigate/load real report views. A shared report-filter surface now remains visible for all three views (with the Balance Sheet end-date/as-of semantics), and all views show loading, empty/error states and the active institution currency through the canonical money formatter. CSV export remains available where supported by the report contract. A live browser smoke on APEX-DEMO verified the filters remained visible while switching to Income Statement and Balance Sheet, and displayed `GH₵`-formatted values.

## 21. Dashboard visualization changes

Accounting uses detailed P&L and cash movement visualizations; Executive uses compact KPIs and a summarized financial chart. Payroll, attendance, recruitment, and leave retain analytical chart/table combinations appropriate to their questions.

## 22. Emergency contact/lifecycle persistence

Emergency contacts and onboarding/offboarding/lifecycle transitions use tenant-scoped backend APIs, permission checks, audit/service validation, and reload-safe frontend reads.

## 23. Employee document upload

Shared document records support managed multipart uploads with MIME/signature/size validation and protected download. The Employee Details page exposes Add Document, active-document listing, upload progress/errors, protected downloads, and governed Deactivate actions that preserve document history. Uploading a replacement and deactivating the prior file is supported through the shared operations API. A live browser smoke confirmed the section and empty state render against the backend. Employee/profile/institution image semantics are provided by the separate private `ImageAsset` endpoint; production storage and scanning remain explicitly open.

## 24. Users & Access module changes

Users & Access remains fully available at `/settings/users` and is permission driven, but is removed from the Settings landing-page cards as required.

## 25. Greeting/timezone fix

Home greeting calculation uses the active institution IANA timezone in the backend. The defined morning, afternoon, evening, and overnight boundaries are applied before the payload reaches the client.

## 26. Universal Search fix

The existing global search path remains the single implementation. It debounces queries, uses the active institution BFF context, filters by permission/module, preserves controlled route hints, supports payroll `PR-...` and leave `LR-...` references in addition to existing employee/accounting references, and supports both the visible Search button and Ctrl/Cmd+K focus with Escape close. The trigger/document click boundary was hardened so the popover remains open for normal pointer use.

## 27. Demo-seed changes

Accounting demo data was expanded deterministically for monthly financial charts and bank movement. Existing payroll, access, notification, audit, lifecycle, leave, and organization seeds remain idempotent. The integrated seed now applies recruitment target stages on the first run, preserves progressed workflow records on rerun, and is covered by a two-run regression. On the current already-used APEX-DEMO database it reports `LR-2026-00044` as progressed (`PENDING` rather than the fixture’s original `DRAFT`) while preserving history instead of resetting it. Binary files/secrets are not stored in fixtures.

## 28. PostgreSQL results

PostgreSQL 16 compatibility checks and migration drift checks pass. An isolated test-database provisioning helper and runbook were added at `scripts/provision_test_database.py` and `docs/operations/postgresql_test_environment.md`. The container administrator provisioned `test_ergonx_system` while the application role remained least-privileged (`CREATEDB=false`, `SUPERUSER=false`).

The full PostgreSQL suite now passes with the pre-provisioned database: **154 passed in 213.17s** using `pytest --reuse-db`. A separate empty `ergonx_demo_verify` database was migrated successfully, `seed_ergonx_demo` ran twice successfully, and the second run preserved deterministic counts (`1` institution, `30` employees, `1` payroll run). No live/demo database was used for the seed verification.

## 29. Backend test results

Python compilation and schema validation pass. The complete SQLite regression suite passes: **148 passed, 6 skipped** on 2026-09-24. The full PostgreSQL suite passes: **154 passed** on PostgreSQL 16 using the pre-provisioned isolated test database. The suite covers self-HR denial, institution-scoped offboarding membership deactivation, centralized disabled-Leave propagation, dashboard module exclusion, report module gating, deterministic accounting seed totals, integrated demo-seed idempotence, notifications, MFA, image/document paths, and the broader release-candidate surface. Browser smoke also passed for login, Home rendering, profile-menu Sign out, universal search query/results, and controlled employee-result navigation.

## 30. Frontend lint/build results

`npm ci` completed with 373 packages installed and 0 vulnerabilities (Node 20.15.1 emitted an engine warning because `eslint-visitor-keys` requests Node 20.19+). After the clean install, `npm run lint` passes and `npm run build` passes with 100 generated routes and TypeScript compilation complete.

## 31. OpenAPI/contracts updated

OpenAPI generation/validation exits successfully. Frontend platform contract documentation now includes managed document uploads and attendance lateness rollups.

## 32. Discrepancy-register changes

Added current statuses for self-HR protection, dashboard leakage, Settings duplication, profile popover behavior, managed document upload boundaries, attendance analytics, MFA QR/email status, image-upload status, financial report filtering, country/currency suggestions, disabled-Leave propagation coverage, and shared back-navigation coverage without deleting historical records.

## 33. Remaining P0/P1 issues

No known P0 issue remains in this increment. P1 follow-up work is production object-storage/malware scanning/resumable upload hardening, image processing/current-image persistence, and production email-provider configuration for email OTP.

## 34. Accepted limitations

Field-level encryption for searchable business identifiers, native XLSX/PDF exports, full cash-flow statement classification, production media hardening, and production email-provider configuration remain explicitly documented MVP limitations or product/provider decisions. Email OTP application behavior itself is implemented and audited.

## 35. Release-candidate recommendation

Recommend release-candidate integration testing with the documented pre-provisioned PostgreSQL test database workflow. The profile-menu, required leave-document, disabled-module aggregation, report filtering, search focus, attendance analytics, private image, and email-OTP paths are implemented; production media hardening and email-provider configuration remain deployment prerequisites.
