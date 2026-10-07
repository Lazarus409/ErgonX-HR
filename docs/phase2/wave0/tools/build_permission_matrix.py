"""Builds permission_matrix_final.md from permission_inventory.json plus curated Phase 2 annotations.

Run:  python docs/phase2/wave0/tools/build_permission_matrix.py
"""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent
data = json.loads((OUT / "permission_inventory.json").read_text(encoding="utf-8"))
perms = {p["code"]: p for p in data["permissions"]}

ROLE_ABBR = {"INSTITUTION_ADMIN": "IA", "HR_ADMIN": "HR", "DIRECTOR": "DIR", "EMPLOYEE": "EMP",
             "DEPARTMENT_HEAD": "DH", "ACCOUNTANT": "ACC", "FINANCE_MANAGER": "FM", "AUDITOR": "AUD"}

ROW_SCOPED_PREFIXES = ("employee.", "employment.", "leave.", "attendance.", "schedule.", "compensation.",
                       "payslip.", "tax_relief.", "document.", "dashboard.department", "report.view", "search.use")
SELF_SERVICE = {"home.view", "settings.profile.manage_self", "leave.view", "leave.request", "schedule.view",
                "attendance.view", "attendance.clock", "attendance.adjust", "payslip.view", "tax_relief.view",
                "tax_relief.claim", "compensation.view", "search.use", "institution.view"}


def sensitivity(code):
    if code.startswith(("compensation.", "payroll.", "payslip.", "tax_relief.", "payroll_accounting.")):
        return "RESTRICTED — pay"
    if code.startswith(("employee.", "employment.", "candidate", "offer.", "interview.")):
        return "PERSONAL — PII"
    if code in {"audit.view", "settings.roles.manage", "settings.users.manage", "settings.modules.manage",
                "settings.security.manage", "settings.institution.manage", "onboarding.manage", "report.all"}:
        return "PRIVILEGED — admin/oversight"
    if any(code.endswith(s) for s in (".approve", ".post", ".reverse", ".void", ".close", ".reopen", ".finalize", ".configure", ".issue")):
        return "FINANCIAL/GOVERNANCE CONTROL" if PERM_MODULE(code) in ("ACCOUNTING", "PAYROLL") else "GOVERNANCE CONTROL"
    return "INTERNAL"


def PERM_MODULE(code):
    return perms[code]["module"]


# Curated Phase 2 actions per code (default: KEEP).
ACTIONS = {
    "dashboard.executive.view": "KEEP code; REMOVE from AUDITOR default or add a separate landing rule (BQ-01). Use for Executive landing.",
    "report.all": "KEEP; document that it bypasses source-module permissions by design (2026-09-27 decision).",
    "settings.notifications.manage": "UNUSED — enforce on notification-preference admin (W2) or retire.",
    "settings.security.manage": "UNUSED — enforce on institution security policy (MFA enforcement, session policy) in W2 or retire.",
    "settings.roles.manage": "RECLASSIFY PRIVILEGED (W2); consider non-delegable to custom roles.",
    "settings.users.manage": "RECLASSIFY PRIVILEGED (W2).",
    "settings.modules.manage": "RECLASSIFY PRIVILEGED (W2).",
    "approval_request.view": "KEEP; decisions remain step-assignment based.",
    "approval_workflow.update": "KEEP; becomes the gate for trigger/escalation config (W2).",
    "expense.create": "SPLIT in W6: expense.create (finance-entered) vs new expense.claim_own (self-service, SELF scope).",
    "expense.approve": "SPLIT in W6: manager stage resolved by approval engine + new expense.finance_review.",
    "expense.post": "KEEP; posting stays finance-only.",
    "candidate.view": "TIGHTEN: scorecard POST should require candidate_evaluation.create (W4).",
    "journal.approve": "KEEP; add creator≠approver separation-of-duties rule (W6, policy-gated).",
    "payroll.approve": "KEEP; add preparer≠approver rule (W5, policy-gated).",
    "payroll.prepare": "KEEP; also governs exception status updates (no separate resolve permission needed).",
    "attendance.approve": "KEEP; add finalized-payroll guard (W3).",
    "audit.view": "KEEP (only PRIVILEGED code today).",
    "search.use": "KEEP.",
}

