from datetime import timedelta

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from apps.audit.services import record_audit_event
from apps.institutions.models import InstitutionMembership
from apps.notifications.models import Notification
from apps.workflows.models import ApprovalAction, ApprovalRequest

DECIDING_ACTIONS = (ApprovalAction.Action.APPROVE, ApprovalAction.Action.REJECT, ApprovalAction.Action.RETURN)


def _step_approvers(request, step):
    """Users who may decide ``step``: the named user or active holders of the role, never the requester."""
    if step.approver_user_id:
        users = [step.approver_user]
    elif step.approver_role_id:
        users = [
            membership.user
            for membership in InstitutionMembership.objects.filter(
                institution=request.institution, role_id=step.approver_role_id, status=InstitutionMembership.Status.ACTIVE
            ).select_related("user")
        ]
    else:
        users = []
    return [user for user in users if user.pk != request.requested_by_id]


def _notify(user, request, notification_type, title, message):
    Notification.objects.create(
        institution=request.institution,
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        channel=Notification.Channel.IN_APP,
        metadata={"approval_request_id": str(request.id), "route_hint": "/approvals"},
    )


def _enter_step(request, step):
    for user in _step_approvers(request, step):
        _notify(user, request, "APPROVAL_STEP_ASSIGNED", "Approval needed", f"{request.workflow.name}: step {step.order} ({step.name}) awaits your decision.")


@transaction.atomic
def submit_approval_request(*, institution, workflow, entity_type, entity_id, requested_by, metadata=None):
    if workflow.institution_id != institution.id or not workflow.is_active:
        raise ValidationError("The selected approval workflow is not active for this institution.")
    first_step = workflow.steps.order_by("order").first()
    if first_step is None:
        raise ValidationError("An approval workflow needs at least one step.")
    if workflow.steps.filter(approver_type__in=("REQUESTER_DEPARTMENT_HEAD", "REQUESTER_MANAGER")).exists():
        raise ValidationError("This workflow finds approvers from the requester's employment; submit it from its business record.")
    request = ApprovalRequest.objects.create(
        institution=institution, workflow=workflow, entity_type=entity_type,
        entity_id=entity_id, requested_by=requested_by, current_step=first_step,
        due_at=timezone.now() + timedelta(hours=first_step.due_after_hours) if first_step.due_after_hours else None,
        metadata=metadata or {},
    )
    record_audit_event(actor=requested_by, institution=institution, entity=request, action="APPROVAL_REQUESTED")
    _enter_step(request, first_step)
    return request


@transaction.atomic
def decide_approval_request(*, request, actor, action, comments=""):
    request = ApprovalRequest.objects.select_related("current_step", "workflow").select_for_update(of=("self",)).get(pk=request.pk)
    if request.status != ApprovalRequest.Status.PENDING or request.current_step_id is None:
        raise ValidationError("Only pending approval requests can be decided.")
    step = request.current_step
    if action not in (*DECIDING_ACTIONS, ApprovalAction.Action.CANCEL):
        raise ValidationError("Unsupported approval action.")
    if action == ApprovalAction.Action.CANCEL:
        if request.requested_by_id != actor.id:
            raise PermissionDenied("Only the requester can cancel an approval request.")
    else:
        if request.requested_by_id == actor.id:
            raise PermissionDenied("You cannot decide your own approval request.")
        is_assigned_user = step.approver_user_id == actor.id
        is_assigned_role = step.approver_role_id and actor.memberships.filter(institution=request.institution, role_id=step.approver_role_id, status="ACTIVE").exists()
        if not (is_assigned_user or is_assigned_role):
            raise PermissionDenied("You are not assigned to the current approval step.")
        if action == ApprovalAction.Action.RETURN and not comments.strip():
            raise ValidationError("Explain what needs to change.")
    ApprovalAction.objects.create(institution=request.institution, request=request, step=step, actor=actor, action=action, comments=comments)
    next_step = None
    if action == ApprovalAction.Action.APPROVE:
        next_step = request.workflow.steps.filter(order__gt=step.order).order_by("order").first()
        if next_step:
            request.current_step = next_step
            request.due_at = timezone.now() + timedelta(hours=next_step.due_after_hours) if next_step.due_after_hours else None
        else:
            request.status = ApprovalRequest.Status.APPROVED
            request.current_step = None
            request.completed_at = timezone.now()
    else:
        request.status = {
            ApprovalAction.Action.REJECT: ApprovalRequest.Status.REJECTED,
            ApprovalAction.Action.RETURN: ApprovalRequest.Status.RETURNED,
            ApprovalAction.Action.CANCEL: ApprovalRequest.Status.CANCELLED,
        }[action]
        request.current_step = None
        request.completed_at = timezone.now()
    request.save(update_fields=("status", "current_step", "due_at", "completed_at", "updated_at"))
    record_audit_event(actor=actor, institution=request.institution, entity=request, action=f"APPROVAL_{action}", metadata={"comments": comments})
    if next_step is not None:
        _enter_step(request, next_step)
    elif action != ApprovalAction.Action.CANCEL:
        outcome = request.get_status_display().lower()
        _notify(request.requested_by, request, "APPROVAL_DECIDED", f"Request {outcome}", comments or f"Your {request.workflow.name} request was {outcome}.")
    return request
