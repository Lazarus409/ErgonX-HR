# ErgonX Release-Candidate Reconciliation Audit

Audit date: 2026-09-22  
Scope: active `Ergonx-backend/` Django runtime, active `ergonx-frontend/` Next.js application, live OpenAPI schema, PostgreSQL-backed local environment, and current discrepancy register.

## Audit basis

Implementation truth for this audit is the running Django application and its models, views, serializers and services; `GET /api/v1/schema/`; the active `ergonx-frontend/` source; its types and API adapters; and `Ergonx-backend/DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md`.

Initial checks confirmed that the running API schema responds successfully and that the principal frontend CRUD/action adapter templates reconcile to documented OpenAPI operations. Apparent unmatched paths in a mechanical scan are dynamic invitation/onboarding/action segments or deliberately retired dashboard fallback paths; they are not endpoint mismatches.

## Pre-implementation discrepancy table

| ID | Priority | Domain | Finding | Evidence | Planned resolution / classification | Migration needed | Contract impact | Frontend impact |
|---|---|---|---|---|---|---|---|---|
| RC-001 | P1 | PWA | Historical finding: the active checkout lacked a manifest, service worker, offline route, and registration code. | 2026-09-21 source inventory; retained as historical evidence. | Resolved 2026-09-22: added a production-only manifest, static-only service worker, registration component, and `/offline` fallback. It never caches navigations, APIs, exports, browser tokens, selected-institution values, or tenant data, and never queues writes. | No | Yes | Yes; production smoke verified manifest, worker, and fallback routes. |
| RC-002 | P1 | Browser/API security | Historical finding: the API and frontend initially lacked a verified Content-Security-Policy header. | Historical response headers and pre-hardening source inventory. | Resolved: API CSP middleware and a scoped Next response-header policy are now configured; Swagger is intentionally exempted where required. | No | Yes | Yes; security-header configuration verified. |
| RC-003 | P2 | UI trustworthiness | The global notification flyout displays a permanent red indicator, count of three, and hard-coded payroll/leave/attendance messages instead of tenant data. | `ergonx-frontend/src/components/layout/TopBar.tsx`; the backend already exposes `/home/` notification summaries. | Replace fabricated content with live, tenant-scoped `/home/` notification summary data and an explicit empty state. Do not imply a full notification-centre workflow. | No | Yes | Yes. |
| RC-004 | P3 | UI interaction | Help, profile, and sign-out affordances in the top bar are buttons with no action; the profile labels are hard-coded. | `ergonx-frontend/src/components/layout/TopBar.tsx`; auth/profile contracts. | Bind profile and sign-out to existing frontend/auth behavior; explicitly label help as unavailable for this release rather than silently no-op. | No | No | Yes. |
| RC-005 | P3 | UI/data coverage | Executive dashboard presents a Compliance Alerts placeholder because no executive compliance-alert API exists. | `ergonx-frontend/src/app/dashboard/page.tsx`; dashboard API/schema. | Keep as an explicitly unavailable state; no invented aggregate or new backend scope in the release candidate. | No | No | No. |
| RC-006 | P3 | UI polish | `/favicon.ico` returns 404 even though ErgonX branding assets exist. | Live frontend request; `ergonx-frontend/public/` asset inventory. | Add a standards-compliant app icon route/metadata or redirect and verify it resolves. | No | No | Yes. |
| RC-007 | P2 | Documentation | Historical contract described a nonexistent PWA file set, then a correct online-only deferral. | Historical contract revisions and RC-001 evidence. | Resolved 2026-09-22: the platform contract now documents the actual static-only PWA assets and their explicit authenticated-data cache exclusions. | No | Yes | Yes. |
| RC-008 | P1 | Authentication architecture | Historical finding: browser access and refresh JWTs were stored in local storage, exposing them to a same-origin XSS. | Historical client and `PWA-002` record. | Resolved 2026-09-22: the same-origin BFF holds access/refresh JWTs in HttpOnly cookies, strips them from auth JSON, attaches bearer headers only server-side, performs refresh server-side, checks unsafe-method origins, and clears cookies on logout. | No | Yes | Yes; production login/refresh/logout smoke verified the boundary. |
| RC-009 | P2 | Home/workflow traceability | Home data infrastructure is real, but reference-code adoption and activity capture are incremental across domain writes. | `apps/dashboards/home.py`; `HOME-001` register entry. | Retain the existing `HOME-001` status; classify it as an accepted known implementation limitation for this RC, not an endpoint defect. | No | No | No. |
| RC-010 | P1 | Payroll/payslip contract | Payslip detail assumes a `payroll_period` object that the frontend type declares but `PayslipSerializer` did not return, causing a runtime crash at `period.name`. | `PayslipDetailPage`; `Payslip` frontend type; `PayslipSerializer`; live reproduction. | Resolved: include the server-owned payroll-period summary in the serializer and retain a defensive incomplete-response state in the UI. | No | Yes | Yes. |

