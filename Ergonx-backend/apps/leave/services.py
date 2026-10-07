from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone

from apps.employees.models import Employment
from apps.audit.services import record_audit_event
from apps.institutions.models import InstitutionMembership
from apps.institutions.services import record_user_activity
from apps.leave.models import (
    LeaveRequestComment,
    LeaveApproval,
    LeaveBalance,
    LeavePolicy,
    LeavePolicyDepartmentEligibility,
    LeavePolicyEmploymentTypeEligibility,
    LeavePolicyGenderEligibility,
    LeavePolicyGradeEligibility,
    LeavePolicyLocationEligibility,
    LeaveRequest,
)
from apps.workflows.engine import Trigger, department_head_of, resolve_chain, resolve_definition
from apps.notifications.models import Notification


ELIGIBILITY_MODELS = {
    "eligible_departments": (LeavePolicyDepartmentEligibility, "department"),
    "eligible_grades": (LeavePolicyGradeEligibility, "grade"),
    "eligible_locations": (LeavePolicyLocationEligibility, "location"),
    "eligible_employment_types": (
        LeavePolicyEmploymentTypeEligibility,
        "employment_type",
    ),
    "eligible_genders": (LeavePolicyGenderEligibility, "gender"),
}


def _active_membership(user, institution):
    return user.memberships.filter(
        institution=institution, status=InstitutionMembership.Status.ACTIVE
    ).select_related("role").first()


def _employment_on(employee, on_date):
    return (
        Employment.objects.filter(
            employee=employee,
            start_date__lte=on_date,
        )
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=on_date))
        .select_related("department__head__user", "grade", "location", "reports_to__employee__user")
        .order_by("-is_current", "-start_date")
        .first()
    )


def matching_policy(leave_request):
    return applicable_policy(
        employee=leave_request.employee,
        leave_type=leave_request.leave_type,
        effective_from=leave_request.start_date,
        effective_to=leave_request.end_date,
    )


def applicable_policy(*, employee, leave_type, effective_from, effective_to=None):
    effective_to = effective_to or effective_from
    employment = _employment_on(employee, effective_from)
    if employment is None:
        raise ValidationError(
            {"employee": "Employee has no employment covering the requested dates."}
        )
    policies = (
        LeavePolicy.objects.filter(
            institution=employee.institution,
            leave_type=leave_type,
            is_active=True,
            effective_from__lte=effective_from,
        )
        .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=effective_to))
        .order_by("-effective_from", "-created_at")
    )
    for policy in policies:
        if policy.applies_to(employee, employment, effective_from):
            return policy
    raise ValidationError(
        {"leave_type": "No active leave policy applies to this employee and date range."}
    )


def validate_request_against_policy(leave_request):
    leave_request.full_clean()
    policy = matching_policy(leave_request)
    if policy.max_consecutive_days is not None:
        if leave_request.requested_days > policy.max_consecutive_days:
            raise ValidationError(
                {
                    "requested_days": (
                        "Requested days exceed the policy's maximum consecutive allowance."
                    )
                }
            )
    if (
        leave_request.leave_type.requires_attachment or policy.requires_document
    ) and not leave_request.attachment_id:
        raise ValidationError({"attachment": "This leave request requires a document."})
    return policy


def _locked_balance(leave_request, policy):
    initial_accrual = (
        policy.annual_entitlement
        if policy.accrual_method
        in {LeavePolicy.AccrualMethod.NONE, LeavePolicy.AccrualMethod.ANNUAL}
        else Decimal("0")
    )
    balance, _ = LeaveBalance.objects.select_for_update().get_or_create(
        institution=leave_request.institution,
        employee=leave_request.employee,
        leave_type=leave_request.leave_type,
        year=leave_request.start_date.year,
        defaults={"accrued": initial_accrual},
    )
    return balance


def _ensure_sufficient_balance(leave_request, policy):
    balance = _locked_balance(leave_request, policy)
    if not policy.allow_negative_balance and balance.available < leave_request.requested_days:
        raise ValidationError(
            {
                "requested_days": (
                    f"Insufficient leave balance; {balance.available} day(s) available."
                )
            }
        )
    return balance


def _consume_balance(leave_request, policy):
    balance = _ensure_sufficient_balance(leave_request, policy)
    balance.used += leave_request.requested_days
    balance.save(update_fields=("used", "updated_at"))
    return balance


