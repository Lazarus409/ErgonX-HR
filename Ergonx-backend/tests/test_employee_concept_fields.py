"""Profile and employment-terms fields added for the Employee detail concept."""
from datetime import date

import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse

from apps.employees.models import Employment
from apps.employees.services import change_current_employment

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(institution_factory, organization_factory, assignment_dimensions_factory, employee_factory, user_factory, membership_factory):
    institution = institution_factory()
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    employee = employee_factory(institution, preferred_name="Emmy", mobile_phone="+233 20 000 0000", linkedin_url="https://www.linkedin.com/in/emmy")
    hr_user = user_factory(email="hr.concept@example.com")
    membership_factory(user=hr_user, institution=institution, role_code="HR_ADMIN")
    base = dict(
        institution=institution, employee=employee, department=department, position=position,
        grade=grade, location=location, employment_type=Employment.EmploymentType.PERMANENT,
        start_date=date(2026, 1, 5),
    )
    return {"institution": institution, "employee": employee, "hr": hr_user, "base": base}


def test_employment_terms_are_stored(setup):
    employment = change_current_employment(
        **setup["base"],
        working_pattern=Employment.WorkingPattern.FULL_TIME,
        work_arrangement=Employment.WorkArrangement.HYBRID,
        office_days=["TUE", "WED", "THU"],
        time_zone="Africa/Accra",
        team="Brand & Campaigns",
        cost_centre="MKT-01",
        probation_status=Employment.ProbationStatus.COMPLETED,
        probation_end_date=date(2026, 4, 5),
        notice_period_weeks=4,
    )
    employment.refresh_from_db()
    assert employment.office_days == ["TUE", "WED", "THU"]
    assert employment.work_arrangement == "HYBRID"
    assert employment.notice_period_weeks == 4


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"office_days": ["MON", "FUNDAY"]}, "office_days"),
        ({"office_days": ["MON", "MON"]}, "office_days"),
        ({"time_zone": "Mars/Olympus"}, "time_zone"),
        ({"probation_end_date": date(2025, 12, 1)}, "probation_end_date"),
    ],
)
def test_invalid_employment_terms_are_rejected(setup, overrides, field):
    with pytest.raises(ValidationError) as caught:
        change_current_employment(**setup["base"], **overrides)
    assert field in caught.value.message_dict


def test_api_exposes_new_profile_and_terms_fields(api_client, setup):
    change_current_employment(**setup["base"], team="People Ops", work_arrangement=Employment.WorkArrangement.REMOTE)
    api_client.force_authenticate(setup["hr"])
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(setup["institution"].id))

    employee = api_client.get(reverse("v1:employee-detail", args=[setup["employee"].id]))
    assert employee.status_code == 200
    body = employee.json()["data"]
    assert body["preferred_name"] == "Emmy"
    assert body["mobile_phone"] == "+233 20 000 0000"
    assert body["linkedin_url"] == "https://www.linkedin.com/in/emmy"

    employments = api_client.get(reverse("v1:employment-list"), {"employee": setup["employee"].id})
    assert employments.status_code == 200
    row = employments.json()["data"]["results"][0]
    assert row["team"] == "People Ops"
    assert row["work_arrangement"] == "REMOTE"
    assert row["office_days"] == []


def test_hr_can_update_employment_terms(api_client, setup):
    employment = change_current_employment(**setup["base"])
    api_client.force_authenticate(setup["hr"])
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(setup["institution"].id))

    response = api_client.patch(
        reverse("v1:employment-detail", args=[employment.id]),
        {"office_days": ["MON", "FRI"], "cost_centre": "HR-02", "notice_period_weeks": 2},
        format="json",
    )
    assert response.status_code == 200, response.content
    employment.refresh_from_db()
    assert employment.office_days == ["MON", "FRI"]
    assert employment.cost_centre == "HR-02"

    bad = api_client.patch(reverse("v1:employment-detail", args=[employment.id]), {"office_days": ["NOPE"]}, format="json")
    assert bad.status_code == 400
