"""Builds audit_event_catalogue.md from audit_event_inventory.tsv (output of inspect_audit.py).

Run:  python docs/phase2/wave0/tools/build_audit_catalogue.py
"""
import re
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent
rows = []
for line in (OUT / "audit_event_inventory.tsv").read_text(encoding="utf-8").splitlines():
    parts = line.split("\t")
    if len(parts) < 2:
        continue
    rows.append((parts[0], parts[1], parts[2] if len(parts) > 2 else ""))

# Expand the known dynamic expressions into their concrete codes.
EXPANSIONS = {
    'f"accounting.period.{status.lower()}"': ["accounting.period.closed", "accounting.period.locked", "accounting.period.open (reopen)"],
    '"accounting.budget.approved" if approve else "accounting.budget.returned"': ["accounting.budget.approved", "accounting.budget.returned"],
    'f"accounting.{transaction_record._meta.model_name}.voided"': ["accounting.payment.voided", "accounting.receipt.voided"],
    '"accounting.vendor_bill.held" if on_hold else "accounting.vendor_bill.released"': ["accounting.vendor_bill.held", "accounting.vendor_bill.released"],
    '"accounting.invoice.held" if on_hold else "accounting.invoice.released"': ["accounting.invoice.held", "accounting.invoice.released"],
    'f"accounting.invoice.reminder_{status.lower()}"': ["accounting.invoice.reminder_done", "accounting.invoice.reminder_cancelled"],
    '"accounting.bank_statement_line.flagged" if exception else "accounting.bank_statement_line.unflagged"': ["accounting.bank_statement_line.flagged", "accounting.bank_statement_line.unflagged"],
    'f"{self.attachment_entity_type.lower()}.attachment_added"': ["<entity>.attachment_added (journal / vendor_bill / invoice)"],
    'f"{PLATFORM_ACTION_PREFIX}{action}"': ["platform.suspend", "platform.reactivate"],
    '"payroll.adjustment.approved" if approve else "payroll.adjustment.rejected"': ["payroll.adjustment.approved", "payroll.adjustment.rejected"],
    'f"recruitment.job_posting.{target.lower()}"': ["recruitment.job_posting.closed", "recruitment.job_posting.cancelled"],
    'f"recruitment.interview.{status.lower()}"': ["recruitment.interview.completed / cancelled / no_show"],
    'f"recruitment.offer.{target.lower()}"': ["recruitment.offer.accepted / declined"],
    'action': ["recruitment.interview.drafted", "recruitment.interview.scheduled", "recruitment.interview.rescheduled"],
    'action_code': ["reports.analytics_item.shared", "reports.analytics_item.unshared"],
    'f"APPROVAL_{action}"': ["APPROVAL_APPROVE", "APPROVAL_REJECT", "APPROVAL_CANCEL"],
}

events = defaultdict(list)
for action, loc, meta in rows:
    if action.startswith("<expr> "):
        expr = action[len("<expr> "):]
        codes = EXPANSIONS.get(expr)
        if codes is None and expr.startswith('"payroll.tax_relief_claim.approved"'):
            codes = ["payroll.tax_relief_claim.approved", "payroll.tax_relief_claim.rejected"]
        for code in codes or [f"<dynamic> {expr}"]:
            events[code].append((loc, meta))
    else:
        events[action].append((loc, meta))


def domain(code):
    if code.startswith("APPROVAL_"):
        return "workflows"
    if code.startswith("<"):
        return "accounting"
    return code.split(".")[0]


by_domain = defaultdict(list)
for code in sorted(events):
    by_domain[domain(code)].append(code)

L = [
    "# Wave 0 — Audit Event Catalogue",
    "",
    "## Mechanism",
    "",
    "Evidence: `apps/audit/models.py`, `apps/audit/services.py`, `apps/audit/context.py` and `apps/audit/middleware.py`. The catalogue comes from an AST scan of every `record_audit_event(...)` call (`tools/inspect_audit.py`; raw output in `audit_event_inventory.tsv`).",
    "",
    "- **Single store.** `AuditLog`, written only through `record_audit_event(actor, action, institution, entity, metadata, ip, user_agent)`, which is the only `AuditLog.objects.create` call site. Each record carries:",
    "  - `entity_type` (model label) and `entity_id`;",
    "  - IP address and user agent, captured from request context by the middleware;",
    "  - a free-form JSON `metadata` field;",
    "  - a timestamp from `BaseModel.created_at`.",
    "- **Before/after.** There is no structured before/after column. Transitions conventionally store `{\"from\": ..., \"to\": ...}` through helpers (`accounting._transition`, `payroll._status_change_metadata`), and some events store changed field names. Field-level before/after is **not** captured for generic CRUD.",
    "- **Generic CRUD** through `TenantModelViewSet` is **not** audited automatically. Only service-layer actions are.",
    "- **Readers:** `GET /audit/` (`audit.view`), `GET /record-history/{type}/{id}/`, `GET /platform/audit/` (platform admin).",
    "",
    "### Integrity findings",
    "",
    "| ID | Finding | Action |",
    "|---|---|---|",
    "| AUD-01 | `AuditLog` is registered in Django admin with default (editable, deletable) `ModelAdmin`, and the model has no save/delete guard. The audit trail is not append-only. | W2: read-only admin (`has_change_permission`/`has_delete_permission` → False), a model `save()` refusing updates, and a `delete()` refusing deletes. Optionally a DB trigger on PostgreSQL. |",
    "| AUD-02 | No authentication or security events: login success/failure, logout, refresh, password change/reset and MFA challenge are all unaudited (only MFA setup/enable/disable/method change are). | W2 (new events below). |",
    "| AUD-03 | No events for employee create/update/deactivate, organization CRUD, leave type/policy config, schedule/shift config, module enable/disable, institution settings, or approval-workflow definition changes. | W2/W3 (new events below). |",
    "| AUD-04 | No consistent before/after schema. | W2: standard `metadata.changes = {field: [before, after]}` for updates and `metadata.transition = {from, to}` for state changes, through one helper. |",
    "",
    f"## Current catalogue ({len(events)} distinct actions in {len(rows)} call sites)",
    "",
]
for dom in sorted(by_domain):
    L.append(f"### {dom}")
    L.append("")
    L.append("| Action | Call site(s) | Metadata |")
    L.append("|---|---|---|")
    for code in by_domain[dom]:
        sites = events[code]
        loc = "; ".join(sorted({s for s, _ in sites}))
        meta = "yes" if any(m for _, m in sites) else "—"
        L.append(f"| `{code}` | {loc} | {meta} |")
    L.append("")

