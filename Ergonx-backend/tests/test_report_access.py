import pytest

pytestmark = pytest.mark.django_db

REPORTS = ("workforce-cost", "recruitment", "leave", "attendance", "payroll", "accounting", "ap-ar", "expenses")


def _visible(api_client):
    return {name for name in REPORTS if api_client.get(f"/api/v1/reports/{name}/").status_code == 200}


def test_reports_follow_the_role_permissions_behind_their_data(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="REPORT-ACCESS")
    for module in ("LEAVE", "ATTENDANCE", "PAYROLL", "ACCOUNTING", "RECRUITMENT", "REPORTS"):
        institution.modules.filter(module_code=module).update(is_enabled=True)

    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(hr)
    hr_reports = _visible(api_client)
    assert {"workforce-cost", "recruitment", "leave", "attendance", "payroll"} <= hr_reports
    assert hr_reports.isdisjoint({"accounting", "ap-ar", "expenses"})
    denied = api_client.get("/api/v1/reports/accounting/")
    assert denied.status_code == 403
    assert "does not include access" in str(denied.data)

    finance = user_factory()
    membership_factory(user=finance, institution=institution, role_code="FINANCE_MANAGER", is_primary=True)
    api_client.force_authenticate(finance)
    finance_reports = _visible(api_client)
    assert {"accounting", "ap-ar", "expenses", "payroll"} <= finance_reports
    # Finance staff hold leave.view / attendance.view for their own records only,
    # which does not open the institution-wide leave and attendance reports.
    assert finance_reports.isdisjoint({"workforce-cost", "recruitment", "leave", "attendance"})

    admin = user_factory()
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    api_client.force_authenticate(admin)
    assert _visible(api_client) == set(REPORTS)


def test_positions_and_departments_expose_related_names(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="ORG-NAMES")
    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(hr)

    parent = api_client.post("/api/v1/departments/", {"name": "Operations"}, format="json")
    assert parent.status_code == 201, parent.data
    assert parent.data["code"]
    child = api_client.post("/api/v1/departments/", {"name": "Field Services", "parent": parent.data["id"]}, format="json")
    assert child.status_code == 201, child.data
    assert child.data["parent_name"] == "Operations"

    position = api_client.post("/api/v1/positions/", {"title": "Field Engineer", "department": child.data["id"]}, format="json")
    assert position.status_code == 201, position.data
    assert position.data["department_name"] == "Field Services"

    location = api_client.post("/api/v1/locations/", {"name": "Kumasi Branch", "city": "Kumasi", "country": "GH", "timezone": "Africa/Accra"}, format="json")
    assert location.status_code == 201, location.data
    renamed = api_client.patch(f"/api/v1/locations/{location.data['id']}/", {"name": "Kumasi Office", "is_active": False}, format="json")
    assert renamed.status_code == 200, renamed.data
    assert renamed.data["name"] == "Kumasi Office" and renamed.data["is_active"] is False


def test_directors_and_auditors_read_every_report_but_auditors_do_not_approve(
    api_client, institution_factory, user_factory, membership_factory, employee_factory,
):
    from datetime import date

    from apps.attendance.models import AttendanceRecord

    institution = institution_factory(code="REPORT-OVERSIGHT")
    for module in ("LEAVE", "ATTENDANCE", "PAYROLL", "ACCOUNTING", "RECRUITMENT", "REPORTS"):
        institution.modules.filter(module_code=module).update(is_enabled=True)
    absent = employee_factory(institution, first_name="Kofi", last_name="Boateng")
    AttendanceRecord.objects.create(institution=institution, employee=absent, attendance_date=date(2026, 9, 10), status="ABSENT", source="MANUAL")

    for role_code in ("DIRECTOR", "AUDITOR"):
        user = user_factory()
        membership_factory(user=user, institution=institution, role_code=role_code, is_primary=True)
        api_client.force_authenticate(user)
        assert _visible(api_client) == set(REPORTS), role_code
        # Drill-downs are institution-wide, not limited to the viewer's own records.
        details = api_client.get("/api/v1/reports/attendance/", {"group": "ABSENT"})
        assert [row["employee"] for row in details.data["rows"]] == ["Kofi Boateng"], role_code

    # The auditor reads, but never sees or acts on the approval queue.
    assert api_client.get("/api/v1/approval-requests/").status_code == 403

    hr = user_factory()
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(hr)
    assert _visible(api_client).isdisjoint({"accounting", "ap-ar", "expenses"})