AREAS = [
    ("Executive Dashboard", ["dashboard.executive.view"], "IA, DIR, **AUD** (conflicts with locked rule)",
     "Landing resolution is not implemented (`default_landing` is always HOME). Decide BQ-01, then resolve landing from permissions in bootstrap."),
    ("Insights", ["home.view"], "all roles; sections filtered by source permissions",
     "No dedicated permission is needed. If the product wants an explicit gate, add `dashboard.insights.view` (optional)."),
    ("HR", ["employee.view", "employee.create", "employee.update", "employee.delete", "employment.view", "employment.create", "employment.update", "employment.delete", "organization.view", "organization.create", "organization.update", "organization.delete", "dashboard.hr.view"], "IA, HR (DIR/DH read)",
     "Keep. Audit employee create/update with before/after."),
    ("Recruitment", ["job_posting.view", "job_posting.create", "job_posting.update", "job_posting.approve", "candidate.view", "candidate.create", "candidate.update", "recruitment_stage.view", "recruitment_stage.manage", "interview.view", "interview.manage", "candidate_evaluation.create", "offer.view", "offer.create", "offer.manage", "offer.approve"], "IA, HR; DIR approve/view",
     "Keep the namespace. v3's proposed `requisition.*` and `candidate.evaluate` are SUPERSEDED by `job_posting.*` and `candidate_evaluation.create`."),
    ("Leave", ["leave.view", "leave.request", "leave.approve", "leave.reject", "leave.configure", "leave.balance.manage", "dashboard.leave.view"], "IA, HR full; DIR/DH approve; staff self",
     "Keep."),
    ("Attendance", ["schedule.view", "schedule.manage", "attendance.view", "attendance.clock", "attendance.adjust", "attendance.manage", "attendance.approve", "dashboard.attendance.view"], "IA, HR full; staff self",
     "Keep. v3's `attendance.adjustment.review` is SUPERSEDED by `attendance.approve`."),
    ("Payroll", ["compensation.view", "compensation.configure", "compensation.manage", "payroll.view", "payroll.configure", "payroll.prepare", "payroll.approve", "payroll.finalize", "payslip.view", "tax_relief.view", "tax_relief.claim", "tax_relief.approve", "dashboard.payroll.view"], "IA, HR (all payroll incl. finalize), FM approve/finalize, ACC prepare",
     "Keep. Note that HR_ADMIN holds payroll.prepare, approve and finalize, so HR alone can run payroll end to end. Product decision on separation of duties (BQ-04). v3's `payroll.resolve_exception` is SUPERSEDED by `payroll.prepare`."),
    ("Accounting", ["accounting.configure", "account.view", "account.create", "account.update", "journal.view", "journal.create", "journal.approve", "journal.post", "journal.reverse", "accounting_period.close", "accounting_period.reopen", "financial_report.view", "financial_report.manage", "payroll_accounting.view", "payroll_accounting.configure", "dashboard.finance.view", "vat_withholding_certificate.view", "vat_withholding_certificate.issue"], "IA, FM full; ACC create; AUD read",
     "Keep."),
    ("AP", ["vendor.view", "vendor.create", "vendor.update", "vendor_bill.view", "vendor_bill.create", "vendor_bill.approve", "vendor_bill.post", "vendor_bill.void", "payment.view", "payment.create", "payment.void"], "IA, FM; ACC create", "Keep."),
    ("AR", ["customer.view", "customer.create", "customer.update", "invoice.view", "invoice.create", "invoice.issue", "invoice.void", "receipt.view", "receipt.create", "receipt.void"], "IA, FM; ACC create", "Keep."),
    ("Expenses", ["expense.view", "expense.create", "expense.approve", "expense.post"], "IA, FM; ACC view/create",
     "EXTEND in W6. New codes: `expense.claim_own` (self-service), `expense.finance_review`, `expense.settle`. The manager stage is resolved by the approval engine, not by a permission."),
    ("Bank Reconciliation", ["bank_account.view", "bank_account.create", "bank_account.update", "bank_reconciliation.view", "bank_reconciliation.manage"], "IA, FM; ACC bank accounts",
     "Keep. v3's `bank.reconcile` is SUPERSEDED by `bank_reconciliation.manage`."),
    ("Budgets", ["budget.view", "budget.manage", "budget.approve"], "IA, FM; ACC manage; DIR approve; AUD view", "Keep."),
    ("Reports", ["report.view", "report.all", "report.publish"], "IA, HR, DIR, FM, AUD (report.all: IA, DIR, AUD)", "Keep. Decide REPORTS-module gating (MOD-03)."),
    ("Approvals", ["approval_workflow.view", "approval_workflow.create", "approval_workflow.update", "approval_workflow.delete", "approval_request.view", "approval_request.create"], "IA, HR",
     "Keep. v3's `approval.workflow.manage` and `approval.inbox.view` are SUPERSEDED. The inbox needs only `home.view`, plus per-item module permissions."),
    ("Audit", ["audit.view"], "IA, AUD", "Keep."),
    ("Users & Access", ["settings.users.manage", "settings.roles.manage", "institution.view"], "IA", "Reclassify as PRIVILEGED. v3's `role.manage` and `membership.manage` are SUPERSEDED."),
    ("Settings", ["settings.institution.view", "settings.institution.manage", "settings.modules.manage", "settings.notifications.manage", "settings.security.manage", "onboarding.view", "onboarding.manage", "import_job.view", "import_job.create", "export_job.view", "export_job.create", "background_job.view", "document.view", "document.create", "document.update", "document.delete"], "IA (HR: view + operations + documents)",
     "Two codes are unused (notifications.manage, security.manage)."),
    ("Self-Service", ["home.view", "search.use", "settings.profile.manage_self", "leave.request", "attendance.clock", "attendance.adjust", "tax_relief.claim", "payslip.view"], "all staff roles",
     "Keep. Add `expense.claim_own` in W6."),
    ("Security", ["(none — user-level IsAuthenticated)"], "every authenticated user",
     "MFA, password and sessions are user-level, not institution permissions. v3's `user.manage_own_security` is not needed as a code. Institution-wide MFA enforcement would use `settings.security.manage`."),
]

