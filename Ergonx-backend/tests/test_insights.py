from datetime import date, timedelta

import pytest

from apps.employees.models import Employee, Employment


def _employ(institution, employee, organization_factory, assignment_dimensions_factory, **kwargs):
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    return Employment.objects.create(
        institution=institution,
        employee=employee,
        department=department,
        position=position,
        grade=grade,
        location=location,
        employment_type=kwargs.pop("employment_type", Employment.EmploymentType.PERMANENT),
        start_date=kwargs.pop("start_date", employee.hire_date),
        **kwargs,
    )


@pytest.mark.django_db
def test_insights_workforce_is_tenant_scoped_and_reports_real_shares(
    api_client, institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory
):
    institution = institution_factory(code="INSIGHTS")
    foreign = institution_factory(code="INSIGHTS-OTHER")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))

    today = date.today()
    long_ago = today - timedelta(days=365 * 6)
    first = employee_factory(institution, gender=Employee.Gender.FEMALE, date_of_birth=today - timedelta(days=365 * 30), hire_date=long_ago)
    second = employee_factory(institution, gender=Employee.Gender.MALE, date_of_birth=None, hire_date=today - timedelta(days=30))
    _employ(institution, first, organization_factory, assignment_dimensions_factory)
    _employ(institution, second, organization_factory, assignment_dimensions_factory, employment_type=Employment.EmploymentType.CONTRACT)
    stranger = employee_factory(foreign, gender=Employee.Gender.MALE)
    _employ(foreign, stranger, organization_factory, assignment_dimensions_factory)

    response = api_client.get("/api/v1/home/insights/?months=6")
    assert response.status_code == 200
    data = response.data
    assert data["range_months"] == 6
    assert data["access"]["workforce"] is True
    workforce = data["workforce"]
    assert workforce["total_employees"] == 2
    assert {row["label"]: row["count"] for row in workforce["demographics"]["gender"]} == {"Female": 1, "Male": 1}
    ages = {row["label"]: row["count"] for row in workforce["age_distribution"]}
    assert ages["25 - 34"] == 1 and ages["Not recorded"] == 1
    tenure = {row["label"]: row["count"] for row in workforce["tenure_distribution"]}
    assert tenure["< 1 year"] == 1 and tenure["5 - 10 years"] == 1
    assert {row["label"] for row in workforce["demographics"]["employment_status"]} == {"Permanent", "Contract"}
    assert len(workforce["headcount_trend"]) == 6
    assert workforce["headcount_trend"][-1]["headcount"] == 2
    # One employee started within the range, so the previous period had one.
    assert data["kpis"]["employees"] == {"value": 2, "previous": 1, "change_percent": 100}
    assert data["module_trend"]["series"][0]["code"] == "HR"


@pytest.mark.django_db
def test_insights_hides_sections_the_caller_cannot_see(
    api_client, institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory
):
    institution = institution_factory(code="INSIGHTS-LIMITED")
    employee = employee_factory(institution)
    _employ(institution, employee, organization_factory, assignment_dimensions_factory)
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="EMPLOYEE", is_primary=True)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))

    response = api_client.get("/api/v1/home/insights/")
    assert response.status_code == 200
    data = response.data
    assert data["range_months"] == 12
    assert not any(data["access"].values())
    assert data["workforce"] is None
    assert data["kpis"] == {"employees": None, "payroll": None, "revenue": None, "revenue_ytd": None, "alerts": None, "compliance": None}
    assert data["revenue_by_source"] is None
    assert data["module_trend"] is None
    assert data["leave_attendance"] is None


@pytest.mark.django_db
def test_insights_compliance_counts_leave_policy_and_payroll_exceptions(
    api_client, institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory
):
    from apps.institutions.models import InstitutionModule
    from apps.leave.models import LeaveRequest, LeaveType

    institution = institution_factory(code="INSIGHTS-COMPLIANCE")
    InstitutionModule.objects.filter(institution=institution, module_code="LEAVE").update(is_enabled=True)
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    employee = employee_factory(institution, hire_date=date.today() - timedelta(days=400))
    _employ(institution, employee, organization_factory, assignment_dimensions_factory)
    leave_type = LeaveType.objects.create(institution=institution, code="UNCOVERED", name="Uncovered leave")
    # No leave policy exists, so this request fails the policy check.
    LeaveRequest.objects.create(
        institution=institution, employee=employee, leave_type=leave_type, start_date=date.today(), end_date=date.today(),
        requested_days=1, status=LeaveRequest.Status.PENDING,
    )

    data = api_client.get("/api/v1/home/insights/").data
    compliance = data["kpis"]["compliance"]
    assert compliance["checks"][0] == {"code": "leave_policy", "label": "Leave requests within policy", "passed": 0, "total": 1}
    assert compliance["value"] == 0
    # HR has no finance access.
    assert data["kpis"]["revenue_ytd"] is None and data["revenue_by_source"] is None
