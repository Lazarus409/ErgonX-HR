"""Single source for the Wave 0 frontend route reconciliation (ERGX-S001..S066).

Run from anywhere:  python docs/phase2/wave0/tools/build_route_reconciliation.py
Writes frontend_route_reconciliation.{md,csv,json} next to this folder.

Evidence: `ergonx-frontend/src/app/**/page.tsx` (144 pages on 2026-10-05, branch
ui/concept-redesign @ 420307a), navigation.ts, layouts/guards, and the Stitch
pack metadata. Decisions use the six values required by the Wave 0 brief.
"""
import csv
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent

RESTYLE = "EXISTING — RESTYLE"
EXTEND = "EXISTING — EXTEND"
NEW = "NEW ROUTE REQUIRED"
VARIANT = "VARIANT — MERGE INTO CANONICAL SCREEN"
DEFER = "DEFER"
NA = "NOT APPLICABLE"

FIELDS = (
    "screen_id", "stitch_title", "stitch_route", "current_route", "current_component",
    "decision", "canonical_route", "migration_required", "reason", "dependencies", "wave",
)

# fmt: off
ROWS = [
    ("ERGX-S001", "Login / Sign In", "/login", "/login", "app/login/page.tsx → components/auth/SignInForm (AuthShell)", RESTYLE, "/login", "No",
     "Password + TOTP and email-OTP login challenge already implemented (auth/login, mfa_code). Stitch is visual only; no SMS/recovery-phone affordances.",
     "Login throttling + email-OTP resend cooldown (W2, SEC findings) before advertising email OTP widely", "W1 visual / W2 security"),
    ("ERGX-S002", "Institution Registration", "/register", "/get-started; /accept-invitation/[token]; /create-organization/[token]; /onboarding", "app/get-started/page.tsx (access request form) + onboarding wizard", RESTYLE, "/get-started", "No (optional /register → /get-started redirect)",
     "Open self-registration is disabled by design: POST /auth/register/ always returns 403; organizations are created only through an Institution Admin invitation. Stitch registration visuals apply to the existing request + invitation + onboarding flow.",
     "None", "W1"),
    ("ERGX-S003", "Workspace Initialization / Loading", "N/A", "shared (AuthenticationGate / splash / onboarding loading)", "components/brand splash, components/ui/LoadingState", RESTYLE, "shared component (no route)", "No",
     "Transient state, not a business route.", "Design System v2 tokens", "W1"),
    ("ERGX-S004", "Empty, Error & Loading States", "N/A", "/design/states (reference) + shared", "components/ui/{EmptyState,ErrorState,LoadingState,StateBanner}", VARIANT, "shared state components (canonical = S059)", "No",
     "Same subject as S059; one state library.", "S059", "W1"),
    ("ERGX-S005", "Accounting Hub — Alternate Dashboard Concept", "/accounting", "/accounting/dashboard", "app/accounting/dashboard/page.tsx", VARIANT, "/accounting/dashboard (canonical = S010)", "No",
     "Alternate concept of S010. /accounting stays the ModuleLanding area index.", "S010", "W6"),
    ("ERGX-S006", "Accounts Payable — Bulk Governance Actions", "/accounting/ap", "/accounting/payables", "app/accounting/payables/page.tsx (bulk preview/execute + batch jobs)", VARIANT, "/accounting/payables (canonical = S009)", "No",
     "Bulk governance is a mode of the AP workspace; backend bulk/preview, bulk/execute and batch-jobs already exist.", "S009", "W6"),
    ("ERGX-S007", "Compliance Audit Trail — Alternate Concept", "/audit", "/audit", "app/audit/page.tsx re-exports app/settings/audit/page.tsx", VARIANT, "/audit (canonical = S011)", "No",
     "Alternate concept of S011.", "S011", "W2"),
    ("ERGX-S008", "Bank Reconciliation — Transaction Matching", "/accounting/bank-reconciliation/:sessionId", "/accounting/banking/sessions/[id]", "app/accounting/banking/sessions/[id]/page.tsx", RESTYLE, "/accounting/banking/sessions/[id]", "No (optional alias)",
     "BankReconciliationSession + statement import, suggestions, match/unmatch/flag, complete and report exist. Governed reopen of a COMPLETED session is not built (deferred, see lifecycle).",
     "Bank-statement typed import handler only if non-CSV formats are required (W7)", "W7"),
    ("ERGX-S009", "Accounts Payable — Overview & Approval Queue", "/accounting/ap", "/accounting/payables", "app/accounting/payables/page.tsx", RESTYLE, "/accounting/payables", "No (optional /accounting/ap alias)",
     "Existing AP workspace with approve/reject/hold/release/schedule actions.", "None", "W6"),
    ("ERGX-S010", "Accounting Dashboard", "/accounting", "/accounting/dashboard", "app/accounting/dashboard/page.tsx", RESTYLE, "/accounting/dashboard", "No",
     "Finance dashboard backed by /dashboards/finance/ and the accounting workspace endpoints.", "None", "W6"),
    ("ERGX-S011", "Audit Trail", "/audit", "/audit (alias of /settings/audit)", "app/settings/audit/page.tsx", RESTYLE, "/audit", "No",
     "Two URLs, one implementation. Field-level before/after view is limited by what each event stores in metadata (see audit catalogue).", "Audit metadata standard (W2)", "W2"),
    ("ERGX-S012", "Bank Reconciliation — Overview", "/accounting/bank-reconciliation", "/accounting/banking", "app/accounting/banking/page.tsx", RESTYLE, "/accounting/banking", "No (optional alias)",
     "Reconciliation overview already lives at /accounting/banking; the former cash page moved to /accounting/banking/cash.", "None", "W7"),
    ("ERGX-S013", "Executive Dashboard", "/executive", "/dashboard", "app/dashboard/page.tsx → components/insights/InsightsBoard variant=executive", EXTEND, "/dashboard", "No (optional /executive alias)",
     "Page exists and is gated by dashboard.executive.view. The locked landing rule is NOT implemented: bootstrap always returns default_landing=HOME. AUDITOR currently holds dashboard.executive.view, which conflicts with the locked rule.",
     "Landing-resolution decision (BQ-01) + bootstrap default_landing change", "W3"),
    ("ERGX-S014", "HR Dashboard", "/hr/dashboard", "/hr/dashboard", "app/hr/dashboard/page.tsx", RESTYLE, "/hr/dashboard", "No", "Existing.", "None", "W3"),
    ("ERGX-S015", "Employees — List & Detail Drawer", "/employees", "/hr/employees", "app/hr/employees/page.tsx (directory + preview drawer)", RESTYLE, "/hr/employees", "No",
     "Keep the module-namespaced HR route family.", "None", "W3"),
    ("ERGX-S016", "Budgets", "/accounting/budgets", "/accounting/budgets", "app/accounting/budgets/page.tsx", RESTYLE, "/accounting/budgets", "No",
     "Budget/BudgetLine/notes/attachments and submit/approve/return exist (no revisions model).", "Budget revisions only if approved (W7)", "W7"),
    ("ERGX-S017", "Home — Daily Workspace", "/home", "/", "app/page.tsx → components/home/WorkspaceHome", RESTYLE, "/", "No",
     "Canonical authenticated Home (default_landing=HOME).", "BQ-01 decides whether / or /me is the Employee landing", "W3"),
    ("ERGX-S018", "General Ledger", "/accounting/general-ledger", "/accounting/journals (+ /accounting/chart-of-accounts activity, GL report in /accounting/reports)", "app/accounting/journals/page.tsx", RESTYLE, "/accounting/journals", "No",
     "No separate ledger route needed; journals list + account activity + general-ledger report cover the concept.", "None", "W6"),
    ("ERGX-S019", "Financial Reports", "/accounting/financial-reports", "/accounting/reports", "app/accounting/reports/page.tsx", RESTYLE, "/accounting/reports", "No",
     "FinancialReport/Run library exists. Exports are CSV only — hide PDF/XLSX/XBRL actions.", "REPORT-001", "W7"),
    ("ERGX-S020", "Accounts Receivable", "/accounting/ar", "/accounting/receivables", "app/accounting/receivables/page.tsx", RESTYLE, "/accounting/receivables", "No (optional alias)", "Existing.", "None", "W6"),
    ("ERGX-S021", "Leave Dashboard", "/leave", "/leave/dashboard", "app/leave/dashboard/page.tsx", RESTYLE, "/leave/dashboard", "No",
     "/leave remains the ModuleLanding index.", "None", "W3"),
    ("ERGX-S022", "Attendance Dashboard", "/attendance", "/attendance/dashboard", "app/attendance/dashboard/page.tsx", RESTYLE, "/attendance/dashboard", "No", "Existing metrics (RES-035).", "None", "W3"),
    ("ERGX-S023", "Attendance Adjustment Review", "/attendance/adjustments/:adjustmentId", "/attendance/adjustments/[id]; /me/attendance/adjustments/[id]", "shared AdjustmentReview component", EXTEND, "/attendance/adjustments/[id] (self-service twin stays /me/...)", "No",
     "Review page + request_changes/resubmit/delegate exist. Missing: finalized-payroll guard on approval and structured policy checks.", "LC-ATT-01 guard (W3)", "W3"),
    ("ERGX-S024", "Employee Detail", "/employees/:employeeId", "/hr/employees/[id]", "app/hr/employees/[id]/page.tsx", RESTYLE, "/hr/employees/[id]", "No",
     "Exists. 'Performance trajectory' panel is Performance Management → excluded scope; omit.", "Scope exclusion D2-022", "W3"),
    ("ERGX-S025", "Emergency Contacts", "/my-workspace/emergency-contacts", "/me/emergency-contacts", "app/me/emergency-contacts/page.tsx", RESTYLE, "/me/emergency-contacts", "No",
     "Exists (is_primary only). Escalation order beyond primary and the healthcare-proxy document are not modelled → defer those elements.", "None", "W3"),
    ("ERGX-S026", "Candidate Detail", "/recruitment/candidates/:candidateId", "/recruitment/candidates/[id]?application=", "app/recruitment/candidates/[id]/page.tsx", RESTYLE, "/recruitment/candidates/[id]", "No",
     "Scorecard (competency ratings), documents, activity, stage history exist. /recruitment/applications/[id] redirects here.", "None", "W4"),
    ("ERGX-S027", "Approval Workflows Settings", "/settings/approval-workflows", "/settings/approval-workflows", "app/settings/approval-workflows/page.tsx", EXTEND, "/settings/approval-workflows", "No",
     "Definition/step CRUD exists, but only Leave consumes definitions. Stitch's triggers/conditions/escalation need the W2 approval-engine extension. Procurement examples must not be built.", "Approval engine gap analysis (W2)", "W2"),
    ("ERGX-S028", "Create Job Requisition", "/recruitment/requisitions/new", "/recruitment/job-postings/new", "components/recruitment RequisitionForm", RESTYLE, "/recruitment/job-postings/new", "No (optional /recruitment/requisitions/* alias)",
     "The requisition is JobPosting in DRAFT→PENDING_APPROVAL→APPROVED→OPEN with hiring-plan fields; no separate JobRequisition model is needed (supersedes D2-013).", "None", "W4"),
    ("ERGX-S029", "Customer Invoice Detail", "/accounting/ar/invoices/:invoiceId", "/accounting/receivables/invoices/[id]", "app/accounting/receivables/invoices/[id]/page.tsx", RESTYLE, "/accounting/receivables/invoices/[id]", "No",
     "Exists (hold/send/reminders/attachments). 'Issue credit' needs credit notes — not built → defer that action.", "Credit notes (W7, unapproved)", "W6"),
    ("ERGX-S030", "Candidate Application Submission", "/careers/jobs/:jobId/apply", "/recruitment/candidates/new (staff-run ApplicationWizard)", "components/recruitment ApplicationWizard", DEFER, "— (public careers portal deferred)", "n/a",
     "Public candidate portal needs anonymous-upload, privacy and abuse contracts (RECRUIT-002). Staff-entry wizard remains the supported path.", "Product approval of public careers", "W8+"),
    ("ERGX-S031", "Insights", "/insights", "/insights", "app/insights/page.tsx → components/insights/InsightsBoard", EXTEND, "/insights", "No",
     "Page + GET /home/insights/ exist with permission-filtered sections. Becomes the landing for operational roles only after BQ-01.", "BQ-01", "W3"),
    ("ERGX-S032", "Payroll Run Detail", "/payroll/runs/:runId", "/payroll/runs/[id]", "app/payroll/runs/[id]/page.tsx + PayrollRunStepper", RESTYLE, "/payroll/runs/[id]", "No",
     "Exceptions, validate, activity, reconcile exist (PayrollRunException).", "None", "W5"),
    ("ERGX-S033", "Payroll Workspace", "/payroll", "/payroll/dashboard", "components/payroll/PayrollWorkspace", RESTYLE, "/payroll/dashboard", "No",
     "/payroll stays the ModuleLanding/workflow index.", "None", "W5"),
    ("ERGX-S034", "Interview Scheduling", "/recruitment/interviews/new", "/recruitment/interviews/new", "components/recruitment InterviewScheduler", RESTYLE, "/recruitment/interviews/new", "No",
     "Internal availability endpoint exists. External calendar/Teams availability deferred (D2-015).", "None", "W4"),
    ("ERGX-S035", "My Leave", "/my-workspace/leave", "/me/leave", "app/me/leave/page.tsx", RESTYLE, "/me/leave", "No", "Keep /me/* family.", "None", "W3"),
    ("ERGX-S036", "My Payslips", "/my-workspace/payslips", "/me/payslips", "app/me/payslips/page.tsx", RESTYLE, "/me/payslips", "No",
     "Payslips are generated only at finalization, so only finalized payslips are exposed.", "None", "W3"),
    ("ERGX-S037", "My Attendance", "/my-workspace/attendance", "/me/attendance", "app/me/attendance/page.tsx", RESTYLE, "/me/attendance", "No", "Adjustment request action exists.", "None", "W3"),
    ("ERGX-S038", "My Profile", "/my-workspace/profile", "/me/profile", "app/me/profile/page.tsx", RESTYLE, "/me/profile", "No",
     "Exists. 'Identity verification status' has no backend → omit/defer.", "None", "W3"),
    ("ERGX-S039", "Journal Entry Detail", "/accounting/journals/:journalId", "/accounting/journals/[id]", "app/accounting/journals/[id]/page.tsx", RESTYLE, "/accounting/journals/[id]", "No",
     "Lines, notes, attachments, context, reverse exist. Posted journals immutable.", "None", "W6"),
    ("ERGX-S040", "Leave Request Review", "/leave/requests/:requestId/review", "/leave/requests/[id]", "app/leave/requests/[id]/page.tsx", RESTYLE, "/leave/requests/[id]", "No",
     "Review context (policy/balance checks pass/warn/fail), comments, delegate, request-changes exist. No /review sub-route needed.", "None", "W3"),
    ("ERGX-S041", "Module Management", "/settings/modules", "/settings/modules", "app/settings/modules/page.tsx", EXTEND, "/settings/modules", "No",
     "Toggle exists. Backend has no dependency validation (CORE_HR can be disabled) and no dedicated enable/disable audit event.", "MOD-01/02 (W2)", "W2"),
    ("ERGX-S042", "Offer Management", "/recruitment/offers/:offerId", "/recruitment/offers/[id]", "app/recruitment/offers/[id]/page.tsx", RESTYLE, "/recruitment/offers/[id]", "No",
     "Offer approval, letter generation, extend/accept/decline/withdraw/hire exist.", "None", "W4"),
    ("ERGX-S043", "Security Center", "/security", "/settings/security (/me/security redirects)", "app/settings/security/page.tsx", EXTEND, "/settings/security", "No (optional /security alias)",
     "TOTP + email-OTP setup exist. Active sessions list/revoke and sign-in activity have no backend.", "Session registry + revocation (W2, NEW)", "W2"),
    ("ERGX-S044", "Roles & Permissions", "/settings/roles", "/settings/roles", "app/settings/roles/page.tsx", RESTYLE, "/settings/roles", "No", "Custom role CRUD/clone + permission catalog exist.", "Permission classification (PERM findings)", "W2"),
    ("ERGX-S045", "Institution Profile", "/settings/institution", "/settings/institution", "app/settings/institution/page.tsx", RESTYLE, "/settings/institution", "No", "Existing.", "None", "W2"),
    ("ERGX-S046", "Users & Access", "/users-access", "/settings/users", "app/settings/users/page.tsx", RESTYLE, "/settings/users", "No (optional alias)", "Existing memberships/invitations/links.", "None", "W2"),
    ("ERGX-S047", "Employee Home", "/my-workspace", "/me", "app/me/page.tsx (eyebrow 'Employee Home')", RESTYLE, "/me", "No",
     "Keep /me. Whether a standard Employee lands on / or /me is BQ-01.", "BQ-01", "W3"),
    ("ERGX-S048", "Request Leave", "/my-workspace/leave/request", "/me/leave/request", "app/me/leave/request/page.tsx", RESTYLE, "/me/leave/request", "No", "Existing.", "None", "W3"),
    ("ERGX-S049", "My Documents", "/my-workspace/documents", "/me/documents", "app/me/documents/page.tsx", RESTYLE, "/me/documents", "No", "Existing self-service documents.", "None", "W3"),
    ("ERGX-S050", "Personal Preferences", "/preferences", "/settings/profile", "app/settings/profile/page.tsx", RESTYLE, "/settings/profile", "No (optional alias)",
     "UserPreference key/value store exists. Notification preferences are not modelled (see S056).", "None", "W2"),
    ("ERGX-S051", "Vendor Bill Detail", "/accounting/ap/bills/:billId", "/accounting/payables/bills/[id]", "app/accounting/payables/bills/[id]/page.tsx", RESTYLE, "/accounting/payables/bills/[id]", "No", "Existing.", "None", "W6"),
    ("ERGX-S052", "Budget Detail — Academic Affairs", "/accounting/budgets/:budgetId", "/accounting/budgets/[id]", "app/accounting/budgets/[id]/page.tsx", RESTYLE, "/accounting/budgets/[id]", "No",
     "Existing. 'Academic Affairs' is sample data — do not seed as a fact.", "None", "W7"),
    ("ERGX-S053", "Job Requisition Detail", "/recruitment/requisitions/:requisitionId", "/recruitment/job-postings/[id]", "app/recruitment/job-postings/[id]/page.tsx", RESTYLE, "/recruitment/job-postings/[id]", "No (optional alias)",
     "Approval/return/team/history/activity exist on JobPosting.", "None", "W4"),
    ("ERGX-S054", "Financial Report Detail — Statement of Financial Position", "/accounting/financial-reports/:reportId", "/accounting/reports/[id]", "app/accounting/reports/[id]/page.tsx", RESTYLE, "/accounting/reports/[id]", "No",
     "Existing; CSV only.", "REPORT-001", "W7"),
    ("ERGX-S055", "Reports & Analytics Catalogue", "/reports", "/reports (+ /reports/dashboard viewer)", "app/reports/page.tsx", RESTYLE, "/reports", "No",
     "AnalyticsItem library with sharing/refresh exists.", "None", "W8"),
    ("ERGX-S056", "Notification Center", "/notifications", "/notifications", "app/notifications/page.tsx", EXTEND, "/notifications", "No",
     "List/mark-read/mark-all exist with allow-listed route hints. Archive and per-category preferences have no backend.", "Notification preferences (W2, NEW)", "W2"),
    ("ERGX-S057", "Recruitment Dashboard", "/recruitment", "/recruitment/dashboard", "app/recruitment/dashboard/page.tsx", RESTYLE, "/recruitment/dashboard", "No",
     "/recruitment stays the ModuleLanding index.", "None", "W4"),
    ("ERGX-S058", "Global Search", "/search", "/search", "app/search/page.tsx", RESTYLE, "/search", "No",
     "Universal search + saved/recent entries exist; backend scopes by module and permission.", "SearchEntriesView missing from OpenAPI", "W2"),
    ("ERGX-S059", "Governed Empty, Error & Loading States", "shared", "/design/states (reference) + shared", "components/ui state components", RESTYLE, "shared state components", "No", "Canonical state library.", "None", "W1"),
    ("ERGX-S060", "Confirmation Dialog Patterns", "shared", "shared", "components/ui dialogs (ConfirmDialog family)", RESTYLE, "shared dialog components", "No", "Existing dialog primitives.", "None", "W1"),
    ("ERGX-S061", "Workflow Transitions & Correction Handoffs", "shared governance pattern", "— (not built; domain-specific handoffs exist)", "—", EXTEND, "shared component (no route)", "No",
     "Pattern only. Build once as a shared transition/handoff component over existing domain action endpoints; no new route.", "Lifecycle matrix", "W1"),
    ("ERGX-S062", "Record Actions & Lifecycle States", "shared lifecycle pattern", "shared", "components/ui/StatusBadge + record action menus (employee lifecycle)", RESTYLE, "shared component (no route)", "No", "Existing.", "None", "W1"),
    ("ERGX-S063", "Employee Home — Operational Variant", "/my-workspace", "/me", "app/me/page.tsx", VARIANT, "/me (canonical = S047)", "No", "Variant of S047.", "S047", "W3"),
    ("ERGX-S064", "Approvals — Governance Review Variant", "/approvals", "/approvals", "app/approvals/page.tsx", VARIANT, "/approvals (canonical = S066)", "No",
     "Variant of S066. S064 ships without reference.png.", "S066", "W2"),
    ("ERGX-S065", "Employee Directory — Filter Drawer Variant", "/employees", "/hr/employees", "app/hr/employees/page.tsx", VARIANT, "/hr/employees (canonical = S015)", "No",
     "Variant of S015. The pack manifest says 'variant of ERGX-S008' — that is a manifest error (S008 is bank matching).", "S015", "W3"),
    ("ERGX-S066", "Approvals Inbox — Pending Decisions", "/approvals", "/approvals", "app/approvals/page.tsx (cross-module inbox, GET /approvals/inbox/)", RESTYLE, "/approvals", "No",
     "Cross-module inbox exists; decisions go through each module's own endpoint.", "None", "W2"),
]
# fmt: on