def _restore_balance(leave_request):
    balance = LeaveBalance.objects.select_for_update().get(
        employee=leave_request.employee,
        leave_type=leave_request.leave_type,
        year=leave_request.start_date.year,
    )
    balance.used = max(Decimal("0"), balance.used - leave_request.requested_days)
    balance.save(update_fields=("used", "updated_at"))


def _is_active_member(user, institution):
    return user is not None and user.memberships.filter(
        institution=institution, status=InstitutionMembership.Status.ACTIVE
    ).exists()


def _department_head_approver(leave_request):
    """Head of the requester's department, escalating to parent departments.

    A head never approves their own request: when the requester heads their own
    department the search continues with the parent department's head.
    """
    employment = _employment_on(leave_request.employee, leave_request.start_date)
    return department_head_of(
        employment.department if employment else None,
        exclude_employee_id=leave_request.employee_id,
        institution=leave_request.institution,
    )


def _configured_approvers(leave_request):
    employment = _employment_on(leave_request.employee, leave_request.start_date)
    # The approval engine picks the leave workflow (department-specific first)
    # and never returns the requester as their own approver.
    definition = resolve_definition(
        leave_request.institution,
        Trigger.LEAVE_REQUEST,
        department=employment.department if employment else None,
    )
    if definition and definition.steps.exists():
        return [
            approver
            for _, approver in resolve_chain(
                definition,
                institution=leave_request.institution,
                requester=leave_request.employee.user,
                employment=employment,
                employee_id=leave_request.employee_id,
            )
        ]

    requester = leave_request.employee.user
    fallback = []
    first_approver = _department_head_approver(leave_request)
    if first_approver is None:
        employment = _employment_on(leave_request.employee, leave_request.start_date)
        if employment and employment.reports_to_id:
            first_approver = employment.reports_to.employee.user
    if first_approver and first_approver != requester:
        fallback.append(first_approver)
    hr_membership = (
        InstitutionMembership.objects.filter(
            institution=leave_request.institution,
            role__code="HR_ADMIN",
            status=InstitutionMembership.Status.ACTIVE,
        )
        .select_related("user")
        .order_by("joined_at", "created_at")
        .first()
    )
    if hr_membership and hr_membership.user not in fallback and hr_membership.user != requester:
        fallback.append(hr_membership.user)
    if not fallback:
        # e.g. the only HR admin, with no head or manager: an institution admin decides.
        admin_membership = (
            InstitutionMembership.objects.filter(
                institution=leave_request.institution,
                role__code="INSTITUTION_ADMIN",
                status=InstitutionMembership.Status.ACTIVE,
            )
            .exclude(user=requester)
            .select_related("user")
            .order_by("joined_at", "created_at")
            .first()
        )
        if admin_membership:
            fallback.append(admin_membership.user)
    if not fallback:
        raise ValidationError(
            {"approval": "No configured workflow, manager, or active HR approver exists."}
        )
    return fallback


def _notify(user, leave_request, notification_type, title, message):
    if user is None:
        return
    Notification.objects.create(
        institution=leave_request.institution,
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        channel=Notification.Channel.IN_APP,
        metadata={"leave_request_id": str(leave_request.id)},
    )


@transaction.atomic
def configure_policy(*, institution, eligibility=None, policy=None, **values):
    if policy is None:
        policy = LeavePolicy(institution=institution, **values)
    else:
        if policy.institution_id != institution.id:
            raise ValidationError({"policy": "Policy belongs to another institution."})
        for field, value in values.items():
            setattr(policy, field, value)
    policy.save()

    if eligibility is not None:
        for key, (model, field_name) in ELIGIBILITY_MODELS.items():
            if key not in eligibility:
                continue
            model.objects.filter(policy=policy).delete()
            for value in eligibility[key]:
                relation_value = getattr(value, "pk", value)
                model.objects.create(
                    institution=institution,
                    policy=policy,
                    **{field_name: value if hasattr(value, "pk") else relation_value},
                )
    return policy


