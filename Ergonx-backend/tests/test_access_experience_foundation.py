from datetime import date
from uuid import uuid4

import pytest
from django.utils import timezone

from apps.employees.models import Employment
from apps.leave.models import LeaveRequest, LeaveType
from apps.dashboards.home import ACTION_CATALOG, RESUME_ROUTE_BUILDERS
from apps.institutions.models import InstitutionMembership, InstitutionModule, Permission, Role, UserActivityEvent, UserPreference
from apps.institutions.services import next_reference


pytestmark = pytest.mark.django_db


def _authenticate(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))


def test_home_bootstrap_and_search_are_tenant_and_permission_scoped(
    api_client, institution_factory, user_factory, membership_factory, employee_factory
):
    institution = institution_factory(code="EXPERIENCE")
    foreign = institution_factory(code="EXPERIENCE-FOREIGN")
    user = user_factory(first_name="Ada")
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    employee_factory(institution, employee_number="EMP-ADA", last_name="Adams")
    employee_factory(foreign, employee_number="EMP-FOREIGN", last_name="Adams")
    _authenticate(api_client, user, institution)

    home = api_client.get("/api/v1/home/")
    assert home.status_code == 200
    assert set(home.data) == {
        "greeting_context", "quick_actions", "recent_work", "attention_items",
        "notifications_summary", "optional_personal_snapshot", "team_snapshot",
    }
    assert home.data["greeting_context"]["user_display_name"] == "Ada"

    # A request action is self-service, never a guessed manager-side create
    # route. The route must stay valid when Home renders it for an eligible
    # employee/custom role.
    institution.roles.get(code="HR_ADMIN").permissions.add(
        Permission.objects.get(code="leave.request")
    )
    InstitutionModule.objects.filter(
        institution=institution, module_code=InstitutionModule.ModuleCode.LEAVE
    ).update(is_enabled=True)
    employee_factory(institution, user=user, employee_number="SELF-ADA")
    UserPreference.objects.create(
        institution=institution, user=user, preference_key="quick_actions",
        value_json={"pinned": ["leave.request"]},
    )
    home_with_leave = api_client.get("/api/v1/home/")
    leave_action = next(item for item in home_with_leave.data["quick_actions"] if item["code"] == "leave.request")
    assert leave_action["route_hint"] == "/me/leave/request"

    bootstrap = api_client.get("/api/v1/auth/bootstrap/")
    assert bootstrap.status_code == 200
    assert bootstrap.data["active_institution"]["id"] == str(institution.id)
    assert "search.use" in bootstrap.data["effective_permissions"]
    # Landing follows effective permissions (BQ-01): HR operations land on Insights.
    assert bootstrap.data["default_landing"] == "INSIGHTS"

    search = api_client.get("/api/v1/search/?q=EMP-ADA")
    assert search.status_code == 200
    assert [item["reference"] for item in search.data["results"]] == ["EMP-ADA"]


def test_disabled_leave_is_removed_from_home_search_and_reports(
    api_client, institution_factory, user_factory, membership_factory, employee_factory
):
    institution = institution_factory(code="DISABLED-LEAVE")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    employee = employee_factory(institution, employee_number="EMP-LEAVE-GATED")
    leave_type = LeaveType.objects.create(
        institution=institution, name="Annual Leave", code="TEST-ANNUAL", requires_approval=True
    )
    request = LeaveRequest.objects.create(
        institution=institution, employee=employee, leave_type=leave_type,
        start_date=date(2026, 10, 1), end_date=date(2026, 10, 2), requested_days=2,
        status=LeaveRequest.Status.PENDING,
    )
    InstitutionModule.objects.filter(
        institution=institution, module_code=InstitutionModule.ModuleCode.LEAVE
    ).update(is_enabled=False)
    _authenticate(api_client, user, institution)

    home = api_client.get("/api/v1/home/")
    assert home.status_code == 200
    assert all(item["module"] != "LEAVE" for item in home.data["quick_actions"])
    assert all(item["code"] != "LEAVE_APPROVAL_REQUIRED" for item in home.data["attention_items"])

    search = api_client.get(f"/api/v1/search/?q=LR-{str(request.id)[:8].upper()}")
    assert search.status_code == 200
    assert all(item["type"] != "LEAVE_REQUEST" for item in search.data["results"])

    report = api_client.get("/api/v1/reports/leave/")
    assert report.status_code == 403
    assert report.data["code"] == "module_disabled"


def test_hr_mutation_of_signed_in_employee_is_rejected_with_stable_code(
    api_client, institution_factory, user_factory, membership_factory, employee_factory
):
    institution = institution_factory(code="SELF-HR-GUARD")
    user = user_factory(first_name="Self")
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    employee = employee_factory(institution, user=user, employee_number="SELF-HR", first_name="Self")
    _authenticate(api_client, user, institution)

    response = api_client.patch(
        f"/api/v1/employees/{employee.id}/",
        {"first_name": "Should Not Change"},
        format="json",
    )

    assert response.status_code == 400
    assert response.data["code"] == "self_hr_record_edit_not_allowed"
    employee.refresh_from_db()
    assert employee.first_name == "Self"


def test_custom_roles_cannot_change_reserved_roles_and_keep_tenant_scope(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="ROLE-TEST")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    _authenticate(api_client, user, institution)

    created = api_client.post(
        "/api/v1/institutions/roles/",
        {"code": "BENEFITS_EDITOR", "name": "Benefits editor", "permission_codes": ["employee.view"]},
        format="json",
    )
    assert created.status_code == 201
    assert created.data["is_custom"] is True

    reserved = institution.roles.get(code="HR_ADMIN")
    response = api_client.patch(
        f"/api/v1/institutions/roles/{reserved.id}/",
        {"name": "Changed"},
        format="json",
    )
    assert response.status_code == 400
    assert response.data["code"] == "role_protected"


