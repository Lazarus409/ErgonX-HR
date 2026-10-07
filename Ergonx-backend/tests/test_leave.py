from datetime import date
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse

from apps.employees.models import Employment
from apps.audit.models import AuditLog
from apps.institutions.models import InstitutionModule, Permission
from apps.leave.models import (
    LeaveBalance,
    LeavePolicy,
    LeavePolicyDepartmentEligibility,
    LeavePolicyGenderEligibility,
    LeaveRequest,
    LeaveType,
)
from apps.leave.services import (
    approve_leave_request,
    accrue_leave_balance,
    cancel_leave_request,
    carry_forward_leave_balance,
    create_leave_request,
    submit_leave_request,
)
from apps.organization.models import Department
from apps.notifications.models import Notification
from apps.workflows.models import ApprovalWorkflowDefinition, ApprovalWorkflowStep


pytestmark = pytest.mark.django_db


def _enable_leave(institution):
    InstitutionModule.objects.filter(
        institution=institution, module_code=InstitutionModule.ModuleCode.LEAVE
    ).update(is_enabled=True)


def _employee_with_employment(
    institution,
    *,
    user,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
    employment_type=Employment.EmploymentType.PERMANENT,
):
    employee = employee_factory(institution, user=user)
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    employment = Employment.objects.create(
        institution=institution,
        employee=employee,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=employment_type,
        start_date=date(2026, 1, 1),
    )
    return employee, employment


def _leave_configuration(institution, **type_values):
    leave_type = LeaveType.objects.create(
        institution=institution,
        name="Annual Leave",
        code="test-annual",
        **type_values,
    )
    policy = LeavePolicy.objects.create(
        institution=institution,
        leave_type=leave_type,
        name="Standard annual leave",
        annual_entitlement=Decimal("20"),
        effective_from=date(2026, 1, 1),
    )
    return leave_type, policy