@transaction.atomic
def create_leave_request(*, institution, actor, **values):
    membership = _active_membership(actor, institution)
    if membership is None:
        raise ValidationError({"actor": "Requester must be an active institution member."})
    employee = values.get("employee")
    if employee and employee.user_id != actor.id and not membership.role.permissions.filter(
        code="leave.configure"
    ).exists():
        raise ValidationError({"employee": "Requester may only create their own leave request."})
    leave_request = LeaveRequest(institution=institution, status=LeaveRequest.Status.DRAFT, **values)
    validate_request_against_policy(leave_request)
    leave_request.save()
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=leave_request,
        action="leave.request.created",
    )
    record_user_activity(
        actor=actor,
        institution=institution,
        activity_code="leave.request",
        entity=leave_request,
    )
    return leave_request


@transaction.atomic
def submit_leave_request(*, leave_request, actor):
    leave_request = LeaveRequest.objects.select_for_update().get(pk=leave_request.pk)
    if leave_request.status != LeaveRequest.Status.DRAFT:
        raise ValidationError({"status": "Only draft requests can be submitted."})
    membership = _active_membership(actor, leave_request.institution)
    if membership is None:
        raise ValidationError({"actor": "Requester must be an active institution member."})
    if leave_request.employee.user_id != actor.id and not membership.role.permissions.filter(
        code="leave.configure"
    ).exists():
        raise ValidationError({"employee": "Requester may only submit their own leave request."})

    policy = validate_request_against_policy(leave_request)
    _ensure_sufficient_balance(leave_request, policy)
    leave_request.submitted_at = timezone.now()
    if leave_request.leave_type.requires_approval:
        leave_request.status = LeaveRequest.Status.PENDING
        leave_request.save(update_fields=("status", "submitted_at", "updated_at"))
        approvers = _configured_approvers(leave_request)
        prior_steps = leave_request.approvals.aggregate(last=models.Max("sequence"))["last"] or 0
        for sequence, approver in enumerate(approvers, start=prior_steps + 1):
            LeaveApproval.objects.create(
                institution=leave_request.institution,
                leave_request=leave_request,
                approver=approver,
                sequence=sequence,
            )
        _notify(
            approvers[0],
            leave_request,
            "LEAVE_APPROVAL_REQUIRED",
            "Leave approval required",
            f"Leave request for {leave_request.employee.full_name} requires review.",
        )
    else:
        _consume_balance(leave_request, policy)
        leave_request.status = LeaveRequest.Status.APPROVED
        leave_request.save(update_fields=("status", "submitted_at", "updated_at"))
        _notify(
            leave_request.employee.user,
            leave_request,
            "LEAVE_APPROVED",
            "Leave approved",
            "Your leave request was approved automatically.",
        )
    record_audit_event(
        actor=actor,
        institution=leave_request.institution,
        entity=leave_request,
        action="leave.request.submitted",
        metadata={"status": leave_request.status},
    )
    return leave_request


@transaction.atomic
def approve_leave_request(*, leave_request, actor, comment=""):
    leave_request = LeaveRequest.objects.select_for_update().get(pk=leave_request.pk)
    if leave_request.status != LeaveRequest.Status.PENDING:
        raise ValidationError({"status": "Only pending requests can be approved."})
    approval = (
        LeaveApproval.objects.select_for_update()
        .filter(leave_request=leave_request, status=LeaveApproval.Status.PENDING)
        .order_by("sequence")
        .first()
    )
    if approval is None or approval.approver_id != actor.id:
        raise ValidationError({"approver": "This is not the actor's active approval step."})
    approval.status = LeaveApproval.Status.APPROVED
    approval.comment = comment
    approval.acted_at = timezone.now()
    approval.save(update_fields=("status", "comment", "acted_at", "updated_at"))

    if not LeaveApproval.objects.filter(
        leave_request=leave_request, status=LeaveApproval.Status.PENDING
    ).exists():
        policy = validate_request_against_policy(leave_request)
        _consume_balance(leave_request, policy)
        leave_request.status = LeaveRequest.Status.APPROVED
        leave_request.save(update_fields=("status", "updated_at"))
        _notify(
            leave_request.employee.user,
            leave_request,
            "LEAVE_APPROVED",
            "Leave approved",
            "Your leave request has been approved.",
        )
    else:
        next_approval = LeaveApproval.objects.filter(
            leave_request=leave_request, status=LeaveApproval.Status.PENDING
        ).order_by("sequence").first()
        if next_approval:
            _notify(
                next_approval.approver,
                leave_request,
                "LEAVE_APPROVAL_REQUIRED",
                "Leave approval required",
                f"Leave request for {leave_request.employee.full_name} requires review.",
            )
    record_audit_event(
        actor=actor,
        institution=leave_request.institution,
        entity=leave_request,
        action="leave.request.approved_step",
        metadata={"sequence": approval.sequence, "final_status": leave_request.status},
    )
    return leave_request