L += [
    "## New Phase 2 events (only the ones that do not already exist)",
    "",
    "Naming follows the existing `<domain>.<entity>.<verb>` convention. Every event needs:",
    "",
    "- an actor;",
    "- the institution (null for pre-tenant auth events);",
    "- the entity;",
    "- `metadata.transition` or `metadata.changes` as applicable.",
    "",
    "Secrets, OTP codes, tokens and passwords are **never** stored.",
    "",
    "| Event | Trigger | Required metadata | Wave |",
    "|---|---|---|---|",
    "| `account.login.succeeded` | successful login (after MFA) | method (password / totp / email_otp), remember flag; no token values | W2 |",
    "| `account.login.failed` | bad password / bad MFA code | reason code (`invalid_credentials`, `mfa_invalid`, `email_otp_invalid`), attempt count; email hash, not plaintext, when the user is unknown | W2 |",
    "| `account.mfa.email_otp.issued` | email OTP challenge created (login or enrolment) | purpose, masked destination, expires_at | W2 |",
    "| `account.mfa.email_otp.verified` / `.failed` / `.locked` | consume success / mismatch / max attempts reached | attempts | W2 |",
    "| `account.logout` | BFF logout (needs a backend call) | session id | W2 |",
    "| `account.session.revoked` | user or admin revokes a session/token family | session id, revoked_by, reason | W2 |",
    "| `account.password.changed` / `account.password.reset_requested` / `account.password.reset_completed` | password flows | — (never the password) | W2 |",
    "| `institution.module.enabled` / `institution.module.disabled` | module toggle | module_code, transition | W2 |",
    "| `institution.setting.changed` | institution settings PATCH | key, changes (masked if `is_sensitive`) | W2 |",
    "| `approval_workflow.created` / `.updated` / `.deactivated`; `approval_workflow_step.changed` | engine configuration | changes | W2 |",
    "| `approval.escalated` | overdue step reminder/escalation job | step, due_at, notified | W2 |",
    "| `employee.created` / `employee.updated` / `employee.deactivated` | HR CRUD | changes (PII fields masked in metadata) | W3 |",
    "| `leave.policy.changed`, `leave.type.changed` | leave configuration | changes | W3 |",
    "| `attendance.adjustment.blocked_finalized_payroll` | approval refused by LC-ATT-01 guard | payroll_run_id | W3 |",
    "| `payroll.run.returned_for_correction` | only if LC-PAY-01 is approved | note, transition | W5 |",
    "| `accounting.expense.returned`, `.manager_approved`, `.finance_reviewed`, `.recoded`, `.settled`, `.reversed` | Expense 2.0 transitions | transition; recoded = changes (account/category/tax); settled = settlement ref, bank account, journal id | W6 |",
    "| `accounting.journal.rejected` | only if LC-JNL-01 is approved | reason | W6 |",
    "| `accounting.module_mapping.changed` | institution override of a system mapping code (ERD-005 resolution) | mapping_code, changes | W6 |",
    "",
    "**Already exist — do not duplicate.** v3 listed these as Phase 2 examples, but they are already emitted:",
    "",
    "- job requisition submitted/approved/published: `recruitment.requisition.submitted/approved` and `recruitment.job_posting.published`;",
    "- attendance adjustment submitted/applied: `attendance.adjustment.requested/decided`;",
    "- payroll exception resolved: `payroll.exception.updated` (status in metadata);",
    "- reconciliation match/unmatch/completion: `accounting.bank_statement_line.matched/unmatched` and `accounting.reconciliation.completed`;",
    "- budget approval: `accounting.budget.approved/returned`.",
    "",
    "Budget *revision* has no event because budget revisions don't exist.",
]
(OUT / "audit_event_catalogue.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print(len(events), "events;", len(rows), "call sites")
