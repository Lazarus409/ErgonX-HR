"""Bounded approval engine (Wave 2, approved design in docs/phase2/wave0/approval_engine_gap_analysis.md §3).

The engine only answers "which definition applies?" and "who approves each
step?". Business records keep their own states and explicit actions; a domain
service asks the engine for the approver chain when a record is submitted.
Rules that always hold:

* the requester is never resolved as an approver of their own record;
* a read-only role never approves;
* a step that resolves to nobody fails closed (the submit is refused).
"""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from apps.institutions.models import InstitutionMembership
from apps.workflows.models import ApprovalWorkflowDefinition, ApprovalWorkflowStep
from common.exceptions import CodedValidationError

Trigger = ApprovalWorkflowDefinition.Trigger
ApproverType = ApprovalWorkflowStep.ApproverType

LEGACY_ENTITY_TYPES = {Trigger.LEAVE_REQUEST: ("leave.LeaveRequest", "LeaveRequest")}


def resolve_definition(institution, trigger, *, department=None, amount=None):
    """The active definition for ``trigger``: department-specific before general, inside the amount band."""
    candidates = ApprovalWorkflowDefinition.objects.filter(institution=institution, is_active=True).filter(
        Q(trigger=trigger) | Q(trigger__isnull=True, entity_type__in=LEGACY_ENTITY_TYPES.get(trigger, ()))
    )
    if department is not None:
        candidates = candidates.filter(Q(department__isnull=True) | Q(department=department))
    else:
        candidates = candidates.filter(department__isnull=True)
    if amount is not None:
        candidates = candidates.filter(Q(min_amount__isnull=True) | Q(min_amount__lte=amount)).filter(Q(max_amount__isnull=True) | Q(max_amount__gte=amount))
    else:
        candidates = candidates.filter(min_amount__isnull=True, max_amount__isnull=True)
    ordered = sorted(candidates.prefetch_related("steps"), key=lambda item: (item.department_id is None, item.created_at))
    return ordered[0] if ordered else None


def _active_member(user, institution):
    return user is not None and user.memberships.filter(institution=institution, status=InstitutionMembership.Status.ACTIVE).exists()


def department_head_of(department, *, exclude_employee_id=None, institution=None):
    """Head of ``department``, walking up to parents when the head is the requester or inactive."""
    seen = set()
    while department is not None and department.id not in seen:
        seen.add(department.id)
        head = department.head
        if department.is_active and head is not None and head.id != exclude_employee_id and _active_member(head.user, institution or department.institution):
            return head.user
        department = department.parent
    return None


def step_candidates(step, *, institution, requester, employment=None, employee_id=None):
    """Users who may decide ``step`` for this requester (never the requester, never read-only)."""
    if step.approver_type == ApproverType.USER:
        users = [step.approver_user] if _active_member(step.approver_user, institution) else []
    elif step.approver_type == ApproverType.ROLE:
        users = [
            membership.user
            for membership in InstitutionMembership.objects.filter(
                institution=institution, role=step.approver_role, status=InstitutionMembership.Status.ACTIVE
            ).select_related("user").order_by("joined_at", "created_at")
        ]
    elif step.approver_type == ApproverType.REQUESTER_DEPARTMENT_HEAD:
        department = employment.department if employment else None
        head = department_head_of(department, exclude_employee_id=employee_id, institution=institution)
        users = [head] if head else []
    else:  # REQUESTER_MANAGER
        manager = employment.reports_to.employee.user if employment and employment.reports_to_id else None
        users = [manager] if _active_member(manager, institution) else []
    read_only = set(
        InstitutionMembership.objects.filter(institution=institution, role__is_read_only=True).values_list("user_id", flat=True)
    )
    return [user for user in users if user is not None and user.pk != getattr(requester, "pk", None) and user.pk not in read_only]


def resolve_chain(definition, *, institution, requester, employment=None, employee_id=None):
    """One approver per step, in order. Fails closed when a step has nobody eligible."""
    chain = []
    for step in definition.steps.order_by("order"):
        candidates = step_candidates(step, institution=institution, requester=requester, employment=employment, employee_id=employee_id)
        if not candidates:
            raise CodedValidationError(
                {"approval": f"No eligible approver is available for step {step.order} ({step.name}). The requester cannot approve their own request."},
                api_code="policy_not_applicable",
            )
        chain.append((step, candidates[0]))
    return chain


def step_due_at(step, *, start=None):
    if not step.due_after_hours:
        return None
    return (start or timezone.now()) + timedelta(hours=step.due_after_hours)
