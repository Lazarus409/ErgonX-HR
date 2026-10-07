"""Cross-module approval inbox.

Each module keeps its own approval rules; this module only *collects* the
records that are waiting on the caller and tells the client which existing
module endpoint decides each one.  Nothing here changes a record, so every
approve/reject still runs through the owning module's service, with its own
permission, scope and separation-of-duties checks.

A record is listed when the module is enabled, the caller holds the module's
approve permission and the record is inside the caller's data scope.  Leave
is listed only when the caller owns the request's *current* approval step,
because that is the only person the leave service lets decide it.
"""

from dataclasses import dataclass
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from common.scoping import ATTENDANCE_BROAD, LEAVE_BROAD, INSTITUTION, data_scope, scope_to_employees

# Waiting longer than this is flagged in the summary; a display cue, not a policy.
STALE_AFTER = timedelta(days=3)
DECISION_LIMIT = 10


def _name(user):
    return (user.get_full_name() or user.email) if user else ""


def _action(code, label, path, *, comment_key=None, comment_required=False, tone="neutral"):
    return {"code": code, "label": label, "path": path, "comment_key": comment_key, "comment_required": comment_required, "tone": tone}


def _approve(path, comment_key=None):
    return _action("approve", "Approve", path, comment_key=comment_key, tone="success")


def _reject(path, comment_key=None, *, required=False):
    return _action("reject", "Reject", path, comment_key=comment_key, comment_required=required, tone="danger")


def _return(path, comment_key, label="Request changes"):
    return _action("return", label, path, comment_key=comment_key, comment_required=True, tone="warning")


def _item(*, kind, module, record, title, subtitle="", reference="", requested_by="", submitted_at=None, amount=None, currency="", route="", actions=(), blocked_reason="", note=""):
    return {
        "kind": kind,
        "module": module,
        "id": str(record.pk),
        "reference": reference or "",
        "title": title,
        "subtitle": subtitle,
        "requested_by": requested_by,
        "submitted_at": submitted_at or record.created_at,
        "amount": str(amount) if amount is not None else None,
        "currency": currency or "",
        "route": route,
        # A blocked item is listed so the caller knows it exists, but its
        # module will refuse this caller's decision (e.g. they submitted it).
        "actions": [] if blocked_reason else list(actions),
        "blocked_reason": blocked_reason,
        "note": note,
    }


@dataclass
class _Context:
    request: object
    user: object
    institution: object
    permissions: frozenset
    enabled: frozenset

    def can(self, module, permission):
        return module in self.enabled and permission in self.permissions


def _leave(ctx):
    if "LEAVE" not in ctx.enabled:
        return []
    from apps.dashboards.department import leave_awaiting_approval_by

    steps = leave_awaiting_approval_by(ctx.user, ctx.institution).select_related(
        "leave_request__employee", "leave_request__leave_type"
    )
    rows = []
    for step in steps:
        leave = step.leave_request
        days = f"{leave.requested_days.normalize():f}"
        base = f"/leave-requests/{leave.pk}"
        rows.append(_item(
            kind="LEAVE_REQUEST", module="LEAVE", record=leave,
            title=f"{leave.leave_type.name} · {leave.employee.full_name}",
            subtitle=f"{leave.start_date:%d %b} – {leave.end_date:%d %b %Y} · {days} day{'' if days == '1' else 's'}",
            requested_by=leave.employee.full_name, submitted_at=leave.submitted_at,
            route=f"/leave/requests/{leave.pk}",
            actions=(_approve(f"{base}/approve/", "comment"), _return(f"{base}/request-changes/", "comment"), _reject(f"{base}/reject/", "comment")),
        ))
    return rows