## Findings that are not discrepancies

- Dashboard frontend adapters use the active plural `/dashboards/<name>/` endpoints. The older singular paths appear only in explanatory comments and were not invoked.
- Invitation and onboarding adapter URLs use runtime token/step-code segments, which a static endpoint-template scan cannot match literally.
- Workflow approval action URLs intentionally use a dynamic action segment constrained by the frontend union type and backend action routes.
- The dashboard compliance card clearly says the data is unavailable; it is not represented as a live compliance result.

## Change-control outcome

No schema or migration change is justified by the findings above. RC-001 and RC-007 are resolved by the verified static-only PWA shell; all follow-up changes must preserve its cache exclusions, tenant context, server-authoritative RBAC, response-envelope handling, and the current module boundaries.

## Hardening results

| Check | Result | Evidence |
|---|---|---|
| Django configuration and migration drift | Passed | `manage.py check` completed with no issues; `makemigrations --check --dry-run` reported no model changes. |
| PostgreSQL migration and deterministic seed | Passed | PostgreSQL 16 stack was started; `migrate --noinput` had no pending migrations; `seed_ergonx_demo` ran twice successfully. |
| Backend security headers | Passed | Live `/api/v1/schema/` returns the restrictive API CSP; `/api/v1/docs/` remains HTTP 200 and intentionally has no restrictive API CSP so Swagger can function. |
| Frontend security headers | Passed | Live frontend responses include CSP, `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`. |
| Frontend static analysis/build | Passed | `npm run lint` (0 errors, 0 warnings), `npx tsc --noEmit`, and `npm run build` completed after the changes; the production build generated 98 routes. |
| Favicon request | Passed | `/favicon.ico` returns a 307 redirect to the branded PNG asset. |
| Demo RBAC/bootstrap | Passed | Institution Admin, HR Admin, Finance Manager, Accountant, Auditor, and Director all authenticated, resolved an active onboarding-ready tenant, and received role-specific permission sets. |
| Direct-URL/API authorization | Passed | Employee self-service received HTTP 403 for the finance dashboard while retaining HTTP 200 access to `/home/`; Institution Admin received HTTP 200 for the finance dashboard. |
| Payslip detail contract | Passed | Focused payroll regression covers `payroll_period`; a live APEX-DEMO payslip response now includes its period name. |
| Full backend regression | Passed | Historical: `133 passed, 6 skipped` in 143.79 seconds (`pytest -q`, 2026-09-21). Latest local run: `139 passed, 6 skipped` (`pytest -q`, 2026-09-22), including recruitment Home-activity and queued-export coverage. The six skips are documented PostgreSQL-specific CI coverage cases. |

## Subsequent UI reconciliation outcomes

- RC-003 is resolved beyond its initial scope: notifications now have a recipient- and tenant-scoped list/read API, top-bar mark-read actions, and `/notifications` history.
- The canonical institutional login destination is Home, independent of role code; platform administrators retain the platform route.
- Home actions are checked against the active route set. Leave requests use `/me/leave/request` only for linked employees with the effective permission, and attendance adjustments use `/attendance/adjustments` rather than a removed `/new` path.
- Settings now use structured preference and institution-profile controls backed by existing APIs rather than raw JSON editors.
- Executive analytics now render server-owned workforce, attendance, financial-position, approval, payroll-by-period, recruitment activity, and a posted-ledger P&L trend. No unsupported compliance or cash-flow analytics are represented as live data.
- HR and Accounting now have distinct permission-aware module workspaces rather than reusing personal Home. Their organisation catalogue, accounting setup, employee payroll profile, payroll-to-GL mapping, and statutory-setup surfaces use the active tenant APIs and explicit loading/error/confirmation states.
- Shared Back navigation now preserves same-origin browser history where safe and otherwise returns to the logical list route for employee creation, payslips, payroll-run detail, organisation detail, journal creation, and recruitment candidate detail.
- Settings links are filtered by both effective permissions and enabled modules, including Notifications, Organization, Payroll Configuration, and Accounting Configuration where those surfaces are authorized.

## Release decision

This hardening pass has no P0 findings. `PWA-002` is resolved by the verified same-origin HttpOnly-cookie/BFF boundary. `HOME-001` and `OPS-001` remain existing P1 delivery limitations, but they are not transport, tenancy, or authorization defects discovered by this audit. The release owner must explicitly accept or resolve those entries before a production launch.