@transaction.atomic
def reject_leave_request(*, leave_request, actor, comment=""):
    leave_request = LeaveRequest.objects.select_for_update().get(pk=leave_request.pk)
    if leave_request.status != LeaveRequest.Status.PENDING:
        raise ValidationError({"status": "Only pending requests can be rejected."})
    approval = (
        LeaveApproval.objects.select_for_update()
        .filter(leave_request=leave_request, status=LeaveApproval.Status.PENDING)
        .order_by("sequence")
        .first()
    )
    if approval is None or approval.approver_id != actor.id:
        raise ValidationError({"approver": "This is not the actor's active approval step."})
    approval.status = LeaveApproval.Status.REJECTED
    approval.comment = comment
    approval.acted_at = timezone.now()
    approval.save(update_fields=("status", "comment", "acted_at", "updated_at"))
    LeaveApproval.objects.filter(
        leave_request=leave_request, status=LeaveApproval.Status.PENDING
    ).update(status=LeaveApproval.Status.SKIPPED, updated_at=timezone.now())
    leave_request.status = LeaveRequest.Status.REJECTED
    leave_request.save(update_fields=("status", "updated_at"))
    _notify(
        leave_request.employee.user,
        leave_request,
        "LEAVE_REJECTED",
        "Leave rejected",
        "Your leave request has been rejected.",
    )
    record_audit_event(
        actor=actor,
        institution=leave_request.institution,
        entity=leave_request,
        action="leave.request.rejected",
        metadata={"sequence": approval.sequence},
    )
    return leave_request


