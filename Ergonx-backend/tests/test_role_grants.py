"""Role grants cannot escalate privilege; scope and read-only live on the role (Wave 2: PERM-01/02/03, BQ-11)."""

from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule, Permission, Role
from apps.institutions.services import PRIVILEGED_PERMISSIONS, create_custom_role, sync_system_role_permissions
from apps.leave.models import LeaveRequest, LeaveType
from apps.organization.models import Department, Position

pytestmark = pytest.mark.django_db

ROLES = "/api/v1/institutions/roles/"
MEMBERS = "/api/v1/institutions/members/"


@pytest.fixture
def org(institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    admin = user_factory(email="admin@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN")
    # A delegated access manager: may manage roles and users, nothing else.
    manager_role = create_custom_role(
        institution=institution, actor=admin, code="ACCESS_DESK", name="Access desk",
        permission_codes=["settings.roles.manage", "settings.users.manage", "home.view"],
    )
    manager = user_factory(email="desk@example.com")
    membership_factory(user=manager, institution=institution, role_code="ACCESS_DESK")
    return {"institution": institution, "admin": admin, "manager": manager, "manager_role": manager_role}


def test_privileged_classification_follows_the_code_list():
    privileged = set(Permission.objects.filter(classification=Permission.Classification.PRIVILEGED).values_list("code", flat=True))
    assert privileged == set(PRIVILEGED_PERMISSIONS) & set(Permission.objects.values_list("code", flat=True))


def test_delegated_manager_cannot_grant_permissions_they_do_not_hold(api_client, org):
    api_client.force_authenticate(org["manager"])
    response = api_client.post(ROLES, {"code": "PAYROLL_PLUS", "name": "Payroll plus", "permission_codes": ["payroll.finalize"]}, format="json")
    assert response.status_code == 400 and response.data["code"] == "permission_not_delegable"


def test_delegated_manager_cannot_grant_privileged_permissions_even_if_held(api_client, org):
    api_client.force_authenticate(org["manager"])
    response = api_client.post(ROLES, {"code": "ROLE_DESK_2", "name": "Second desk", "permission_codes": ["settings.roles.manage"]}, format="json")
    assert response.status_code == 400 and response.data["code"] == "permission_not_delegable"
    assert not Role.objects.filter(code="ROLE_DESK_2").exists()


def test_delegated_manager_cannot_widen_their_own_role(api_client, org):
    api_client.force_authenticate(org["manager"])
    response = api_client.patch(f"{ROLES}{org['manager_role'].id}/", {"permission_codes": ["settings.roles.manage", "settings.users.manage", "home.view", "payroll.view"]}, format="json")
    assert response.status_code == 400 and response.data["code"] == "permission_not_delegable"


def test_administrator_on_a_built_in_role_may_grant_privileged_permissions(api_client, org):
    api_client.force_authenticate(org["admin"])
    response = api_client.post(ROLES, {"code": "AUDIT_DESK", "name": "Audit desk", "permission_codes": ["audit.view", "home.view"]}, format="json")
    assert response.status_code == 201


def test_delegated_manager_cannot_assign_a_broader_role(api_client, org, user_factory, membership_factory):
    member = user_factory(email="member@example.com")
    membership = membership_factory(user=member, institution=org["institution"], role_code="EMPLOYEE")
    finance = Role.objects.get(institution=org["institution"], code="FINANCE_MANAGER")
    api_client.force_authenticate(org["manager"])
    response = api_client.patch(f"{MEMBERS}{membership.id}/", {"role_id": str(finance.id)}, format="json")
    assert response.status_code == 400 and response.data["code"] == "permission_not_delegable"


def test_self_only_roles_can_be_assigned_by_a_delegated_manager(org, user_factory, membership_factory):
    from apps.institutions.services import update_membership

    member = user_factory(email="member2@example.com")
    membership = membership_factory(user=member, institution=org["institution"], role_code="DEPARTMENT_HEAD")
    employee_role = Role.objects.get(institution=org["institution"], code="EMPLOYEE")
    updated = update_membership(membership=membership, institution=org["institution"], actor=org["manager"], role=employee_role)
    assert updated.role == employee_role


def test_built_in_roles_carry_their_scope_and_read_only_flags(institution_factory):
    institution = institution_factory()
    roles = {role.code: role for role in Role.objects.filter(institution=institution)}
    assert roles["EMPLOYEE"].data_scope == "SELF"
    assert roles["DEPARTMENT_HEAD"].data_scope == "DEPARTMENT"
    assert roles["AUDITOR"].is_read_only is True
    assert roles["HR_ADMIN"].data_scope == "INSTITUTION" and roles["HR_ADMIN"].is_read_only is False
    Role.objects.filter(pk=roles["EMPLOYEE"].pk).update(data_scope="INSTITUTION")
    sync_system_role_permissions()
    assert Role.objects.get(pk=roles["EMPLOYEE"].pk).data_scope == "SELF"


@pytest.fixture
def leave_setup(org, user_factory, membership_factory, employee_factory, assignment_dimensions_factory):
    institution = org["institution"]
    InstitutionModule.objects.filter(institution=institution, module_code="LEAVE").update(is_enabled=True)
    grade, location = assignment_dimensions_factory(institution)
    department = Department.objects.create(institution=institution, name="Ops", code="OPS")
    position = Position.objects.create(institution=institution, department=department, title="Staff", code="STF")
    leave_type = LeaveType.objects.create(institution=institution, name="Annual", code="annual-t")
    people = {}
    for key in ("one", "two"):
        user = user_factory(email=f"{key}@example.com")
        membership_factory(user=user, institution=institution, role_code="EMPLOYEE")
        employee = employee_factory(institution, user=user)
        Employment.objects.create(institution=institution, employee=employee, department=department, position=position, grade=grade, location=location, employment_type=Employment.EmploymentType.PERMANENT, start_date=date(2026, 1, 1))
        LeaveRequest.objects.create(institution=institution, employee=employee, leave_type=leave_type, start_date=date(2026, 10, 5), end_date=date(2026, 10, 6), requested_days=Decimal("1"))
        people[key] = user
    return people


def test_custom_role_scope_comes_from_the_role_not_its_code(api_client, org, leave_setup):
    institution = org["institution"]
    approver = create_custom_role(institution=institution, actor=org["admin"], code="LEAVE_DESK", name="Leave desk", permission_codes=["leave.view", "leave.approve", "home.view"])
    member = leave_setup["one"]
    from apps.institutions.models import InstitutionMembership

    InstitutionMembership.objects.filter(user=member, institution=institution).update(role=approver)
    api_client.force_authenticate(member)
    assert api_client.get(reverse("v1:leave-request-list")).data["count"] == 2
    Role.objects.filter(pk=approver.pk).update(data_scope="SELF")
    assert api_client.get(reverse("v1:leave-request-list")).data["count"] == 1


def test_custom_read_only_role_cannot_write(api_client, org):
    institution = org["institution"]
    viewer = create_custom_role(institution=institution, actor=org["admin"], code="ROLE_VIEWER", name="Role viewer", permission_codes=["settings.roles.manage", "home.view"], is_read_only=True)
    from apps.institutions.models import InstitutionMembership

    InstitutionMembership.objects.filter(user=org["manager"], institution=institution).update(role=viewer)
    api_client.force_authenticate(org["manager"])
    response = api_client.post(ROLES, {"code": "ANY_ROLE", "name": "Any", "permission_codes": ["home.view"]}, format="json")
    assert response.status_code == 403 and response.data["code"] == "read_only_role"