def _attendance(ctx):
    if not ctx.can("ATTENDANCE", "attendance.approve"):
        return []
    from apps.attendance.models import AttendanceAdjustment, OvertimeRecord

    rows = []
    adjustments = scope_to_employees(
        AttendanceAdjustment.objects.for_institution(ctx.institution).filter(status=AttendanceAdjustment.Status.PENDING),
        ctx.request, "attendance_record__employee", broad=ATTENDANCE_BROAD,
    ).filter(Q(assigned_to__isnull=True) | Q(assigned_to=ctx.user)).select_related("attendance_record__employee", "requested_by")
    for adjustment in adjustments:
        employee = adjustment.attendance_record.employee
        base = f"/attendance-adjustments/{adjustment.pk}"
        own = employee.user_id == ctx.user.id
        rows.append(_item(
            kind="ATTENDANCE_ADJUSTMENT", module="ATTENDANCE", record=adjustment,
            title=f"{adjustment.get_adjustment_type_display()} · {employee.full_name}",
            subtitle=f"Attendance on {adjustment.attendance_record.attendance_date:%d %b %Y}",
            requested_by=_name(adjustment.requested_by), submitted_at=adjustment.resubmitted_at or adjustment.created_at,
            route=f"/attendance/adjustments/{adjustment.pk}",
            actions=(_approve(f"{base}/approve/", "comment"), _return(f"{base}/request-changes/", "comment"), _reject(f"{base}/reject/", "comment")),
            blocked_reason="This is your own attendance; another approver must decide it." if own else "",
        ))
    overtime = scope_to_employees(
        OvertimeRecord.objects.for_institution(ctx.institution).filter(status=OvertimeRecord.Status.PENDING),
        ctx.request, broad=ATTENDANCE_BROAD,
    ).select_related("employee", "attendance_record")
    for record in overtime:
        hours = record.calculated_minutes / 60
        base = f"/overtime-records/{record.pk}"
        rows.append(_item(
            kind="OVERTIME", module="ATTENDANCE", record=record,
            title=f"Overtime · {record.employee.full_name}",
            subtitle=f"{hours:.1f} h on {record.attendance_record.attendance_date:%d %b %Y} at ×{record.rate_multiplier.normalize():f}",
            requested_by=record.employee.full_name,
            route="/attendance/overtime",
            actions=(_approve(f"{base}/approve/"), _reject(f"{base}/reject/")),
            blocked_reason="This is your own overtime; another approver must decide it." if record.employee.user_id == ctx.user.id else "",
        ))
    return rows


def _payroll(ctx):
    from apps.payroll.models import EmployeeTaxReliefClaim, PayrollAdjustment, PayrollRun

    rows = []
    if ctx.can("PAYROLL", "payroll.approve"):
        for run in PayrollRun.objects.for_institution(ctx.institution).filter(status=PayrollRun.Status.UNDER_REVIEW).select_related("payroll_period", "started_by"):
            rows.append(_item(
                kind="PAYROLL_RUN", module="PAYROLL", record=run,
                title=f"Payroll run · {run.payroll_period.name}",
                subtitle=f"Pay date {run.payroll_period.pay_date:%d %b %Y}",
                reference=f"PR-{run.payroll_period.start_date:%Y%m}-{run.run_number:02d}",
                requested_by=_name(run.started_by), submitted_at=run.updated_at,
                route=f"/payroll/runs/{run.pk}",
                # Runs carry exceptions and reconciliation checks: always decided on the run page.
                note="Open the run to check exceptions and reconciliation before approving.",
            ))
        adjustments = PayrollAdjustment.objects.for_institution(ctx.institution).filter(status=PayrollAdjustment.Status.PENDING).select_related("employee", "pay_component", "payroll_period", "created_by")
        for adjustment in adjustments:
            base = f"/payroll-adjustments/{adjustment.pk}"
            rows.append(_item(
                kind="PAYROLL_ADJUSTMENT", module="PAYROLL", record=adjustment,
                title=f"{adjustment.pay_component.name} · {adjustment.employee.full_name}",
                subtitle=f"{adjustment.payroll_period.name} · {adjustment.reason}"[:200],
                requested_by=_name(adjustment.created_by), amount=adjustment.amount, currency=ctx.institution.default_currency,
                route="/payroll/adjustments",
                actions=(_approve(f"{base}/approve/"), _reject(f"{base}/reject/")),
            ))
    if ctx.can("PAYROLL", "tax_relief.approve"):
        claims = EmployeeTaxReliefClaim.objects.for_institution(ctx.institution).filter(status=EmployeeTaxReliefClaim.Status.PENDING).select_related("employee", "relief_definition")
        for claim in claims:
            base = f"/employee-tax-relief-claims/{claim.pk}"
            rows.append(_item(
                kind="TAX_RELIEF_CLAIM", module="PAYROLL", record=claim,
                title=f"{claim.relief_definition.name} · {claim.employee.full_name}",
                subtitle=f"Tax year {claim.tax_year}",
                requested_by=claim.employee.full_name, amount=claim.claimed_amount, currency=ctx.institution.default_currency,
                actions=(_approve(f"{base}/approve/"), _reject(f"{base}/reject/")),
            ))
    return rows


