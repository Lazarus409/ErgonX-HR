"""Candidate profile, competency scorecard, candidate documents and application overview (Recruitment concepts)."""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.recruitment.models import Application, CompetencyRating, JobPosting, JobPostingTeamMember
from apps.recruitment.services import publish_job_posting, submit_application
from tests.test_recruitment import approved, recruitment_setup

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory(code="CAND-HOME")
    hr = user_factory(email="hr.cand@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    panel = user_factory(email="panel.cand@example.com")
    membership_factory(user=panel, institution=institution, role_code="EMPLOYEE")
    department, position, grade, location, stage, posting, candidate, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, hr)
    if posting.status != JobPosting.Status.OPEN:
        publish_job_posting(job_posting=approved(posting), actor=hr)
    if application.status == Application.Status.DRAFT:
        submit_application(application=application, actor=hr)
    application.refresh_from_db()
    return {"institution": institution, "hr": hr, "panel": panel, "posting": posting, "candidate": candidate, "application": application}


def _client(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return api_client


def test_candidate_profile_fields_round_trip(api_client, setup):
    client = _client(api_client, setup["hr"], setup["institution"])
    response = client.patch(f"/api/v1/recruitment/candidates/{setup['candidate'].id}/", {
        "location": "Accra, Ghana", "employment_status": "EMPLOYED", "linkedin_url": "https://www.linkedin.com/in/example",
        "current_employer": "Acme", "current_title": "Analyst", "years_experience": 4, "highest_qualification": "MASTERS",
        "field_of_study": "Economics", "education_institution": "University of Ghana", "skills": "SQL\nPython", "notice_period_weeks": 4,
    }, format="json")
    assert response.status_code == 200, response.content
    data = response.json()["data"]
    assert data["highest_qualification"] == "MASTERS" and data["full_name"]


def test_scorecard_panel_only_and_submit_lock(api_client, setup):
    application, panel = setup["application"], setup["panel"]
    client = _client(api_client, panel, setup["institution"])
    url = f"/api/v1/recruitment/applications/{application.id}/scorecard/"
    # A plain employee has no candidate.view, so cannot even read.
    assert client.get(url).status_code == 403

    client = _client(api_client, setup["hr"], setup["institution"])
    card = client.get(url).json()["data"]
    assert card["can_evaluate"] is True and len(card["competencies"]) == 6
    ratings = [{"competency": item["id"], "rating": "MEETS", "comment": ""} for item in card["competencies"]]
    partial = client.post(url, {"ratings": ratings[:2], "submit": True}, format="json")
    assert partial.status_code == 400
    saved = client.post(url, {"ratings": ratings, "submit": True}, format="json")
    assert saved.status_code == 200, saved.content
    assert saved.json()["data"]["locked"] is True
    assert saved.json()["data"]["summary"][0]["counts"] == {"MEETS": 1}
    again = client.post(url, {"ratings": ratings, "submit": False}, format="json")
    assert again.status_code == 400
    assert CompetencyRating.objects.filter(application=application, submitted_at__isnull=False).count() == 6


def test_hiring_team_member_can_evaluate(setup):
    from apps.recruitment.services import can_evaluate_application

    application, panel = setup["application"], setup["panel"]
    assert can_evaluate_application(application=application, user=panel) is False
    JobPostingTeamMember.objects.create(institution=setup["institution"], job_posting=setup["posting"], user=panel, role="INTERVIEW_PANEL")
    assert can_evaluate_application(application=application, user=panel) is True


def test_candidate_documents_and_overview(api_client, setup, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    client = _client(api_client, setup["hr"], setup["institution"])
    base = f"/api/v1/recruitment/candidates/{setup['candidate'].id}/documents/"
    upload = client.post(base, {"category": "CV", "uploaded_file": SimpleUploadedFile("cv.pdf", b"%PDF-1.4 test", content_type="application/pdf")}, format="multipart")
    assert upload.status_code == 201, upload.content
    bad = client.post(base, {"category": "NONSENSE", "uploaded_file": SimpleUploadedFile("x.txt", b"x")}, format="multipart")
    assert bad.status_code == 400
    listed = client.get(base).json()["data"]
    assert [row["category"] for row in listed] == ["CV"]
    download = client.get(f"{base}{listed[0]['id']}/download/")
    assert download.status_code == 200 and download["X-Content-Type-Options"] == "nosniff"

    overview = client.get(f"/api/v1/recruitment/applications/{setup['application'].id}/overview/")
    assert overview.status_code == 200, overview.content
    data = overview.json()["data"]
    assert data["job"]["title"] == setup["posting"].title
    assert data["documents"][0]["original_filename"] == "cv.pdf"
    assert data["actions"]["can_move"] is True
    assert {"recruitment.candidate.document_added", "recruitment.application.submitted"} <= {row["action"] for row in data["activity"]}

    removed = client.delete(f"{base}{listed[0]['id']}/")
    assert removed.status_code == 204
    assert client.get(base).json()["data"] == []
