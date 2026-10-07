# ErgonX UI and Frontend–Backend Context

Last reviewed: 2026-09-22  
Repository state: `Ergonx-backend/` (Django REST API) and `ergonx-frontend/` (Next.js application)

## Purpose and reading order

Use this file to orient a product, design, or implementation discussion about the **current checkout**. It describes what is actually rendered and wired today; it is not a proposal for a future redesign.

Read this alongside:

- `Ergonx-backend/docs/integration/frontend_platform_contract.md` for the cross-module API contract;
- the neighboring module-specific frontend contracts for endpoint and workflow detail;
- `Ergonx-backend/DEVELOPMENT_DISCREPANCIES_AND_LIMITATIONS.md` for authoritative known gaps;
- `ergonx-frontend/src/lib/api/` and `ergonx-frontend/src/types/` before changing a client contract.

Historical documents recorded a missing PWA asset set. The active checkout now contains a production-only static PWA shell; the current implementation caveats below describe its deliberately strict cache boundary.

## Product shape

ErgonX is a tenant-aware workforce and financial-management application. The frontend is a Next.js App Router application using TypeScript, Tailwind CSS, Lucide icons, and a Django `/api/v1/` backend. The current frontend contains 106 `page.tsx` routes across public/authentication, institution administration, HR, employee self-service, leave, attendance/scheduling, payroll, accounting, recruitment, reports, and approvals.

The browser UI is not a generic mock. Most operational list/detail pages use typed client functions in `src/lib/api/` and render tenant-scoped API data. The APEX-DEMO tenant provides a populated local demonstration dataset for visual and workflow testing.

## Visual language: what the UI currently looks like

### Overall character

The UI is a clean, restrained B2B operations console:

- neutral `slate` canvas (`#f8fafc`), white panels, cool-gray borders, and dark slate text;
- dark navy/near-black (`slate-950`) is the primary structural and CTA color;
- small amounts of indigo are used for an active desktop-dock item; semantic green/red are reserved for trends and statuses;
- the ErgonX logo is used in the sign-in view, top bar, and navigation shell;
- typography is compact and utilitarian: short page labels, prominent 2xl/3xl headings, sentence-case supporting copy, and compact data/table text.

The intended impression is professional HR/finance software: information-dense enough for operations work, but with rounded corners, generous spacing, icon-led cards, and low visual noise.

### Public/authentication surfaces

The login page is intentionally more branded and spacious than the app shell:

- white background with the compact ErgonX mark and “Workforce & Financial Management” lockup;
- blue uppercase “Secure sign in” eyebrow, “Welcome back” heading, and short explanatory copy;
- large rounded email/password controls with leading icons and password visibility toggle;
- full-width dark primary “Sign in” button with arrow;
- password-reset and onboarding entry links;
- inline red error panel for authentication/network errors.

Related public routes exist for registration/get-started, invitation acceptance, institution-admin creation, forgot/reset password, and account profile creation.

### Authenticated shell

After sign-in, the shell has three persistent visual regions:

1. **Dark top bar** — institution identity, global search trigger, help, notifications, and profile menu. The active institution name is prominently displayed. Search expands into a centered overlay with result rows.
2. **Navigation** — on large screens this is a centered, floating, dark bottom dock of icon-only destinations with hover tooltips; on small screens it becomes a slide-in white sidebar with labels, sections, a close overlay, and institution identity at the bottom.
3. **Main canvas** — light gray background with responsive page padding and enough bottom padding to clear the floating dock.

Important implementation nuance: `AppShell` currently renders `DesktopDock` at `lg` and `Sidebar` only below `lg`. Although `Sidebar.tsx` contains collapsed-desktop styling, it is not the active desktop navigation in the present shell.

### Repeated page patterns

The current interface consistently uses:

- a `PageHeader`/intro area with eyebrow, title, explanation, breadcrumbs or actions where appropriate;
- white rounded cards with `slate-200` borders and subtle hover shadows;
- KPI grids (usually 2–4 cards) with icon tiles, live/loading labels, value, and descriptor;
- filter toolbars built from search inputs, native selects, clear buttons, and concise primary CTAs;
- responsive, horizontally scrollable data tables with compact uppercase headers, status badges, row action menus, and pagination;
- card grids for module landing pages (for example Payroll); and
- explicit loading, empty, error/retry, access-denied, module-disabled, and configuration-incomplete states.

Example: the executive dashboard begins with a near-black greeting panel, then four live-data cards (workforce, active employees, pending leave, finalized payroll), followed by approval and compliance panels. The current compliance panel is deliberately a placeholder rather than fabricated data.