def _recruitment(ctx):
    from apps.recruitment.models import JobPosting, Offer

    rows = []
    if ctx.can("RECRUITMENT", "job_posting.approve"):
        for posting in JobPosting.objects.for_institution(ctx.institution).filter(status=JobPosting.Status.PENDING_APPROVAL).select_related("department", "submitted_by"):
            base = f"/recruitment/job-postings/{posting.pk}"
            rows.append(_item(
                kind="REQUISITION", module="RECRUITMENT", record=posting,
                title=f"Requisition · {posting.title}",
                subtitle=f"{posting.department.name} · {posting.openings} opening{'' if posting.openings == 1 else 's'}",
                reference=posting.code, requested_by=_name(posting.submitted_by), submitted_at=posting.submitted_at,
                route=f"/recruitment/job-postings/{posting.pk}",
                actions=(_approve(f"{base}/approve/", "comment"), _return(f"{base}/return/", "comment", "Return")),
                blocked_reason="You submitted this requisition; another approver must decide it." if posting.submitted_by_id == ctx.user.id else "",
            ))
    if ctx.can("RECRUITMENT", "offer.approve"):
        offers = Offer.objects.for_institution(ctx.institution).filter(status=Offer.Status.PENDING_APPROVAL).select_related("application__candidate", "position", "submitted_by")
        for offer in offers:
            base = f"/recruitment/offers/{offer.pk}"
            rows.append(_item(
                kind="OFFER", module="RECRUITMENT", record=offer,
                title=f"Offer · {offer.application.candidate.full_name}",
                subtitle=f"{offer.position.title} · starts {offer.proposed_start_date:%d %b %Y}",
                requested_by=_name(offer.submitted_by), submitted_at=offer.submitted_at,
                amount=offer.base_salary, currency=offer.currency,
                route=f"/recruitment/offers/{offer.pk}",
                actions=(_approve(f"{base}/approve/", "comment"), _return(f"{base}/return/", "comment", "Return")),
                blocked_reason="You submitted this offer; another approver must decide it." if offer.submitted_by_id == ctx.user.id else "",
            ))
    return rows


