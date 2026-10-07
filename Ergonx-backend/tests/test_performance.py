"""Performance reviews (ErgonX HR): cycle launch, three-stage workflow, visibility, access."""

from datetime import date

import pytest

from apps.audit.models import AuditLog
from apps.employees.models import Employment
from apps.notifications.models import Notification
from apps.performance.models import Competency, PerformanceReview, ReviewCycle

pytestmark = pytest.mark.django_db

CYCLES = "/api/v1/review-cycles/"
REVIEWS = "/api/v1/performance-reviews/"


@pytest.fixture
def team(api_client, institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    """HR admin, a manager (department head) and one employee reporting to them."""
    institution = institution_factory()
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)

    def person(email, role):
        user = user_factory(email=email)
        membership_factory(user=user, institution=institution, role_code=role)
        employee = employee_factory(institution, user=user)
        employment = Employment.objects.create(institution=institution, employee=employee, department=department, position=position, grade=grade, location=location, employment_type="PERMANENT", staff_category="SENIOR", start_date=date(2025, 1, 1), status="ACTIVE", is_current=True)
        return user, employee, employment

    hr, _, _ = person("hr.perf@example.com", "HR_ADMIN")
    manager, manager_employee, manager_employment = person("manager.perf@example.com", "DEPARTMENT_HEAD")
    staff, staff_employee, staff_employment = person("staff.perf@example.com", "EMPLOYEE")
    staff_employment.reports_to = manager_employment
    staff_employment.save()
    competencies = [Competency.objects.create(institution=institution, name=name, sort_order=index) for index, name in enumerate(("Job knowledge", "Safety compliance"))]
    return {"client": api_client, "institution": institution, "hr": hr, "manager": manager, "staff": staff, "staff_employee": staff_employee, "competencies": competencies}


def launch(team):
    client = team["client"]
    client.force_authenticate(team["hr"])
    response = client.post(CYCLES, {"name": "2026 Mid-Year Review", "period_start": "2026-01-01", "period_end": "2026-06-30", "competencies": [str(item.id) for item in team["competencies"]]}, format="json")
    assert response.status_code == 201, response.data
    launched = client.post(f"{CYCLES}{response.data['id']}/launch/", {"employees": [str(team["staff_employee"].id)]}, format="json")
    assert launched.status_code == 200, launched.data
    return PerformanceReview.objects.get(employee=team["staff_employee"])


def ratings(team, value):
    return [{"competency": str(item.id), "rating": value, "comment": "Solid"} for item in team["competencies"]]


def test_full_review_workflow(team):
    client = team["client"]
    review = launch(team)
    assert review.reviewer == team["manager"]  # Taken from the reporting line.
    assert review.ratings.count() == 2
    assert Notification.objects.filter(user=team["staff"], notification_type="PERFORMANCE_SELF_ASSESSMENT").exists()

    client.force_authenticate(team["staff"])
    incomplete = client.post(f"{REVIEWS}{review.id}/self-assessment/", {"ratings": ratings(team, 4)[:1], "submit": True}, format="json")
    assert incomplete.status_code == 400
    submitted = client.post(f"{REVIEWS}{review.id}/self-assessment/", {"ratings": ratings(team, 4), "summary": "Good half-year.", "submit": True}, format="json")
    assert submitted.status_code == 200 and submitted.data["status"] == "MANAGER_REVIEW"

    client.force_authenticate(team["manager"])
    done = client.post(f"{REVIEWS}{review.id}/manager-review/", {"ratings": ratings(team, 3), "overall_rating": 4, "summary": "Reliable.", "submit": True}, format="json")
    assert done.status_code == 200 and done.data["status"] == "HR_REVIEW"

    client.force_authenticate(team["hr"])
    returned = client.post(f"{REVIEWS}{review.id}/return/", {"comment": "Add a development plan."}, format="json")
    assert returned.data["status"] == "MANAGER_REVIEW"
    client.force_authenticate(team["manager"])
    client.post(f"{REVIEWS}{review.id}/manager-review/", {"development_plan": "Supervisor course.", "submit": True}, format="json")
    client.force_authenticate(team["hr"])
    signed = client.post(f"{REVIEWS}{review.id}/sign-off/", {"comment": "Agreed."}, format="json")
    assert signed.status_code == 200 and signed.data["status"] == "COMPLETED"
    assert AuditLog.objects.filter(action="performance.review.signed_off").exists()
    assert Notification.objects.filter(user=team["staff"], notification_type="PERFORMANCE_COMPLETED").exists()


def test_employee_sees_manager_rating_only_after_sign_off(team):
    client = team["client"]
    review = launch(team)
    client.force_authenticate(team["staff"])
    client.post(f"{REVIEWS}{review.id}/self-assessment/", {"ratings": ratings(team, 5), "submit": True}, format="json")
    client.force_authenticate(team["manager"])
    client.post(f"{REVIEWS}{review.id}/manager-review/", {"ratings": ratings(team, 2), "overall_rating": 2, "submit": True}, format="json")
    client.force_authenticate(team["staff"])
    pending = client.get(f"{REVIEWS}{review.id}/").data
    assert pending["overall_rating"] is None and pending["ratings"][0]["manager_rating"] is None
    assert pending["ratings"][0]["self_rating"] == 5


def test_reviewer_cannot_see_unsubmitted_self_assessment(team):
    client = team["client"]
    review = launch(team)
    client.force_authenticate(team["staff"])
    client.post(f"{REVIEWS}{review.id}/self-assessment/", {"ratings": ratings(team, 5), "summary": "Draft"}, format="json")
    client.force_authenticate(team["manager"])
    data = client.get(f"{REVIEWS}{review.id}/").data
    assert data["self_summary"] is None and data["ratings"][0]["self_rating"] is None


def test_only_the_right_people_can_act(team, user_factory, membership_factory):
    client = team["client"]
    review = launch(team)
    outsider = user_factory(email="outsider.perf@example.com")
    membership_factory(user=outsider, institution=team["institution"], role_code="EMPLOYEE")
    client.force_authenticate(outsider)
    assert client.get(f"{REVIEWS}{review.id}/").status_code == 404
    client.force_authenticate(team["manager"])
    assert client.post(f"{REVIEWS}{review.id}/self-assessment/", {"submit": True}, format="json").status_code == 400
    client.force_authenticate(team["staff"])
    assert client.post(f"{REVIEWS}{review.id}/sign-off/").status_code == 403
    assert client.post(CYCLES, {"name": "X", "period_start": "2026-01-01", "period_end": "2026-02-01", "competencies": []}, format="json").status_code == 403


def test_release_reassign_and_summary(team):
    client = team["client"]
    review = launch(team)
    client.force_authenticate(team["hr"])
    assert client.post(f"{REVIEWS}{review.id}/release/").data["status"] == "MANAGER_REVIEW"
    assert str(client.post(f"{REVIEWS}{review.id}/reassign/", {"reviewer": str(team["hr"].id)}, format="json").data["reviewer"]) == str(team["hr"].id)
    summary = client.get(f"{CYCLES}{review.cycle_id}/summary/").data
    assert summary["total"] == 1 and summary["by_status"]["MANAGER_REVIEW"] == 1 and summary["completion_rate"] == 0.0
    cycle = ReviewCycle.objects.get(pk=review.cycle_id)
    assert client.post(f"{CYCLES}{cycle.id}/close/").data["status"] == "CLOSED"
    client.force_authenticate(team["hr"])
    # A closed cycle accepts no more assessment changes.
    assert client.post(f"{REVIEWS}{review.id}/manager-review/", {"overall_rating": 3}, format="json").status_code == 400
