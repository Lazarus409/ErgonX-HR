"""Requisition approval, hiring plan, hiring team and recruitment board (Recruitment concepts)."""
from datetime import date, timedelta

import pytest
from django.core.exceptions import ValidationError

from apps.institutions.models import Role
from apps.recruitment.models import JobPosting, JobPostingTeamMember
from apps.recruitment.services import (
    add_hiring_team_member,
    approve_job_posting,
    publish_job_posting,
    return_job_posting,
    submit_job_posting_for_approval,
)
from tests.test_recruitment import recruitment_setup

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory(code="REQ-HOME")
    hr = user_factory(email="hr.req@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    approver = user_factory(email="approver.req@example.com")
    membership_factory(user=approver, institution=institution, role_code="HR_ADMIN")
    staff = user_factory(email="staff.req@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    department, position, grade, location, stage, posting, candidate, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, hr)
    return {"institution": institution, "hr": hr, "approver": approver, "staff": staff, "posting": posting, "grade": grade, "position": position}


def _complete(posting, hr):
    posting.hiring_reason = JobPosting.HiringReason.NEW_ROLE
    posting.target_start_date = date.today() + timedelta(days=60)
    posting.hiring_manager = hr
    posting.responsibilities = "Lead HR analytics."
    posting.qualifications_essential = "Degree in a relevant field."
    posting.save()


def test_submit_requires_hiring_plan_fields(setup):
    with pytest.raises(ValidationError) as caught:
        submit_job_posting_for_approval(job_posting=setup["posting"], actor=setup["hr"])
    assert {"hiring_reason", "target_start_date", "responsibilities"} <= set(caught.value.message_dict)


def test_submit_approve_publish_with_separation(setup):
    posting, hr, approver = setup["posting"], setup["hr"], setup["approver"]
    _complete(posting, hr)
    posting = submit_job_posting_for_approval(job_posting=posting, actor=hr)
    assert posting.status == JobPosting.Status.PENDING_APPROVAL
    with pytest.raises(ValidationError):
        approve_job_posting(job_posting=posting, actor=hr)  # submitter cannot approve
    posting = approve_job_posting(job_posting=posting, actor=approver, comment="Budgeted")
    assert posting.status == JobPosting.Status.APPROVED and posting.approved_by == approver
    posting = publish_job_posting(job_posting=posting, actor=hr)
    assert posting.status == JobPosting.Status.OPEN


def test_return_for_changes_and_non_approver_cannot_publish_draft(setup, membership_factory, user_factory):
    posting, hr, approver = setup["posting"], setup["hr"], setup["approver"]
    _complete(posting, hr)
    submit_job_posting_for_approval(job_posting=posting, actor=hr)
    with pytest.raises(ValidationError):
        return_job_posting(job_posting=posting, actor=approver, comment="")
    posting = return_job_posting(job_posting=posting, actor=approver, comment="Add salary range")
    assert posting.status == JobPosting.Status.DRAFT and posting.approval_note == "Add salary range"
    officer = user_factory(email="officer.req@example.com")
    membership_factory(user=officer, institution=setup["institution"], role_code="EMPLOYEE")
    with pytest.raises(ValidationError):
        publish_job_posting(job_posting=posting, actor=officer)


def test_salary_range_validation(setup):
    posting = setup["posting"]
    posting.salary_min, posting.salary_max, posting.salary_currency = 5000, 4000, "GHS"
    with pytest.raises(ValidationError):
        posting.full_clean()


def test_hiring_team_and_api(api_client, setup):
    posting, hr, approver = setup["posting"], setup["hr"], setup["approver"]
    member = add_hiring_team_member(job_posting=posting, actor=hr, user=approver, role=JobPostingTeamMember.Role.INTERVIEW_PANEL)
    assert member.role == "INTERVIEW_PANEL"
    with pytest.raises(ValidationError):
        add_hiring_team_member(job_posting=posting, actor=hr, user=approver, role=JobPostingTeamMember.Role.HR_PARTNER)

    api_client.force_authenticate(hr)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(setup["institution"].id))
    base = f"/api/v1/recruitment/job-postings/{posting.id}/"
    detail = api_client.get(base).json()["data"]
    assert detail["department_name"] and "application_counts" in detail
    team = api_client.get(base + "team/").json()["data"]
    assert team[0]["user_name"] and team[0]["role"] == "INTERVIEW_PANEL"
    removed = api_client.delete(base + f"team/{team[0]['id']}/")
    assert removed.status_code == 204
    history = api_client.get(base + "history/").json()["data"]
    assert {"recruitment.requisition.team_added", "recruitment.requisition.team_removed"} <= {row["action"] for row in history}
    people = api_client.get("/api/v1/recruitment/job-postings/people/")
    assert people.status_code == 200 and {"id", "name", "role"} == set(people.json()["data"][0])
    activity = api_client.get(base + "activity/")
    assert activity.status_code == 200 and "by_stage" in activity.json()["data"]

    patched = api_client.patch(base, {"hiring_reason": "REPLACEMENT", "salary_currency": "ghs", "salary_min": "4000", "salary_max": "6000", "grade": str(setup["grade"].id)}, format="json")
    assert patched.status_code == 200, patched.content
    assert patched.json()["data"]["salary_currency"] == "GHS"

    board = api_client.get("/api/v1/dashboards/recruitment/", {"months": 6})
    assert board.status_code == 200, board.content
    data = board.json()["data"]
    assert data["range_months"] == 6
    assert [column["key"] for column in data["board"]][0] == "draft" and data["board"][-1]["key"] == "hired"
    for key in ("open_roles", "candidates_in_process", "interviews_this_week", "offers_pending"):
        assert key in data


def test_director_role_can_approve_requisitions(setup):
    assert Role.objects.filter(institution=setup["institution"], code="DIRECTOR", permissions__code="job_posting.approve").exists()