def _accounting(ctx):
    from apps.accounting.models import Budget, Expense, JournalEntry, VendorBill

    rows = []
    if ctx.can("ACCOUNTING", "journal.approve"):
        for journal in JournalEntry.objects.for_institution(ctx.institution).filter(status=JournalEntry.Status.PENDING_APPROVAL).select_related("created_by"):
            rows.append(_item(
                kind="JOURNAL", module="ACCOUNTING", record=journal,
                title=f"Journal · {journal.description}"[:160],
                subtitle=f"{journal.get_source_display()} · dated {journal.entry_date:%d %b %Y}",
                reference=journal.journal_number, requested_by=_name(journal.created_by), submitted_at=journal.updated_at,
                route=f"/accounting/journals/{journal.pk}",
                actions=(_approve(f"/journal-entries/{journal.pk}/approve/"),),
            ))
    if ctx.can("ACCOUNTING", "vendor_bill.approve"):
        for bill in VendorBill.objects.for_institution(ctx.institution).filter(status=VendorBill.Status.PENDING).select_related("vendor", "submitted_by"):
            base = f"/vendor-bills/{bill.pk}"
            rows.append(_item(
                kind="VENDOR_BILL", module="ACCOUNTING", record=bill,
                title=f"Vendor bill · {bill.vendor.name}",
                subtitle=f"Due {bill.due_date:%d %b %Y}",
                reference=bill.bill_number, requested_by=_name(bill.submitted_by), submitted_at=bill.submitted_at,
                amount=bill.total_amount, currency=bill.currency,
                route=f"/accounting/payables/bills/{bill.pk}",
                actions=(_approve(f"{base}/approve/"), _reject(f"{base}/reject/", "reason", required=True)),
                blocked_reason="On hold — release the hold on the bill before approving." if bill.on_hold else "",
            ))
    if ctx.can("ACCOUNTING", "expense.approve"):
        # Finance-entered expenses (no claimant) keep the one-step approval.
        for expense in Expense.objects.for_institution(ctx.institution).filter(status=Expense.Status.PENDING, claimant__isnull=True).select_related("account", "created_by"):
            base = f"/expenses/{expense.pk}"
            rows.append(_item(
                kind="EXPENSE", module="ACCOUNTING", record=expense,
                title=f"Expense · {expense.description}"[:160],
                subtitle=f"{expense.account.name if expense.account_id else 'Expense'} · {expense.expense_date:%d %b %Y}",
                requested_by=_name(expense.created_by), submitted_at=expense.submitted_at or expense.updated_at,
                amount=expense.amount, currency=expense.currency,
                route="/accounting/expenses",
                actions=(_approve(f"{base}/approve/"), _reject(f"{base}/reject/", "comment")),
                blocked_reason="You created this expense; another approver must decide it." if expense.created_by_id == ctx.user.id else "",
            ))
    if "ACCOUNTING" in ctx.enabled:
        # Expense claims whose current manager step belongs to the caller (Expense 2.0).
        from apps.accounting.models import ExpenseApproval

        steps = ExpenseApproval.objects.filter(
            institution=ctx.institution, approver=ctx.user, status=ExpenseApproval.Status.PENDING, expense__status=Expense.Status.PENDING,
        ).select_related("expense__claimant")
        for step in steps:
            expense = step.expense
            if expense.approvals.filter(status=ExpenseApproval.Status.PENDING, sequence__lt=step.sequence).exists():
                continue  # an earlier step is still open
            base = f"/expenses/{expense.pk}"
            rows.append(_item(
                kind="EXPENSE_CLAIM", module="ACCOUNTING", record=expense,
                title=f"Expense claim · {expense.claimant.full_name}",
                subtitle=f"{step.step_name} · {expense.description}"[:160],
                requested_by=expense.claimant.full_name, submitted_at=expense.submitted_at or expense.updated_at,
                amount=expense.amount, currency=expense.currency,
                route="/approvals",
                actions=(_approve(f"{base}/approve/"), _return(f"{base}/return/", "comment", "Return"), _reject(f"{base}/reject/", "comment", required=True)),
            ))
    if ctx.can("ACCOUNTING", "expense.finance_review"):
        # Finance review recodes and checks policy on the record page.
        for expense in Expense.objects.for_institution(ctx.institution).filter(status=Expense.Status.FINANCE_REVIEW).select_related("claimant"):
            rows.append(_item(
                kind="EXPENSE_CLAIM", module="ACCOUNTING", record=expense,
                title=f"Finance review · {expense.claimant.full_name if expense.claimant_id else expense.description}"[:160],
                subtitle=expense.description[:160],
                requested_by=expense.claimant.full_name if expense.claimant_id else "", submitted_at=expense.submitted_at or expense.updated_at,
                amount=expense.amount, currency=expense.currency,
                route=f"/accounting/expenses?review={expense.pk}",
                blocked_reason="You claimed this expense; another reviewer must decide it." if expense.claimant_id and expense.claimant.user_id == ctx.user.id else "",
            ))
    if ctx.can("ACCOUNTING", "budget.approve"):
        for budget in Budget.objects.for_institution(ctx.institution).filter(status=Budget.Status.PENDING_APPROVAL).select_related("fiscal_year", "department", "submitted_by"):
            base = f"/budgets/{budget.pk}"
            scope = budget.department.name if budget.department else "Institution-wide"
            rows.append(_item(
                kind="BUDGET", module="ACCOUNTING", record=budget,
                title=f"Budget · {budget.name}",
                subtitle=f"{budget.fiscal_year.name} · {scope} · v{budget.version}",
                reference=budget.code, requested_by=_name(budget.submitted_by), submitted_at=budget.submitted_at,
                route=f"/accounting/budgets/{budget.pk}",
                actions=(_approve(f"{base}/approve/", "note"), _return(f"{base}/return/", "note", "Return")),
                blocked_reason="You submitted this budget; another approver must decide it." if budget.submitted_by_id == ctx.user.id else "",
            ))
    return rows


