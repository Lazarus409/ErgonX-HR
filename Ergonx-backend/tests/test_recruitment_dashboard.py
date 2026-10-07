from datetime import date

import pytest
from django.utils import timezone

from apps.employees.models import Employment
from apps.institutions.models import InstitutionModule
from apps.recruitment.models import Application, Candidate, JobPosting


@pytest.mark.django_db
def test_recruitment_dashboard_rollups_are_tenant_scoped(
    api_client, institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory
):
    institution = institution_factory(code="REC-DASH")
    foreign = institution_factory(code="REC-DASH-OTHER")
    InstitutionModule.objects.filter(institution=institution, module_code="RECRUITMENT").update(is_enabled=True)
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    api_client.force_authenticate(user)

    def posting(owner, code, title, status):
        department, position = organization_factory(owner)
        _, location = assignment_dimensions_factory(owner)
        return JobPosting.objects.create(
            institution=owner, code=code, title=title, department=department, position=position,
            location=location, employment_type=Employment.EmploymentType.PERMANENT, status=status,
        )

    busy = posting(institution, "JOB-1", "HR Analyst", JobPosting.Status.OPEN)
    quiet = posting(institution, "JOB-2", "Payroll Officer", JobPosting.Status.OPEN)
    posting(institution, "JOB-3", "Closed Role", JobPosting.Status.CLOSED)
    foreign_job = posting(foreign, "JOB-X", "Foreign Role", JobPosting.Status.OPEN)

    applied_now = timezone.now()
    for index, status in enumerate([Application.Status.ACTIVE, Application.Status.ACTIVE, Application.Status.OFFERED]):
        candidate = Candidate.objects.create(institution=institution, first_name=f"C{index}", last_name="Home", email=f"c{index}@example.com")
        Application.objects.create(institution=institution, job_posting=busy, candidate=candidate, status=status, applied_at=applied_now)
    candidate = Candidate.objects.create(institution=institution, first_name="Q", last_name="Home", email="q@example.com")
    Application.objects.create(institution=institution, job_posting=quiet, candidate=candidate, status=Application.Status.REJECTED, applied_at=applied_now)
    stranger = Candidate.objects.create(institution=foreign, first_name="F", last_name="Other", email="f@example.com")
    Application.objects.create(institution=foreign, job_posting=foreign_job, candidate=stranger, status=Application.Status.ACTIVE, applied_at=applied_now)

    response = api_client.get("/api/v1/dashboards/recruitment/")
    assert response.status_code == 200
    data = response.data

    assert {row["status"]: row["count"] for row in data["applications_by_status"]} == {"ACTIVE": 2, "OFFERED": 1, "REJECTED": 1}

    trend = data["applications_trend"]
    assert len(trend) == 6
    assert trend[-1]["month"] == date.today().replace(day=1).isoformat()
    assert trend[-1]["applications"] == 4
    assert sum(point["applications"] for point in trend) == 4

    assert [row["title"] for row in data["top_open_jobs"]] == ["HR Analyst", "Payroll Officer"]
    assert data["top_open_jobs"][0]["application_count"] == 3