L = []
L += [
    "# Wave 0 — Final Permission Matrix",
    "",
    "Source of truth: `Ergonx-backend/apps/institutions/services.py` (`PERMISSIONS`, `ACCOUNTING_PERMISSIONS`, `PERMISSION_MODULES`, `ROLE_PERMISSION_CODES`, `SELF_SERVICE_PERMISSIONS`), `common/permissions.py` (`READ_ONLY_ROLES`, `SELF_SERVICE_ACTIONS`) and `common/scoping.py`. Endpoint usage comes from `api_operation_inventory.json`. The machine-readable copy is `permission_inventory.json`, and this file is generated by `tools/build_permission_matrix.py`.",
    "",
    "**142 permission codes; 8 system roles:**",
    "",
    "- INSTITUTION_ADMIN (IA)",
    "- HR_ADMIN (HR)",
    "- DIRECTOR (DIR)",
    "- EMPLOYEE (EMP)",
    "- DEPARTMENT_HEAD (DH)",
    "- ACCOUNTANT (ACC)",
    "- FINANCE_MANAGER (FM)",
    "- AUDITOR (AUD)",
    "",
    "System role permissions are resynced on every migrate (`sync_system_role_permissions`) and cannot be edited in the app.",
    "",
    "v3 assumed Recruitment Officer and Payroll Officer system roles. **They do not exist.** Those duties are held by HR_ADMIN (recruitment, and payroll prepare/approve/finalize) and ACCOUNTANT (payroll prepare). A custom role can replicate either.",
    "",
    "## How authorization actually works",
    "",
    "1. **Action authority** comes from the permission code. `TenantRBACPermission` checks that the role holds the code returned by `get_required_permission()` for the action. Many services re-check it (`accounting.services._require`, `payroll._membership_with_permission`).",
    "2. **Module gate** comes first. A view's `required_module` must be enabled or the request gets 403 `module_disabled`, whatever permissions the role holds.",
    "3. **Row scope** (`common.scoping`) has three levels:",
    "   - `SELF` for role code EMPLOYEE;",
    "   - `DEPARTMENT` for role code DEPARTMENT_HEAD;",
    "   - `INSTITUTION` for every other role, including **every custom role**.",
    "   Within INSTITUTION scope, self-service permissions such as `leave.view` still show only the member's own rows unless the role also holds a module 'broad' permission (`LEAVE_BROAD`, `ATTENDANCE_BROAD`, `PAYSLIP_BROAD`).",
    "4. **Read-only roles.** `READ_ONLY_ROLES = {AUDITOR}` blocks any unsafe method except the self-service actions.",
    "",
    "### Findings: role-code authorization (conflicts with 'do not authorize from role names')",
    "",
    "| ID | Finding | Evidence | Phase 2 action |",
    "|---|---|---|---|",
    "| PERM-01 | Row scope is chosen by **role code** (EMPLOYEE→SELF, DEPARTMENT_HEAD→DEPARTMENT). A custom role cloned from Employee gets INSTITUTION scope and sees every row its broad permissions allow. | `common/scoping.py` ROLE_DATA_SCOPES | W2: move scope onto the Role (`data_scope` field, defaulted from system role) — migration needed, approval required. |",
    "| PERM-02 | Read-only behaviour is keyed on **role code** AUDITOR; a custom auditor role is not read-only. | `common/permissions.py` READ_ONLY_ROLES; `workflows/models.py` approver validation | W2: role-level `is_read_only` flag. |",
    "| PERM-03 | Only `audit.view` is PRIVILEGED; nothing is PLATFORM_ONLY. `_validate_delegable_permissions` therefore lets a custom role receive `settings.roles.manage`, which can grant itself everything. | migration 0033; services `_validate_delegable_permissions` | W2: classify settings.* / onboarding.manage / report.all as PRIVILEGED and require IA to grant PRIVILEGED codes. |",
    "| PERM-04 | AUDITOR holds `dashboard.executive.view`, so a permission-based Executive landing would send auditors to the Executive Dashboard, contrary to the locked rule. | ROLE_PERMISSION_CODES['AUDITOR'] | BQ-01. |",
    "| PERM-05 | `settings.notifications.manage` and `settings.security.manage` are defined but never enforced. | permission_inventory.json (0 endpoints, no code refs) | Use in W2 or retire. |",
    "| PERM-06 | HR_ADMIN holds every non-accounting permission, including `payroll.approve` and `payroll.finalize`; nothing separates preparer from approver for payroll or journals. | ROLE_PERMISSION_CODES['HR_ADMIN']; services | BQ-04 (separation-of-duties policy). |",
    "| PERM-07 | `GET /recruitment/candidates/{id}/scorecard/` resolves to no permission code (only module + membership). `POST /applications/{id}/scorecard/` requires only `candidate.view`. | api_operation_inventory.json | W4: tighten. |",
    "",
    "## Area mapping (the 20 areas in the Wave 0 brief)",
    "",
    "| Area | Permission codes | System-role defaults | Phase 2 action |",
    "|---|---|---|---|",
]
for area, codes, roles, action in AREAS:
    L.append(f"| {area} | {', '.join('`' + c + '`' for c in codes)} | {roles} | {action} |")

