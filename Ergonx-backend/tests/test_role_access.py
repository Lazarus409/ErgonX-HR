from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule
from apps.institutions.services import ROLE_PERMISSION_CODES, SELF_SERVICE_PERMISSIONS
from apps.leave.models import LeaveRequest, LeaveType
from apps.organization.models import Department, Position

pytestmark = pytest.mark.django_db


@pytest.fixture
def staff(institution_factory, user_factory, membership_factory, employee_factory, assignment_dimensions_factory):
    """An accountant, an HR admin and an employee, each with one leave request."""
    institution = institution_factory()
    InstitutionModule.objects.filter(institution=institution, module_code__in=("LEAVE", "ATTENDANCE")).update(is_enabled=True)
    grade, location = assignment_dimensions_factory(institution)
    department = Department.objects.create(institution=institution, name="Finance", code="FIN")
    position = Position.objects.create(institution=institution, department=department, title="Staff", code="STAFF")
    leave_type = LeaveType.objects.create(institution=institution, name="Annual Leave", code="test-annual")
    people = {}
    for key, role in (("accountant", "ACCOUNTANT"), ("hr", "HR_ADMIN"), ("employee", "EMPLOYEE")):
        user = user_factory(email=f"{key}@example.com")
        membership_factory(user=user, institution=institution, role_code=role)
        employee = employee_factory(institution, user=user)
        Employment.objects.create(
            institution=institution, employee=employee, department=department, position=position, grade=grade,
            location=location, employment_type=Employment.EmploymentType.PERMANENT, start_date=date(2026, 1, 1),
        )
        LeaveRequest.objects.create(
            institution=institution, employee=employee, leave_type=leave_type, start_date=date(2026, 10, 5),
            end_date=date(2026, 10, 6), requested_days=Decimal("2"),
        )
        people[key] = user
    return people


def test_staff_roles_get_self_service():
    for role in ("DIRECTOR", "ACCOUNTANT", "FINANCE_MANAGER", "AUDITOR"):
        assert set(SELF_SERVICE_PERMISSIONS) <= set(ROLE_PERMISSION_CODES[role]), role


def test_self_service_view_permission_shows_only_own_leave(api_client, staff):
    api_client.force_authenticate(staff["accountant"])
    response = api_client.get(reverse("v1:leave-request-list"))

    assert response.status_code == 200
    assert response.data["count"] == 1
    assert {str(row["employee"]) for row in response.data["results"]} == {
        str(staff["accountant"].employee_profiles.get().id)
    }


def test_leave_management_permission_still_shows_everyone(api_client, staff):
    api_client.force_authenticate(staff["hr"])

    assert api_client.get(reverse("v1:leave-request-list")).data["count"] == 3


def test_bootstrap_reports_data_scope(api_client, staff):
    scopes = {}
    for key in ("accountant", "employee"):
        api_client.force_authenticate(staff[key])
        scopes[key] = api_client.get("/api/v1/auth/bootstrap/").data["active_membership"]["data_scope"]

    assert scopes == {"accountant": "INSTITUTION", "employee": "SELF"}


def test_self_service_attendance_action_opens_my_attendance(api_client, staff):
    for key, expected in (("employee", "/me/attendance"), ("hr", "/attendance/adjustments")):
        api_client.force_authenticate(staff[key])
        actions = {item["code"]: item for item in api_client.get("/api/v1/home/").data["quick_actions"]}
        if "attendance.adjust" in actions:
            assert actions["attendance.adjust"]["route_hint"] == expected, key


@pytest.fixture
def auditor(institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    InstitutionModule.objects.filter(institution=institution, module_code="ACCOUNTING").update(is_enabled=True)
    user = user_factory(email="auditor@example.com")
    membership_factory(user=user, institution=institution, role_code="AUDITOR")
    return user, institution


def test_auditor_reads_but_cannot_write(api_client, auditor):
    user, _ = auditor
    api_client.force_authenticate(user)

    assert api_client.get("/api/v1/journal-entries/").status_code == 200
    denied = api_client.post("/api/v1/journal-entries/", {}, format="json")
    assert denied.status_code == 403
    assert denied.data["message"] == "Your role has read-only access."


def test_auditor_keeps_self_service(api_client, auditor):
    user, _ = auditor
    api_client.force_authenticate(user)

    assert api_client.post("/api/v1/notifications/mark-all-read/", {}, format="json").status_code == 200
    assert api_client.get("/api/v1/auth/bootstrap/").data["active_membership"]["read_only"] is True


def test_read_only_role_cannot_be_a_workflow_approver(auditor):
    from django.core.exceptions import ValidationError
    from apps.workflows.models import ApprovalWorkflowDefinition, ApprovalWorkflowStep

    _, institution = auditor
    workflow = ApprovalWorkflowDefinition.objects.create(institution=institution, code="WF", name="WF", workflow_type="GENERIC", entity_type="Any")
    step = ApprovalWorkflowStep(institution=institution, workflow=workflow, order=1, name="Audit", approver_role=institution.roles.get(code="AUDITOR"))

    with pytest.raises(ValidationError):
        step.full_clean()