@transaction.atomic
def cancel_leave_request(*, leave_request, actor):
    leave_request = LeaveRequest.objects.select_for_update().get(pk=leave_request.pk)
    if leave_request.status not in {
        LeaveRequest.Status.DRAFT,
        LeaveRequest.Status.PENDING,
        LeaveRequest.Status.APPROVED,
    }:
        raise ValidationError({"status": "This request cannot be cancelled."})
    membership = _active_membership(actor, leave_request.institution)
    if membership is None:
        raise ValidationError({"actor": "Actor must be an active institution member."})
    if leave_request.employee.user_id != actor.id and not membership.role.permissions.filter(
        code="leave.approve"
    ).exists():
        raise ValidationError({"actor": "Only the employee or a leave approver may cancel."})
    if leave_request.status == LeaveRequest.Status.APPROVED:
        _restore_balance(leave_request)
    leave_request.status = LeaveRequest.Status.CANCELLED
    leave_request.cancelled_at = timezone.now()
    leave_request.save(update_fields=("status", "cancelled_at", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=leave_request.institution,
        entity=leave_request,
        action="leave.request.cancelled",
    )
    return leave_request


@transaction.atomic
def accrue_leave_balance(*, balance, actor, amount=None, as_of_date=None):
    balance = LeaveBalance.objects.select_for_update().select_related(
        "employee", "leave_type", "institution"
    ).get(pk=balance.pk)
    _membership = _active_membership(actor, balance.institution)
    if _membership is None or not _membership.role.permissions.filter(
        code="leave.balance.manage"
    ).exists():
        raise ValidationError({"actor": "Actor cannot accrue leave balances."})
    as_of_date = as_of_date or timezone.localdate()
    if as_of_date.year != balance.year:
        raise ValidationError({"as_of_date": "Accrual date must be in the balance year."})
    policy = applicable_policy(
        employee=balance.employee,
        leave_type=balance.leave_type,
        effective_from=as_of_date,
    )
    if amount is None:
        if policy.accrual_method in {
            LeavePolicy.AccrualMethod.MONTHLY,
            LeavePolicy.AccrualMethod.DAILY,
        }:
            amount = policy.accrual_rate
        elif policy.accrual_method == LeavePolicy.AccrualMethod.ANNUAL:
            amount = policy.annual_entitlement
        else:
            raise ValidationError({"amount": "An explicit accrual amount is required."})
    amount = Decimal(amount).quantize(Decimal("0.01"))
    if amount <= 0:
        raise ValidationError({"amount": "Accrual amount must be positive."})
    balance.accrued += amount
    balance.save(update_fields=("accrued", "updated_at"))
    record_audit_event(
        actor=actor,
        institution=balance.institution,
        entity=balance,
        action="leave.balance.accrued",
        metadata={"amount": str(amount), "as_of_date": as_of_date.isoformat()},
    )
    return balance


@transaction.atomic
def carry_forward_leave_balance(*, balance, actor, target_year=None):
    balance = LeaveBalance.objects.select_for_update().select_related(
        "employee", "leave_type", "institution"
    ).get(pk=balance.pk)
    membership = _active_membership(actor, balance.institution)
    if membership is None or not membership.role.permissions.filter(
        code="leave.balance.manage"
    ).exists():
        raise ValidationError({"actor": "Actor cannot carry leave balances forward."})
    target_year = target_year or balance.year + 1
    if target_year != balance.year + 1:
        raise ValidationError({"target_year": "Carry-forward must target the next year."})
    policy = applicable_policy(
        employee=balance.employee,
        leave_type=balance.leave_type,
        effective_from=date(balance.year, 12, 31),
    )
    carry = min(max(balance.available, Decimal("0")), policy.max_carry_forward)
    next_balance, created = LeaveBalance.objects.get_or_create(
        institution=balance.institution,
        employee=balance.employee,
        leave_type=balance.leave_type,
        year=target_year,
        defaults={"opening_balance": carry},
    )
    if not created and next_balance.opening_balance != carry:
        raise ValidationError(
            {"target_year": "The target balance already has a different opening balance."}
        )
    record_audit_event(
        actor=actor,
        institution=balance.institution,
        entity=next_balance,
        action="leave.balance.carried_forward",
        metadata={"source_year": balance.year, "amount": str(carry)},
    )
    return next_balance


def _current_step(leave_request):
    return (
        LeaveApproval.objects.select_for_update()
        .filter(leave_request=leave_request, status=LeaveApproval.Status.PENDING)
        .order_by("sequence")
        .first()
    )


def _has_permission(user, institution, code):
    membership = _active_membership(user, institution)
    return bool(membership and membership.role.permissions.filter(code=code).exists())


EDITABLE_DRAFT_FIELDS = ("leave_type", "start_date", "end_date", "requested_days", "reason", "attachment")


@transaction.atomic
def update_leave_request(*, leave_request, actor, **values):
    """Edit a draft (new, or returned for changes) before it is submitted again."""
    leave_request = LeaveRequest.objects.select_for_update().get(pk=leave_request.pk)
    if leave_request.status != LeaveRequest.Status.DRAFT:
        raise ValidationError({"status": "Only draft requests can be edited."})
    if leave_request.employee.user_id != actor.id and not _has_permission(actor, leave_request.institution, "leave.configure"):
        raise ValidationError({"employee": "Only the requester may edit this leave request."})
    unknown = set(values) - set(EDITABLE_DRAFT_FIELDS)
    if unknown:
        raise ValidationError({field: "This field cannot be changed on a draft." for field in unknown})
    for field, value in values.items():
        setattr(leave_request, field, value)
    validate_request_against_policy(leave_request)
    leave_request.save()
    record_audit_event(
        actor=actor,
        institution=leave_request.institution,
        entity=leave_request,
        action="leave.request.updated",
        metadata={"fields": sorted(values)},
    )
    return leave_request


@transaction.atomic
def request_leave_changes(*, leave_request, actor, comment=""):
    """Return a pending request to the employee as an editable draft."""
    leave_request = LeaveRequest.objects.select_for_update().get(pk=leave_request.pk)
    if leave_request.status != LeaveRequest.Status.PENDING:
        raise ValidationError({"status": "Only pending requests can be returned for changes."})
    if not (comment or "").strip():
        raise ValidationError({"comment": "Explain what needs to change."})
    approval = _current_step(leave_request)
    if approval is None or approval.approver_id != actor.id:
        raise ValidationError({"approver": "This is not the actor's active approval step."})
    now = timezone.now()
    approval.status = LeaveApproval.Status.RETURNED
    approval.comment = comment
    approval.acted_at = now
    approval.save(update_fields=("status", "comment", "acted_at", "updated_at"))
    LeaveApproval.objects.filter(
        leave_request=leave_request, status=LeaveApproval.Status.PENDING
    ).update(status=LeaveApproval.Status.SKIPPED, updated_at=now)
    leave_request.status = LeaveRequest.Status.DRAFT
    leave_request.changes_requested_at = now
    leave_request.changes_requested_note = comment
    leave_request.save(update_fields=("status", "changes_requested_at", "changes_requested_note", "updated_at"))
    _notify(
        leave_request.employee.user,
        leave_request,
        "LEAVE_CHANGES_REQUESTED",
        "Changes requested on your leave",
        f"Please update your leave request: {comment}",
    )
    record_audit_event(
        actor=actor,
        institution=leave_request.institution,
        entity=leave_request,
        action="leave.request.changes_requested",
        metadata={"sequence": approval.sequence},
    )
    return leave_request


@transaction.atomic
def delegate_leave_approval(*, leave_request, actor, delegate, comment=""):
    """Hand the active approval step to another leave approver."""
    leave_request = LeaveRequest.objects.select_for_update().get(pk=leave_request.pk)
    if leave_request.status != LeaveRequest.Status.PENDING:
        raise ValidationError({"status": "Only pending requests can be delegated."})
    approval = _current_step(leave_request)
    if approval is None:
        raise ValidationError({"approval": "There is no active approval step."})
    institution = leave_request.institution
    if approval.approver_id != actor.id and not _has_permission(actor, institution, "leave.configure"):
        raise ValidationError({"approver": "Only the current approver or a leave administrator may delegate."})
    if delegate is None or delegate.id == approval.approver_id:
        raise ValidationError({"delegate": "Choose a different approver."})
    if delegate.id == leave_request.employee.user_id:
        raise ValidationError({"delegate": "Employees cannot approve their own leave."})
    if not _has_permission(delegate, institution, "leave.approve"):
        raise ValidationError({"delegate": "The delegate must be an active member who can approve leave."})
    previous = approval.approver
    approval.delegated_from = previous
    approval.approver = delegate
    approval.full_clean()
    approval.save(update_fields=("approver", "delegated_from", "updated_at"))
    if (comment or "").strip():
        LeaveRequestComment.objects.create(
            institution=institution, leave_request=leave_request, author=actor, body=f"Delegated: {comment.strip()}"
        )
    _notify(
        delegate,
        leave_request,
        "LEAVE_APPROVAL_REQUIRED",
        "Leave approval delegated to you",
        f"Leave request for {leave_request.employee.full_name} was delegated to you for review.",
    )
    record_audit_event(
        actor=actor,
        institution=institution,
        entity=leave_request,
        action="leave.request.delegated",
        metadata={"sequence": approval.sequence, "from": str(previous.id), "to": str(delegate.id)},
    )
    return leave_request


@transaction.atomic
def add_leave_comment(*, leave_request, actor, body):
    comment = LeaveRequestComment(
        institution=leave_request.institution, leave_request=leave_request, author=actor, body=(body or "").strip()
    )
    comment.full_clean()
    comment.save()
    record_audit_event(
        actor=actor,
        institution=leave_request.institution,
        entity=leave_request,
        action="leave.request.commented",
    )
    return comment


def leave_review_context(*, leave_request, user):
    """Everything a reviewer needs beside the request itself (read-only)."""
    from apps.employees.models import Employment

    institution = leave_request.institution
    employee = leave_request.employee
    year = leave_request.start_date.year
    balance = LeaveBalance.objects.filter(
        employee=employee, leave_type=leave_request.leave_type, year=year
    ).first()
    try:
        policy = matching_policy(leave_request)
    except ValidationError:
        policy = None

    # Statuses: pass / warn / fail, or not_evaluated when a rule cannot be
    # checked (missing data). Unknown is never reported as compliant.
    checks = []
    if policy is None:
        checks.append({"code": "policy", "label": "Applicable policy", "status": "fail", "detail": "No active policy covers this employee and leave type."})
        checks.append({"code": "balance", "label": "Leave balance", "status": "not_evaluated", "detail": "Cannot be checked without an applicable policy."})
    else:
        checks.append({"code": "policy", "label": "Applicable policy", "status": "pass", "detail": policy.name})
        if balance is None:
            checks.append({"code": "balance", "label": "Leave balance", "status": "not_evaluated", "detail": "No balance exists yet for this year, so availability cannot be checked."})
        elif policy.allow_negative_balance or balance.available >= leave_request.requested_days:
            checks.append({"code": "balance", "label": "Leave balance", "status": "pass", "detail": f"{balance.available} day(s) available."})
        else:
            checks.append({"code": "balance", "label": "Leave balance", "status": "fail", "detail": f"Only {balance.available} day(s) available."})
        if policy.max_consecutive_days is not None:
            ok = leave_request.requested_days <= policy.max_consecutive_days
            checks.append({"code": "max_consecutive", "label": "Maximum consecutive days", "status": "pass" if ok else "fail", "detail": f"Policy allows {policy.max_consecutive_days} day(s)."})
        needs_document = leave_request.leave_type.requires_attachment or policy.requires_document
        if needs_document:
            checks.append({"code": "document", "label": "Supporting document", "status": "pass" if leave_request.attachment_id else "fail", "detail": "Required by policy."})
        if policy.min_service_days:
            served = (leave_request.start_date - employee.hire_date).days
            checks.append({"code": "service", "label": "Minimum service", "status": "pass" if served >= policy.min_service_days else "fail", "detail": f"{policy.min_service_days} day(s) required; {max(served, 0)} served."})

    employment = Employment.objects.filter(employee=employee, is_current=True).select_related("department").first()
    team = []
    if employment:
        month_start = leave_request.start_date.replace(day=1)
        next_month = (month_start + timedelta(days=32)).replace(day=1)
        colleagues = (
            LeaveRequest.objects.filter(
                institution=institution,
                status__in=(LeaveRequest.Status.PENDING, LeaveRequest.Status.APPROVED),
                employee__employments__is_current=True,
                employee__employments__department_id=employment.department_id,
                start_date__lt=next_month,
                end_date__gte=month_start,
            )
            .exclude(pk=leave_request.pk)
            .select_related("employee", "leave_type")
            .order_by("start_date")
        )
        overlapping = 0
        for item in colleagues:
            overlaps = item.start_date <= leave_request.end_date and item.end_date >= leave_request.start_date
            overlapping += int(overlaps)
            team.append({
                "id": str(item.id),
                "employee_id": str(item.employee_id),
                "employee_name": item.employee.full_name,
                "leave_type": item.leave_type.name,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "status": item.status,
                "overlaps": overlaps,
            })
        checks.append({
            "code": "team_overlap",
            "label": "Team availability",
            "status": "warn" if overlapping else "pass",
            "detail": f"{overlapping} team member(s) off during these dates." if overlapping else "No team members off during these dates.",
        })
    else:
        checks.append({"code": "team_overlap", "label": "Team availability", "status": "not_evaluated", "detail": "The employee has no current department assignment."})

    queue = list(
        LeaveApproval.objects.filter(
            institution=institution, approver=user, status=LeaveApproval.Status.PENDING,
            leave_request__status=LeaveRequest.Status.PENDING,
        )
        .order_by("leave_request__submitted_at", "leave_request__created_at")
        .values_list("leave_request_id", flat=True)
    )
    previous_id = next_id = None
    if leave_request.pk in queue:
        index = queue.index(leave_request.pk)
        previous_id = queue[index - 1] if index > 0 else None
        next_id = queue[index + 1] if index + 1 < len(queue) else None
    current = leave_request.approvals.filter(status=LeaveApproval.Status.PENDING).order_by("sequence").first()
    return {
        "reference": leave_request.reference,
        "is_requester": employee.user_id == user.id,
        "employee_name": employee.full_name,
        "employee_number": employee.employee_number,
        "department": employment.department.name if employment and employment.department_id else None,
        "position": employment.position.title if employment and employment.position_id else None,
        "employment_type": employment.employment_type if employment else None,
        "balance": None if balance is None else {
            "year": balance.year,
            "entitlement": balance.opening_balance + balance.accrued + balance.adjusted,
            "used": balance.used,
            "available": balance.available,
        },
        "policy_checks": checks,
        "team_on_leave": team,
        "queue": {"previous_id": previous_id, "next_id": next_id, "position": (queue.index(leave_request.pk) + 1) if leave_request.pk in queue else None, "total": len(queue)},
        "can_decide": bool(current and current.approver_id == user.id),
        "can_delegate": bool(current and (current.approver_id == user.id or _has_permission(user, institution, "leave.configure"))),
    }