assert len(ROWS) == 66 and all(len(r) == len(FIELDS) for r in ROWS)
records = [dict(zip(FIELDS, r)) for r in ROWS]

with open(OUT / "frontend_route_reconciliation.csv", "w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(records)
(OUT / "frontend_route_reconciliation.json").write_text(json.dumps(records, indent=1, ensure_ascii=False), encoding="utf-8")

counts = {}
for r in records:
    counts[r["decision"]] = counts.get(r["decision"], 0) + 1


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


lines = [
    "# Wave 0 — Frontend Route Reconciliation (ERGX-S001…S066)",
    "",
    "Evidence: `ergonx-frontend/src/app/**/page.tsx` on branch `ui/concept-redesign` @ `420307a` (2026-10-05). The tree has **144 pages**, not the 106 that v3 recorded; there are 23 segment layouts and one BFF route handler (`app/api/v1/[...path]/route.ts`). The frontend has no `middleware.ts`. Authentication and module gating run client-side in `AuthenticationGate`, `ModuleAccessGate`, `PermissionGuard` and `SelfServiceGuard`, and Django is the final authority. Generated from `tools/build_route_reconciliation.py`. Machine-readable copies: `frontend_route_reconciliation.csv` and `.json`.",
    "",
    "## Summary",
    "",
    "| Decision | Screens |",
    "|---|---|",
]
for decision in (RESTYLE, EXTEND, NEW, VARIANT, DEFER, NA):
    ids = [r["screen_id"].replace("ERGX-", "") for r in records if r["decision"] == decision]
    lines.append(f"| {decision} | {len(ids)}{' — ' + ', '.join(ids) if ids else ''} |")
lines += [
    "",
    "**No new business route is required.** Every Stitch route hint maps to an established route family:",
    "",
    "- `/my-workspace/*` → `/me/*`",
    "- `/employees` → `/hr/employees`",
    "- `/accounting/ap|ar` → `/accounting/payables|receivables`",
    "- `/accounting/bank-reconciliation` → `/accounting/banking`",
    "- `/accounting/financial-reports` → `/accounting/reports`",
    "- `/recruitment/requisitions` → `/recruitment/job-postings`",
    "- `/executive` → `/dashboard`",
    "- `/security` → `/settings/security`",
    "- `/users-access` → `/settings/users`",
    "- `/preferences` → `/settings/profile`",
    "",
    "Aliases marked *optional* are frontend-only redirects. They may be added after the Wave 1 release; they are not part of this contract.",
    "",
    "## Route families kept as-is",
    "",
    "- Module index routes (`/accounting`, `/leave`, `/attendance`, `/payroll`, `/recruitment`, `/hr`) stay as `ModuleLanding` area indexes. The Stitch dashboards map to the existing `/<module>/dashboard` routes.",
    "- `/audit` and `/settings/audit` share one implementation. `/me/security` redirects to `/settings/security`. `/recruitment/applications/[id]` redirects to the candidate detail page.",
    "- Pages with no Stitch screen are unchanged: scheduling (`/attendance/{schedules,shifts,shift-patterns,rotations,live,flexible-work,overtime}`), payroll configuration (`/payroll/{components,salary-structures,employee-profiles,periods,adjustments,configuration,ghana-setup,payslips}`), accounting configuration (`/accounting/{chart-of-accounts,periods,localization,ghana-setup,payroll-mappings,expenses}`), `/department*`, `/platform/*`, `/operations`, `/documents`, `/records/[type]/[id]`, `/onboarding/*`. They are restyled through Design System v2 only.",
    "",
    "## Screen map",
    "",
    "| Screen | Stitch title | Stitch route | Current route | Current page/component | Decision | Canonical route | Migration? | Reason | Dependencies | Wave |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
]
for r in records:
    lines.append("| " + " | ".join(cell(r[f]) for f in FIELDS) + " |")
(OUT / "frontend_route_reconciliation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(counts)