### Responsive behavior and accessibility cues

- Tailwind breakpoints reshape tables, filter bars, KPI grids, navigation, and padding.
- Desktop navigation uses tooltips because items are icon-only.
- The mobile sidebar has an overlay and named close/open buttons.
- Most interactive controls have visible labels or `aria-label`s.
- Long operational tables preserve columns through horizontal scrolling rather than silently dropping information.

## Route and module map

These are the principal route families; many include list, detail, create, and configuration subroutes.

| Area | Current frontend route families | Typical UI shape |
|---|---|---|
| Home and executive | `/`, `/dashboard`, `/approvals`, `/documents` | role-aware landing, executive KPI dashboard, approval/document lists |
| HR and organization | `/hr`, `/hr/dashboard`, `/hr/employees`, `/hr/departments`, `/hr/positions`, `/hr/grades`, `/hr/locations` | dashboards, searchable tables, forms, employee detail/lifecycle views |
| Employee self-service | `/me`, `/me/profile`, `/me/leave`, `/me/attendance`, `/me/payslips`, `/me/documents`, `/me/emergency-contacts` | personal workspace and request/history surfaces |
| Leave | `/leave/dashboard`, `/leave/requests`, `/leave/policies`, `/leave/calendar` | dashboard, queues, policy configuration, calendar/list views |
| Attendance and scheduling | `/attendance/dashboard`, `/attendance/live`, `/attendance/overtime`, `/attendance/adjustments`, `/attendance/shifts`, `/attendance/shift-patterns`, `/attendance/rotations`, `/attendance/schedules`, `/attendance/flexible-work` | operational lists, schedules, live attendance, approvals/actions |
| Payroll | `/payroll`, `/payroll/dashboard`, `/payroll/components`, `/payroll/salary-structures`, `/payroll/periods`, `/payroll/runs`, `/payroll/adjustments`, `/payroll/payslips`, `/payroll/configuration`, `/payroll/ghana-setup` | module landing-card grid, configuration, controlled run lifecycle, payslip views |
| Accounting | `/accounting`, `/accounting/dashboard`, `/accounting/chart-of-accounts`, `/accounting/journals`, `/accounting/payables`, `/accounting/receivables`, `/accounting/banking`, `/accounting/expenses`, `/accounting/periods`, `/accounting/reports`, `/accounting/ghana-setup` | finance dashboard, ledgers/tables, forms, workflow actions, reporting |
| Recruitment | `/recruitment`, plus job postings, candidates, applications, interviews, evaluations, offers, stages, and pipeline routes | ATS workbench: lists, detail pages, forms, pipeline and stage flows |
| Reports/settings/onboarding/platform | `/reports/dashboard`, `/settings/*`, `/onboarding/*`, `/platform/*` | reports, institution/role/user/module/workflow configuration, guided institution setup, platform administration |

Navigation is intentionally filtered by role, permission, and enabled module. Route access must not be inferred from a visible link alone; server-side authorization remains authoritative.

## How the frontend meshes with the backend

### Transport and response model

- Base API prefix: `/api/v1/`.
- The client resolves `NEXT_PUBLIC_API_URL` first; otherwise it appends `/api/v1` to `NEXT_PUBLIC_API_BASE_URL`. Local development uses `http://localhost:8000` as the origin.
- The shared Axios client lives in `ergonx-frontend/src/lib/api/client.ts`.
- Standard API responses use `{ success, data, message, errors }`. Paginated collections are inside `data` as `{ count, next, previous, results }`.
- UI code should use the shared `apiGet`, `apiGetList`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `apiAction`, and `apiDownload` helpers rather than creating one-off Axios clients.
- Stable backend `code` values should drive special client behavior; `message` is the user-facing summary and `errors` maps to form fields when possible.

### Authentication and tenant context

1. Login posts credentials to `/auth/login/`; access and refresh JWTs are persisted by the shared client.
2. `AuthProvider` fetches memberships, selects a default membership, calls `/auth/bootstrap/`, and creates the live frontend session.
3. The selected institution UUID is held in browser local storage and sent as `X-Institution-ID` when valid.
4. The shared client adds `Authorization: Bearer <access-token>` and performs one refresh-token retry after a 401.
5. `InstitutionProvider`, `AuthenticationGate`, `PermissionGuard`, `ModuleGuard`, and `SelfServiceGuard` govern the client experience; Django remains the final authorization boundary.

The current local Django configuration explicitly permits the custom `X-Institution-ID` header in CORS preflight. Without it, the browser reports a network/server-reachability error even when the API process is healthy.