def _workflow_requests(ctx):
    from apps.workflows.models import ApprovalRequest

    membership = getattr(ctx.request, "membership", None)
    role_id = membership.role_id if membership else None
    requests = ApprovalRequest.objects.for_institution(ctx.institution).filter(
        status=ApprovalRequest.Status.PENDING, current_step__isnull=False,
    ).filter(Q(current_step__approver_user=ctx.user) | Q(current_step__approver_role_id=role_id)).select_related("workflow", "current_step", "requested_by")
    rows = []
    for item in requests:
        base = f"/approval-requests/{item.pk}"
        rows.append(_item(
            kind="WORKFLOW_REQUEST", module="WORKFLOW", record=item,
            title=f"{item.workflow.name} · {item.entity_type}",
            subtitle=f"Step: {item.current_step.name}",
            requested_by=_name(item.requested_by),
            actions=(_approve(f"{base}/approve/", "comments"), _reject(f"{base}/reject/", "comments")),
        ))
    return rows


COLLECTORS = (_leave, _attendance, _payroll, _recruitment, _accounting, _workflow_requests)

# audit action -> (kind, outcome); "decided" actions read the outcome from metadata.
DECISION_ACTIONS = {
    "leave.request.approved_step": ("LEAVE_REQUEST", "APPROVED"),
    "leave.request.rejected": ("LEAVE_REQUEST", "REJECTED"),
    "leave.request.changes_requested": ("LEAVE_REQUEST", "RETURNED"),
    "attendance.adjustment.decided": ("ATTENDANCE_ADJUSTMENT", None),
    "attendance.adjustment.returned": ("ATTENDANCE_ADJUSTMENT", "RETURNED"),
    "attendance.overtime.decided": ("OVERTIME", None),
    "payroll.run.approved": ("PAYROLL_RUN", "APPROVED"),
    "payroll.adjustment.approved": ("PAYROLL_ADJUSTMENT", "APPROVED"),
    "payroll.adjustment.rejected": ("PAYROLL_ADJUSTMENT", "REJECTED"),
    "recruitment.requisition.approved": ("REQUISITION", "APPROVED"),
    "recruitment.requisition.returned": ("REQUISITION", "RETURNED"),
    "recruitment.offer.approved": ("OFFER", "APPROVED"),
    "recruitment.offer.returned": ("OFFER", "RETURNED"),
    "accounting.journal.approved": ("JOURNAL", "APPROVED"),
    "accounting.vendor_bill.approved": ("VENDOR_BILL", "APPROVED"),
    "accounting.vendor_bill.rejected": ("VENDOR_BILL", "REJECTED"),
    "accounting.expense.approved": ("EXPENSE", "APPROVED"),
    "accounting.expense.rejected": ("EXPENSE", "REJECTED"),
    "accounting.expense.manager_approved": ("EXPENSE_CLAIM", "APPROVED"),
    "accounting.expense.step_approved": ("EXPENSE_CLAIM", "APPROVED"),
    "accounting.expense.returned": ("EXPENSE_CLAIM", "RETURNED"),
    "accounting.expense.finance_reviewed": ("EXPENSE_CLAIM", None),
    "accounting.budget.approved": ("BUDGET", "APPROVED"),
    "accounting.budget.returned": ("BUDGET", "RETURNED"),
    "APPROVAL_APPROVE": ("WORKFLOW_REQUEST", "APPROVED"),
    "APPROVAL_REJECT": ("WORKFLOW_REQUEST", "REJECTED"),
}

# kind -> (module, approve permission, label, route builder or None)
KINDS = {
    "LEAVE_REQUEST": ("LEAVE", "leave.approve", "Leave request", lambda pk: f"/leave/requests/{pk}"),
    "ATTENDANCE_ADJUSTMENT": ("ATTENDANCE", "attendance.approve", "Attendance correction", lambda pk: f"/attendance/adjustments/{pk}"),
    "OVERTIME": ("ATTENDANCE", "attendance.approve", "Overtime", lambda pk: "/attendance/overtime"),
    "PAYROLL_RUN": ("PAYROLL", "payroll.approve", "Payroll run", lambda pk: f"/payroll/runs/{pk}"),
    "PAYROLL_ADJUSTMENT": ("PAYROLL", "payroll.approve", "Payroll adjustment", lambda pk: "/payroll/adjustments"),
    "TAX_RELIEF_CLAIM": ("PAYROLL", "tax_relief.approve", "Tax relief claim", None),
    "REQUISITION": ("RECRUITMENT", "job_posting.approve", "Requisition", lambda pk: f"/recruitment/job-postings/{pk}"),
    "OFFER": ("RECRUITMENT", "offer.approve", "Offer", lambda pk: f"/recruitment/offers/{pk}"),
    "JOURNAL": ("ACCOUNTING", "journal.approve", "Journal", lambda pk: f"/accounting/journals/{pk}"),
    "VENDOR_BILL": ("ACCOUNTING", "vendor_bill.approve", "Vendor bill", lambda pk: f"/accounting/payables/bills/{pk}"),
    "EXPENSE": ("ACCOUNTING", "expense.approve", "Expense", lambda pk: "/accounting/expenses"),
    "EXPENSE_CLAIM": ("ACCOUNTING", "expense.claim_own", "Expense claim", lambda pk: "/accounting/expenses"),
    "BUDGET": ("ACCOUNTING", "budget.approve", "Budget", lambda pk: f"/accounting/budgets/{pk}"),
    "WORKFLOW_REQUEST": ("WORKFLOW", None, "Workflow request", None),
}