def test_leave_module_is_gated_until_enabled(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory()
    user = user_factory()
    membership_factory(user=user, institution=institution, is_primary=True)
    api_client.force_authenticate(user=user)

    disabled = api_client.get(reverse("v1:leave-type-list"))
    _enable_leave(institution)
    enabled = api_client.get(reverse("v1:leave-type-list"))

    assert disabled.status_code == 403
    assert enabled.status_code == 200
    assert Permission.objects.get(code="leave.request").module_code == "LEAVE"


def test_leave_submission_and_approval_consumes_balance(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory(email="hr@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee_user = user_factory(email="employee@example.com")
    membership_factory(
        user=employee_user, institution=institution, role_code="EMPLOYEE"
    )
    employee, _ = _employee_with_employment(
        institution,
        user=employee_user,
        employee_factory=employee_factory,
        organization_factory=organization_factory,
        assignment_dimensions_factory=assignment_dimensions_factory,
    )
    leave_type, _ = _leave_configuration(institution)

    request = create_leave_request(
        institution=institution,
        actor=employee_user,
        employee=employee,
        leave_type=leave_type,
        start_date=date(2026, 9, 14),
        end_date=date(2026, 9, 15),
        requested_days=Decimal("2"),
        reason="Rest",
    )
    request = submit_leave_request(leave_request=request, actor=employee_user)

    assert request.status == LeaveRequest.Status.PENDING
    approval = request.approvals.get(sequence=1)
    assert approval.approver == hr

    request = approve_leave_request(
        leave_request=request, actor=hr, comment="Approved"
    )
    balance = LeaveBalance.objects.get(
        employee=employee, leave_type=leave_type, year=2026
    )

    assert request.status == LeaveRequest.Status.APPROVED
    assert balance.accrued == Decimal("20")
    assert balance.used == Decimal("2")
    assert balance.available == Decimal("18")
    assert Notification.objects.filter(
        user=employee_user, notification_type="LEAVE_APPROVED"
    ).exists()
    assert AuditLog.objects.filter(
        entity_id=request.id, action="leave.request.approved_step"
    ).exists()


def test_leave_policy_dimensions_and_cross_tenant_links_are_enforced(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution_a = institution_factory(code="A")
    institution_b = institution_factory(code="B")
    employee_user = user_factory()
    membership_factory(
        user=employee_user, institution=institution_a, role_code="EMPLOYEE"
    )
    employee, employment = _employee_with_employment(
        institution_a,
        user=employee_user,
        employee_factory=employee_factory,
        organization_factory=organization_factory,
        assignment_dimensions_factory=assignment_dimensions_factory,
    )
    leave_type, policy = _leave_configuration(institution_a)
    foreign_department = Department.objects.create(
        institution=institution_b, name="Foreign", code="FOREIGN"
    )

    with pytest.raises(ValidationError):
        LeavePolicyDepartmentEligibility.objects.create(
            institution=institution_a,
            policy=policy,
            department=foreign_department,
        )

    LeavePolicyDepartmentEligibility.objects.create(
        institution=institution_a,
        policy=policy,
        department=employment.department,
    )
    LeavePolicyGenderEligibility.objects.create(
        institution=institution_a,
        policy=policy,
        gender="FEMALE",
    )

    with pytest.raises(ValidationError, match="No active leave policy"):
        create_leave_request(
            institution=institution_a,
            actor=employee_user,
            employee=employee,
            leave_type=leave_type,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 1),
            requested_days=Decimal("1"),
        )


def test_pending_leave_overlap_is_rejected_on_direct_write(
    institution_factory, employee_factory
):
    institution = institution_factory()
    employee = employee_factory(institution)
    leave_type, _ = _leave_configuration(institution)
    LeaveRequest.objects.create(
        institution=institution,
        employee=employee,
        leave_type=leave_type,
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 3),
        requested_days=Decimal("3"),
        status=LeaveRequest.Status.PENDING,
    )

    with pytest.raises(ValidationError):
        LeaveRequest.objects.create(
            institution=institution,
            employee=employee,
            leave_type=leave_type,
            start_date=date(2026, 10, 3),
            end_date=date(2026, 10, 4),
            requested_days=Decimal("2"),
            status=LeaveRequest.Status.PENDING,
        )


def test_configured_multilevel_leave_workflow_and_balance_restoration(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    director = user_factory(email="director@example.com")
    membership_factory(user=director, institution=institution, role_code="DIRECTOR")
    hr = user_factory(email="workflow-hr@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee_user = user_factory(email="workflow-employee@example.com")
    membership_factory(
        user=employee_user, institution=institution, role_code="EMPLOYEE"
    )
    employee, _ = _employee_with_employment(
        institution,
        user=employee_user,
        employee_factory=employee_factory,
        organization_factory=organization_factory,
        assignment_dimensions_factory=assignment_dimensions_factory,
    )
    leave_type, _ = _leave_configuration(institution)
    workflow = ApprovalWorkflowDefinition.objects.create(
        institution=institution,
        code="LEAVE",
        name="Two-level leave approval",
        workflow_type="LEAVE",
        entity_type="leave.LeaveRequest",
    )
    ApprovalWorkflowStep.objects.create(
        institution=institution,
        workflow=workflow,
        order=1,
        name="Director",
        approver_user=director,
    )
    ApprovalWorkflowStep.objects.create(
        institution=institution,
        workflow=workflow,
        order=2,
        name="HR",
        approver_user=hr,
    )
    request = create_leave_request(
        institution=institution,
        actor=employee_user,
        employee=employee,
        leave_type=leave_type,
        start_date=date(2026, 11, 2),
        end_date=date(2026, 11, 3),
        requested_days=Decimal("2"),
    )
    request = submit_leave_request(leave_request=request, actor=employee_user)

    assert list(request.approvals.values_list("approver", flat=True)) == [
        director.id,
        hr.id,
    ]
    request = approve_leave_request(leave_request=request, actor=director)
    assert request.status == LeaveRequest.Status.PENDING
    request = approve_leave_request(leave_request=request, actor=hr)
    assert request.status == LeaveRequest.Status.APPROVED

    request = cancel_leave_request(leave_request=request, actor=employee_user)
    balance = LeaveBalance.objects.get(employee=employee, leave_type=leave_type, year=2026)
    assert request.status == LeaveRequest.Status.CANCELLED
    assert balance.used == Decimal("0")


def test_leave_accrual_and_carry_forward(
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
    organization_factory,
    assignment_dimensions_factory,
):
    institution = institution_factory()
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    employee = _employee_with_employment(
        institution,
        user=None,
        employee_factory=employee_factory,
        organization_factory=organization_factory,
        assignment_dimensions_factory=assignment_dimensions_factory,
    )[0]
    leave_type = LeaveType.objects.create(
        institution=institution, name="Accruing Leave", code="ACCRUING"
    )
    LeavePolicy.objects.create(
        institution=institution,
        leave_type=leave_type,
        name="Monthly",
        annual_entitlement=Decimal("18"),
        accrual_method=LeavePolicy.AccrualMethod.MONTHLY,
        accrual_rate=Decimal("1.5"),
        max_carry_forward=Decimal("5"),
        effective_from=date(2026, 1, 1),
    )
    balance = LeaveBalance.objects.create(
        institution=institution,
        employee=employee,
        leave_type=leave_type,
        year=2026,
        accrued=Decimal("6"),
        used=Decimal("2"),
    )

    balance = accrue_leave_balance(
        balance=balance, actor=hr, as_of_date=date(2026, 9, 1)
    )
    next_balance = carry_forward_leave_balance(balance=balance, actor=hr)

    assert balance.accrued == Decimal("7.5")
    assert next_balance.year == 2027
    assert next_balance.opening_balance == Decimal("5")


def test_employee_cannot_create_leave_for_another_employee(
    api_client,
    institution_factory,
    user_factory,
    membership_factory,
    employee_factory,
):
    institution = institution_factory()
    _enable_leave(institution)
    user = user_factory()
    membership_factory(
        user=user, institution=institution, role_code="EMPLOYEE", is_primary=True
    )
    employee_factory(institution, user=user)
    other_employee = employee_factory(institution)
    leave_type, _ = _leave_configuration(institution)
    api_client.force_authenticate(user=user)

    response = api_client.post(
        reverse("v1:leave-request-list"),
        {
            "employee": str(other_employee.id),
            "leave_type": str(leave_type.id),
            "start_date": "2026-10-01",
            "end_date": "2026-10-01",
            "requested_days": "1.00",
        },
        format="json",
    )

    assert response.status_code == 400
    assert "employee" in response.json()["errors"]
