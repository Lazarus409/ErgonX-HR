from datetime import date
from decimal import Decimal

import pytest
from django.urls import reverse

from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule
from apps.leave.models import LeaveRequest, LeaveType
from apps.leave.services import _configured_approvers
from apps.organization.models import Department, Position

pytestmark = pytest.mark.django_db


@pytest.fixture
def org(institution_factory, user_factory, membership_factory, employee_factory, assignment_dimensions_factory):
    """HR admin, a head of Engineering (with a Platform sub-department) and an outsider in Sales."""
    institution = institution_factory()
    InstitutionModule.objects.filter(institution=institution, module_code=InstitutionModule.ModuleCode.LEAVE).update(is_enabled=True)
    grade, location = assignment_dimensions_factory(institution)
    engineering = Department.objects.create(institution=institution, name="Engineering", code="ENG")
    platform = Department.objects.create(institution=institution, name="Platform", code="PLT", parent=engineering)
    sales = Department.objects.create(institution=institution, name="Sales", code="SAL")

    def person(email, role_code, department, reports_to=None):
        user = user_factory(email=email)
        membership_factory(user=user, institution=institution, role_code=role_code)
        employee = employee_factory(institution, user=user, first_name=email.split("@")[0].title(), personal_email=f"home.{email}")
        position = Position.objects.create(institution=institution, department=department, title=f"{department.name} role", code=f"P-{email[:6].upper()}")
        employment = Employment.objects.create(
            institution=institution, employee=employee, department=department, position=position,
            grade=grade, location=location, employment_type=Employment.EmploymentType.PERMANENT,
            start_date=date(2026, 1, 1), reports_to=reports_to,
        )
        return user, employee, employment

    hr_user, hr_employee, hr_employment = person("hr@example.com", "HR_ADMIN", sales)
    head_user, head_employee, head_employment = person("head@example.com", "DEPARTMENT_HEAD", engineering, reports_to=hr_employment)
    member_user, member_employee, _ = person("member@example.com", "EMPLOYEE", platform, reports_to=head_employment)
    outsider_user, outsider_employee, _ = person("outsider@example.com", "EMPLOYEE", sales, reports_to=hr_employment)
    engineering.head = head_employee
    engineering.save(update_fields=("head", "updated_at"))
    leave_type = LeaveType.objects.create(institution=institution, name="Annual Leave", code="test-annual")
    return {
        "institution": institution, "engineering": engineering, "sales": sales, "leave_type": leave_type,
        "hr": hr_user, "head": head_user, "member": member_user, "outsider": outsider_user,
        "head_employee": head_employee, "member_employee": member_employee, "outsider_employee": outsider_employee, "hr_employee": hr_employee,
    }


def _numbers(response):
    return {row["employee_number"] for row in response.data["results"]}


def test_department_head_sees_self_and_team_including_sub_departments(api_client, org):
    api_client.force_authenticate(org["head"])
    response = api_client.get(reverse("v1:employee-list"))

    assert response.status_code == 200
    assert _numbers(response) == {org["head_employee"].employee_number, org["member_employee"].employee_number}
    outsider = api_client.get(reverse("v1:employee-detail", args=[org["outsider_employee"].id]))
    assert outsider.status_code == 404


def test_hr_admin_keeps_institution_wide_access(api_client, org):
    api_client.force_authenticate(org["hr"])
    response = api_client.get(reverse("v1:employee-list"))

    assert len(_numbers(response)) == 4


def test_department_head_does_not_see_team_personal_details(api_client, org):
    api_client.force_authenticate(org["head"])
    rows = {row["employee_number"]: row for row in api_client.get(reverse("v1:employee-list")).data["results"]}

    assert "personal_email" not in rows[org["member_employee"].employee_number]
    assert "date_of_birth" not in rows[org["member_employee"].employee_number]
    assert rows[org["head_employee"].employee_number]["personal_email"] == "home.head@example.com"