### Typed integration modules

`src/lib/api/` contains domain adapters for auth, institutions, home, dashboards, employees, organization, leave, scheduling, attendance, payroll, accounting, recruitment, reports, workflows, operations, and universal search. Their associated `src/types/` definitions are the primary frontend representation of backend response shapes.

This is a real client boundary, not just a collection of fetches. For example:

- dashboards render server-provided, tenant-scoped totals rather than browser-computed financial metrics;
- payroll, accounting, leave, attendance, recruitment, and workflow actions call explicit action endpoints rather than PATCHing lifecycle status fields;
- list pages use shared pagination/filter conventions;
- global search uses the tenant-aware search endpoint and routes using backend-provided route hints.

### RBAC and module behavior

The browser filters navigation based on `enabledModules`, role code, and effective permissions from bootstrap. A user can still encounter a server denial if permissions change after bootstrap, so all screens must retain error handling. Disabled modules do not become usable just because a user has a broad role.

The APEX-DEMO seed contains active Institution Admin, HR Admin, Finance Manager, Accountant, Auditor, and Director setup-owner accounts, allowing role-specific walkthroughs. Use `docs/demo/demo_credentials.md` for the current demo identities; do not place real credentials in this document or in source.

## Current implementation caveats and known gaps

1. **PWA shell is static-only.** `manifest.webmanifest`, `sw.js`, a production-only registration component, and `/offline` are present. The worker caches only static same-origin assets and the generic offline fallback; it never caches pages, `/api/` responses, exports, tokens, selected-institution values, or tenant data, and it never queues writes. Installed use is therefore supported, but ERP work remains online-only by design.
2. **Session storage model.** The browser calls the same-origin Next.js BFF route. JWT access/refresh tokens are HttpOnly cookies and are attached to Django requests server-side; JavaScript stores only a non-sensitive session hint and the selected tenant UUID. The BFF has an unsafe-method origin check and a cookie-clearing logout route.
3. **Operational depth varies by route.** The frontend has broad route coverage and many live CRUD/action integrations, but not every page offers the same workflow depth. Consult its module contract before assuming a screen supports an action.
4. **Known placeholders exist.** The executive compliance-alert panel is currently informational placeholder UI. Top-bar notification and help affordances are present visually; their product behavior should be checked before treating them as complete notification/support systems.
5. **Brand icon source.** Metadata redirects `/favicon.ico` to the ErgonX logo; the PWA manifest uses the same supplied ErgonX logo asset.
6. **Do not rely on historical `frontend/` paths in older backend notes.** The active app directory is `ergonx-frontend/`.

## Guidance for a follow-up ChatGPT implementation task

- Preserve the dark top bar + floating desktop dock + light operational canvas unless a redesign is explicitly requested.
- Prefer existing shared components (`PageHeader`, `KPIStatCard`, `StatusBadge`, `LoadingState`, `EmptyState`, `ErrorState`, `AccessDenied`, `ModuleDisabled`, `ConfigurationIncomplete`, `ConfirmDialog`) before introducing a parallel design language.
- Keep new operational UI dense, accessible, and responsive: filters before tables, explicit empty/loading/error states, and no hidden lifecycle mutations.
- Add API calls in the existing typed domain module, update types, and document meaningful contract changes in the relevant backend integration contract.
- Use server-owned IDs, state transitions, tenant context, permissions, and module flags. Never infer authorization from the visible navigation alone.
- Treat the API schema at `/api/v1/schema/` and the Django views/serializers as implementation truth when a frontend contract and runtime differ.
- Preserve the static-only PWA cache boundary. Any offline data, write queue, or authenticated-response cache requires a separately reviewed security and tenancy design.

## High-value implementation entry points

| Concern | Primary files |
|---|---|
| Global styling/root providers | `ergonx-frontend/src/app/globals.css`, `src/app/layout.tsx` |
| Auth and bootstrap | `src/components/guards/AuthProvider.tsx`, `src/lib/api/auth.ts`, `src/lib/api/client.ts` |
| Shell/navigation | `src/components/layout/AppShell.tsx`, `DesktopDock.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `src/components/navigation/navigation.ts` |
| Shared UI states | `src/components/ui/` |
| Module API boundary | `src/lib/api/*.ts`, `src/types/*.ts` |
| Backend routing/schema | `Ergonx-backend/config/v1_urls.py`, `Ergonx-backend/config/urls.py`, `/api/v1/schema/` |
| Cross-module integration contract | `Ergonx-backend/docs/integration/frontend_platform_contract.md` |