def test_reference_sequences_are_tenant_local_and_reset_by_policy(institution_factory):
    institution = institution_factory(code="REFERENCE-TEST")
    first = next_reference(institution=institution, namespace="PAYROLL_RUN", at=date(2026, 1, 31))
    second = next_reference(institution=institution, namespace="PAYROLL_RUN", at=date(2026, 2, 1))
    assert first == "PR-2026-01-0001"
    assert second == "PR-2026-02-0001"


def test_home_action_catalog_uses_existing_frontend_destinations():
    """Keep server-owned Home actions from regressing to removed `/new` routes."""
    assert ACTION_CATALOG["leave.request"]["route_hint"] == "/me/leave/request"
    assert ACTION_CATALOG["attendance.adjust"]["route_hint"] == "/attendance/adjustments"
    assert ACTION_CATALOG["journal.create"]["route_hint"] == "/accounting/journals/new"


def test_home_resume_route_builders_use_the_matching_detail_routes():
    entity_id = uuid4()
    assert RESUME_ROUTE_BUILDERS["employee.create"](entity_id) == f"/hr/employees/{entity_id}"
    assert RESUME_ROUTE_BUILDERS["leave.request"](entity_id) == f"/leave/requests/{entity_id}"
    assert RESUME_ROUTE_BUILDERS["journal.create"](entity_id) == f"/accounting/journals/{entity_id}"
    assert RESUME_ROUTE_BUILDERS["journal.approve"](entity_id) == f"/accounting/journals/{entity_id}"
    assert RESUME_ROUTE_BUILDERS["candidate.create"](entity_id) == f"/recruitment/candidates/{entity_id}"
    assert RESUME_ROUTE_BUILDERS["payroll.prepare"](entity_id) == f"/payroll/runs/{entity_id}"
    assert RESUME_ROUTE_BUILDERS["attendance.adjust"](entity_id) == "/attendance/adjustments"


def test_home_recent_work_uses_a_tenant_scoped_entity_resume_route(
    api_client, institution_factory, user_factory, membership_factory, employee_factory
):
    institution = institution_factory(code="HOME-RECENT-WORK")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    institution.roles.get(code="HR_ADMIN").permissions.add(Permission.objects.get(code="leave.request"))
    InstitutionModule.objects.filter(
        institution=institution, module_code=InstitutionModule.ModuleCode.LEAVE
    ).update(is_enabled=True)
    employee_factory(institution, user=user, employee_number="HOME-SELF")
    request_id = uuid4()
    UserActivityEvent.objects.create(
        institution=institution,
        user=user,
        activity_code="leave.request",
        entity_type="leave.leaverequest",
        entity_id=request_id,
        occurred_at=timezone.now(),
    )

    _authenticate(api_client, user, institution)
    response = api_client.get("/api/v1/home/")

    assert response.status_code == 200
    assert len(response.data["recent_work"]) == 1
    assert response.data["recent_work"][0] == {
        "type": "leave.leaverequest",
        "id": str(request_id),
        "reference": "",
        "title": "Request leave",
        "status": "IN_PROGRESS",
        "resume_action": "leave.request",
        "resume_route": f"/leave/requests/{request_id}",
        "updated_at": response.data["recent_work"][0]["updated_at"],
        "can_resume": True,
    }


def test_approval_workspace_permission_is_enforced_for_reviewer_roles(
    api_client, institution_factory, user_factory, membership_factory,
):
    """The frontend Approvals entry mirrors this server-authoritative gate."""
    institution = institution_factory(code="APPROVAL-WORKSPACE")
    reviewer = user_factory()
    employee = user_factory()
    auditor = user_factory()
    membership_factory(user=reviewer, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    membership_factory(user=employee, institution=institution, role_code="EMPLOYEE", is_primary=True)
    membership_factory(user=auditor, institution=institution, role_code="AUDITOR", is_primary=True)

    _authenticate(api_client, reviewer, institution)
    assert api_client.get("/api/v1/approval-requests/").status_code == 200

    # Auditors review the record read-only; the approval queue is not theirs.
    for user in (employee, auditor):
        _authenticate(api_client, user, institution)
        assert api_client.get("/api/v1/approval-requests/").status_code == 403


def test_offboarding_ends_only_the_institution_membership(
    api_client, institution_factory, user_factory, membership_factory, organization_factory,
    assignment_dimensions_factory, employee_factory,
):
    institution = institution_factory(code="LIFECYCLE")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    employee_user = user_factory()
    membership_factory(user=employee_user, institution=institution, role_code="EMPLOYEE", is_primary=True)
    employee = employee_factory(institution, user=employee_user)
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    Employment.objects.create(
        institution=institution, employee=employee, department=department, position=position,
        grade=grade, location=location, employment_type=Employment.EmploymentType.PERMANENT,
        start_date=date(2026, 1, 1), is_current=True,
    )
    _authenticate(api_client, user, institution)
    started = api_client.post(f"/api/v1/employees/{employee.id}/offboarding/start/", {"last_working_day": "2026-02-01"}, format="json")
    assert started.status_code == 200
    completed = api_client.post(f"/api/v1/employees/{employee.id}/offboarding/complete/", format="json")
    assert completed.status_code == 200
    assert completed.data["status"] == "COMPLETED"
    assert InstitutionMembership.objects.get(user=employee_user, institution=institution).status == InstitutionMembership.Status.INACTIVE
    user.refresh_from_db()
    assert user.is_active is True
