"""Overdue approval reminders and escalation (Wave 2). Notifies only: never approves or reassigns."""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.institutions.models import InstitutionMembership
from apps.notifications.models import Notification
from apps.workflows.engine import Trigger, resolve_definition
from apps.workflows.models import ApprovalRequest

OVERDUE_TYPE = "APPROVAL_OVERDUE"


def _role_holders(institution, role):
    if role is None:
        return []
    return [
        membership.user
        for membership in InstitutionMembership.objects.filter(institution=institution, role=role, status=InstitutionMembership.Status.ACTIVE).select_related("user")
    ]


def _send(institution, users, *, title, message, metadata):
    sent = set()
    for user in users:
        if user is None or user.pk in sent:
            continue
        sent.add(user.pk)
        Notification.objects.create(institution=institution, user=user, notification_type=OVERDUE_TYPE, title=title, message=message, channel=Notification.Channel.IN_APP, metadata=metadata)
    return len(sent)


def _already_escalated(institution, key, value):
    return Notification.objects.filter(institution=institution, notification_type=OVERDUE_TYPE, **{f"metadata__{key}": value}).exists()


def escalate_generic_requests(now):
    count = 0
    overdue = ApprovalRequest.objects.filter(status=ApprovalRequest.Status.PENDING, due_at__lt=now).select_related("institution", "workflow__escalation_role", "current_step__approver_user", "current_step__approver_role")
    for request in overdue:
        key = f"{request.id}:{request.current_step_id}"
        if _already_escalated(request.institution, "escalation_key", key):
            continue
        step = request.current_step
        approvers = [step.approver_user] if step.approver_user_id else _role_holders(request.institution, step.approver_role)
        approvers = [user for user in approvers if user.pk != request.requested_by_id]
        recipients = approvers + _role_holders(request.institution, request.workflow.escalation_role)
        with transaction.atomic():
            notified = _send(request.institution, recipients, title="Approval overdue", message=f"{request.workflow.name}: step {step.order} ({step.name}) passed its due time.", metadata={"approval_request_id": str(request.id), "escalation_key": key, "route_hint": "/approvals"})
            record_audit_event(actor=None, institution=request.institution, entity=request, action="approval.escalated", metadata={"step": step.order, "due_at": request.due_at.isoformat(), "notified": notified})
        count += 1
    return count


def _leave_step_started(approval):
    """Every leave step row is created at submit; a later step starts when the one before it was decided."""
    previous = approval.leave_request.approvals.filter(sequence__lt=approval.sequence).order_by("-sequence").first()
    if previous is None:
        return approval.created_at
    return previous.acted_at


def escalate_leave_steps(now):
    from apps.leave.models import LeaveApproval, LeaveRequest
    from apps.leave.services import _employment_on

    count = 0
    pending = LeaveApproval.objects.filter(status=LeaveApproval.Status.PENDING, leave_request__status=LeaveRequest.Status.PENDING).select_related("leave_request__institution", "leave_request__employee", "approver")
    for approval in pending:
        leave_request = approval.leave_request
        employment = _employment_on(leave_request.employee, leave_request.start_date)
        definition = resolve_definition(leave_request.institution, Trigger.LEAVE_REQUEST, department=employment.department if employment else None)
        step = definition.steps.filter(order=approval.sequence).first() if definition else None
        if step is None or not step.due_after_hours:
            continue
        started = _leave_step_started(approval)
        if started is None or started + timedelta(hours=step.due_after_hours) > now:
            # Not yet this step's turn, or still inside its due time.
            continue
        key = str(approval.id)
        if _already_escalated(leave_request.institution, "leave_approval_id", key):
            continue
        recipients = [approval.approver] + _role_holders(leave_request.institution, definition.escalation_role)
        with transaction.atomic():
            notified = _send(leave_request.institution, recipients, title="Leave approval overdue", message=f"Leave request for {leave_request.employee.full_name} is waiting past its due time.", metadata={"leave_request_id": str(leave_request.id), "leave_approval_id": key})
            record_audit_event(actor=None, institution=leave_request.institution, entity=leave_request, action="approval.escalated", metadata={"step": approval.sequence, "notified": notified})
        count += 1
    return count


def run_escalations(now=None):
    now = now or timezone.now()
    return {"generic": escalate_generic_requests(now), "leave": escalate_leave_steps(now)}