def _decisions(ctx):
    """Recent decisions the caller may see.

    Institution-scoped members see every decision for the record families they
    approve; everyone else (department heads, and members who only hold a step
    in someone's leave chain) sees their own decisions.
    """
    from apps.audit.models import AuditLog

    institution_wide = data_scope(ctx.request) == INSTITUTION
    visible_actions = []
    for action, (kind, _) in DECISION_ACTIONS.items():
        module, permission, _label, _route = KINDS[kind]
        if module != "WORKFLOW" and module not in ctx.enabled:
            continue
        visible_actions.append((action, institution_wide and permission is not None and permission in ctx.permissions and (kind != "LEAVE_REQUEST" or bool(ctx.permissions & set(LEAVE_BROAD)))))
    broad = [action for action, wide in visible_actions if wide]
    own = [action for action, wide in visible_actions if not wide]
    events = (
        AuditLog.objects.filter(institution=ctx.institution)
        .filter(Q(action__in=broad) | Q(action__in=own, actor=ctx.user))
        .select_related("actor")
        .order_by("-created_at")[:DECISION_LIMIT]
    )
    rows = []
    for event in events:
        kind, outcome = DECISION_ACTIONS[event.action]
        if outcome is None:
            outcome = str(event.metadata.get("status") or "DECIDED")
        elif event.action == "leave.request.approved_step" and event.metadata.get("final_status") == "PENDING":
            # One step of a multi-step chain: the request moved on to the next approver.
            outcome = "FORWARDED"
        _module, _permission, label, route = KINDS[kind]
        comment = event.metadata.get("comment") or event.metadata.get("note") or event.metadata.get("comments") or event.metadata.get("reason") or ""
        rows.append({
            "id": str(event.pk),
            "kind": kind,
            "module": KINDS[kind][0],
            "label": label,
            "entity_id": str(event.entity_id) if event.entity_id else None,
            "outcome": outcome,
            "actor_name": _name(event.actor),
            "is_mine": event.actor_id == ctx.user.id,
            "acted_at": event.created_at,
            "comment": str(comment),
            "route": route(event.entity_id) if route and event.entity_id else "",
        })
    return rows


def approval_inbox(request, *, permission_codes):
    institution = request.institution
    ctx = _Context(
        request=request,
        user=request.user,
        institution=institution,
        permissions=frozenset(permission_codes),
        enabled=frozenset(institution.modules.filter(is_enabled=True).values_list("module_code", flat=True)),
    )
    items = [row for collect in COLLECTORS for row in collect(ctx)]
    items.sort(key=lambda row: row["submitted_at"])
    now = timezone.now()
    by_module = {}
    for row in items:
        by_module[row["module"]] = by_module.get(row["module"], 0) + 1
    actionable = [row for row in items if row["actions"]]
    return {
        "generated_at": now,
        "summary": {
            "total": len(items),
            "actionable": len(actionable),
            "needs_review": len([row for row in items if not row["actions"] and not row["blocked_reason"]]),
            "blocked": len([row for row in items if row["blocked_reason"]]),
            "waiting_over_3_days": len([row for row in items if now - row["submitted_at"] > STALE_AFTER]),
            "oldest_submitted_at": items[0]["submitted_at"] if items else None,
            "by_module": [{"module": module, "count": count} for module, count in sorted(by_module.items(), key=lambda pair: -pair[1])],
        },
        "items": items,
        "decisions": _decisions(ctx),
    }