L += [
    "",
    "## New Phase 2 permissions",
    "",
    "Add only these, each in its wave's migration:",
    "",
    "| Code | Module | Purpose | Default roles | Self-service? | Wave |",
    "|---|---|---|---|---|---|",
    "| `expense.claim_own` | ACCOUNTING | Create/submit own expense claims; SELF-scoped list | all staff roles (incl. EMP, DH) when ACCOUNTING enabled | Yes | W6 |",
    "| `expense.finance_review` | ACCOUNTING | Finance review stage (coding, tax, policy) | IA, FM (ACC optional) | No | W6 |",
    "| `expense.settle` | ACCOUNTING | Record settlement (Dr payable / Cr bank-cash) | IA, FM | No | W6 |",
    "| *(optional)* `dashboard.insights.view` | CORE_HR | Explicit Insights gate if product wants one | IA, HR, FM, ACC, DIR, AUD | No | W3 |",
    "",
    "v3's `analytics.insights.view`, `approval.inbox.view`, `requisition.*`, `candidate.evaluate`, `attendance.adjustment.review`, `payroll.resolve_exception`, `bank.reconcile`, `approval.workflow.manage`, `role.manage`, `membership.manage` and `user.manage_own_security` are **not needed**. Existing codes already cover them, as the area table shows.",
    "",
    "## Full code table",
    "",
    "Legend:",
    "",
    "- **Custom-role eligible**: every code is currently delegable, because none is PLATFORM_ONLY.",
    "- **Self-service?**: the code is in the self-service bundle, or is exempt from read-only blocking.",
    "- **Tenant scope**: `INST` means filtered to the institution by permission only. `ROW` means `common.scoping` also applies.",
    "",
    "| Code | Description | Module | System role defaults | Custom-role eligible | Self-service? | Tenant scope | Sensitivity | Endpoints | Phase 2 action |",
    "|---|---|---|---|---|---|---|---|---|---|",
]
for code, p in perms.items():
    roles = ", ".join(ROLE_ABBR[r] for r in p["roles"])
    self_svc = "Yes" if code in SELF_SERVICE or p["self_service_bundle"] or p["read_only_role_write_exempt"] else "No"
    scope = "ROW" if code.startswith(ROW_SCOPED_PREFIXES) else "INST"
    eps = p["endpoint_count"]
    sample = "; ".join(p["endpoints"][:2]).replace("/api/v1", "")
    ep_text = f"{eps}" + (f" (e.g. {sample})" if sample else " (service/dynamic check)")
    L.append(
        f"| `{code}` | {p['description']} | {p['module']} | {roles} | Yes{' (PRIVILEGED)' if p['classification']=='PRIVILEGED' else ''} | {self_svc} | {scope} | {sensitivity(code)} | {ep_text.replace('|','/')} | {ACTIONS.get(code, 'KEEP')} |"
    )

(OUT / "permission_matrix_final.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print(len(perms), "codes written")