def test_search_is_limited_to_the_team(api_client, org):
    api_client.force_authenticate(org["head"])
    response = api_client.get(reverse("v1:universal-search"), {"q": "example", "types": "EMPLOYEE"})
    everyone = api_client.get(reverse("v1:universal-search"), {"q": "Outsider", "types": "EMPLOYEE"})

    assert response.status_code == 200
    assert everyone.data["results"] == []


def _leave(org, employee):
    return LeaveRequest(
        institution=org["institution"], employee=employee, leave_type=org["leave_type"],
        start_date=date(2026, 10, 5), end_date=date(2026, 10, 6), requested_days=Decimal("2"),
    )


def test_team_leave_routes_to_department_head_then_hr(org):
    assert _configured_approvers(_leave(org, org["member_employee"])) == [org["head"], org["hr"]]


def test_head_never_approves_their_own_leave(org):
    approvers = _configured_approvers(_leave(org, org["head_employee"]))

    assert org["head"] not in approvers
    assert approvers == [org["hr"]]


def test_sole_hr_admin_leave_goes_to_an_institution_admin(org, user_factory, membership_factory):
    admin = user_factory(email="admin@example.com")
    membership_factory(user=admin, institution=org["institution"], role_code="INSTITUTION_ADMIN")

    assert _configured_approvers(_leave(org, org["hr_employee"])) == [admin]


def test_department_dashboard_is_scoped_and_hr_dashboard_is_denied(api_client, org):
    api_client.force_authenticate(org["head"])
    department = api_client.get(reverse("v1:dashboard-department"))
    hr_dashboard = api_client.get(reverse("v1:dashboard-hr"))

    assert department.status_code == 200
    assert {item["name"] for item in department.data["departments"]} == {"Engineering", "Platform"}
    assert [member["employee_number"] for member in department.data["team"]] == [org["member_employee"].employee_number]
    assert hr_dashboard.status_code == 403


def test_hr_assigns_department_head_within_the_tenant(api_client, org, institution_factory, employee_factory):
    api_client.force_authenticate(org["hr"])
    url = reverse("v1:department-detail", args=[org["sales"].id])
    other_tenant_employee = employee_factory(institution_factory())

    assigned = api_client.patch(url, {"head": str(org["hr_employee"].id)}, format="json")
    rejected = api_client.patch(url, {"head": str(other_tenant_employee.id)}, format="json")

    assert assigned.status_code == 200
    assert assigned.data["head_name"] == org["hr_employee"].full_name
    assert rejected.status_code == 400


def _sick_note(org, uploader):
    from apps.documents.models import Document

    return Document.objects.create(
        institution=org["institution"], uploaded_by=uploader, original_filename="sick-note.pdf",
        content_type="application/pdf", size_bytes=10, category="LEAVE_SUPPORTING", classification="CONFIDENTIAL",
    )


def test_leave_supporting_documents_are_visible_only_to_uploader_team_head_and_hr(api_client, org):
    note = _sick_note(org, org["member"])
    leave = _leave(org, org["member_employee"])
    leave.attachment = note
    leave.save()
    url = f"/api/v1/documents/{note.id}/"

    def status_for(user):
        api_client.force_authenticate(user)
        return api_client.get(url).status_code

    assert status_for(org["member"]) == 200
    assert status_for(org["head"]) == 200
    assert status_for(org["hr"]) == 200
    assert status_for(org["outsider"]) == 404


def test_cannot_attach_someone_elses_document_to_own_leave(api_client, org):
    note = _sick_note(org, org["member"])
    api_client.force_authenticate(org["outsider"])
    response = api_client.post("/api/v1/leave-requests/", {
        "employee": str(org["outsider_employee"].id), "leave_type": str(org["leave_type"].id),
        "start_date": "2026-10-05", "end_date": "2026-10-06", "attachment": str(note.id),
    }, format="json")

    assert response.status_code == 400
    assert "attachment" in response.data["errors"]
