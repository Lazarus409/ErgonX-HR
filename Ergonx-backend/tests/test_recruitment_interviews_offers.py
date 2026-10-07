"""Interview scheduling (availability, panel, drafts, invitation) and offer approval/letter (Recruitment concepts)."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.core import mail
from django.core.exceptions import ValidationError

from apps.compensation.models import SalaryStructure
from apps.employees.models import Employment
from apps.institutions.models import Role
from apps.recruitment.models import Application, Interview, JobPosting, Offer
from apps.recruitment.services import (
    approve_offer,
    decide_offer,
    extend_offer,
    generate_offer_letter,
    interview_availability,
    publish_job_posting,
    return_offer,
    schedule_interview,
    submit_application,
    submit_offer_for_approval,
)
from tests.test_recruitment import approved, recruitment_setup

pytestmark = pytest.mark.django_db
ZONE = "Africa/Accra"


@pytest.fixture
def setup(institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory(code="INT-HOME")
    hr = user_factory(email="hr.int@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    approver = user_factory(email="approver.int@example.com")
    membership_factory(user=approver, institution=institution, role_code="HR_ADMIN")
    panelist = user_factory(email="panel.int@example.com")
    membership_factory(user=panelist, institution=institution, role_code="EMPLOYEE")
    department, position, grade, location, stage, posting, candidate, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, hr)
    if posting.status != JobPosting.Status.OPEN:
        publish_job_posting(job_posting=approved(posting), actor=hr)
    submit_application(application=application, actor=hr)
    application.refresh_from_db()
    return {"institution": institution, "hr": hr, "approver": approver, "panelist": panelist, "application": application,
            "department": department, "position": position, "grade": grade, "location": location}


def _slot(days=3, hour=10):
    day = date.today() + timedelta(days=days)
    return day, datetime.combine(day, time(hour, 0), tzinfo=ZoneInfo(ZONE))


def test_schedule_checks_conflicts_and_availability(setup, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    application, hr, panelist = setup["application"], setup["hr"], setup["panelist"]
    day, start = _slot()
    interview = schedule_interview(application=application, actor=hr, scheduled_at=start, duration_minutes=60, interview_stage="FIRST_ROUND",
                                   mode="VIDEO", time_zone=ZONE, panel=[hr, panelist], location_or_link="https://meet.example/abc")
    assert interview.status == Interview.Status.SCHEDULED and interview.interviewer == hr
    assert interview.invitation_status == "SENT" and len(mail.outbox) == 1
    assert "first round interview" in interview.candidate_message and "Interviewers:" in interview.candidate_message

    slots = {row["time"]: row["state"] for row in interview_availability(institution=setup["institution"], day=day, interviewer_ids=[str(panelist.id)], time_zone=ZONE)["slots"]}
    assert slots["10:00"] == "conflict" and slots["12:00"] == "available"

    with pytest.raises(ValidationError):
        schedule_interview(application=application, actor=hr, scheduled_at=start + timedelta(minutes=30), duration_minutes=60,
                           interview_stage="SECOND_ROUND", mode="PHONE", time_zone=ZONE, panel=[panelist])

    draft = schedule_interview(application=application, actor=hr, scheduled_at=start, duration_minutes=60, interview_stage="FINAL",
                               mode="IN_PERSON", time_zone=ZONE, panel=[panelist], draft=True)
    assert draft.status == Interview.Status.DRAFT and draft.invitation_status == ""


def test_schedule_api_and_availability_endpoint(api_client, setup, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    api_client.force_authenticate(setup["hr"])
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(setup["institution"].id))
    day, start = _slot(days=4, hour=11)
    created = api_client.post("/api/v1/recruitment/interviews/schedule/", {
        "application": str(setup["application"].id), "scheduled_at": start.isoformat(), "duration_minutes": 45,
        "interview_stage": "SCREENING", "mode": "PHONE", "time_zone": ZONE, "panel": [str(setup["panelist"].id)], "agenda": "1. Intro",
    }, format="json")
    assert created.status_code == 201, created.content
    data = created.json()["data"]
    assert data["panel_members"][0]["id"] == str(setup["panelist"].id) and data["candidate_name"]
    response = api_client.get("/api/v1/recruitment/interviews/availability/", {"date": day.isoformat(), "interviewers": str(setup["panelist"].id), "time_zone": ZONE})
    assert response.status_code == 200
    assert {row["time"]: row["state"] for row in response.json()["data"]["slots"]}["11:00"] == "conflict"
    moved = api_client.post(f"/api/v1/recruitment/interviews/{data['id']}/reschedule/", {
        "application": str(setup["application"].id), "scheduled_at": (start + timedelta(hours=3)).isoformat(), "duration_minutes": 45,
        "interview_stage": "SCREENING", "mode": "PHONE", "time_zone": ZONE, "panel": [str(setup["panelist"].id)], "send_invitation": False,
    }, format="json")
    assert moved.status_code == 200, moved.content


def _offer(setup):
    structure = SalaryStructure.objects.create(institution=setup["institution"], name="Standard", code="STD-INT")
    return Offer.objects.create(
        institution=setup["institution"], application=setup["application"], proposed_start_date=date.today() + timedelta(days=30),
        employment_type=Employment.EmploymentType.CONTRACT, department=setup["department"], position=setup["position"], grade=setup["grade"],
        location=setup["location"], salary_structure=structure, base_salary="7500.00", currency="GHS", contract_length_months=12,
        working_pattern="FULL_TIME", expires_on=date.today() + timedelta(days=10),
    )


def test_offer_approval_letter_and_response(setup):
    hr, approver = setup["hr"], setup["approver"]
    offer = _offer(setup)
    offer = generate_offer_letter(offer=offer, actor=hr)
    assert "GHS 7,500.00" in offer.letter_body and "12 months" in offer.letter_body
    offer = submit_offer_for_approval(offer=offer, actor=hr)
    assert offer.status == Offer.Status.PENDING_APPROVAL
    with pytest.raises(ValidationError):
        approve_offer(offer=offer, actor=hr)
    with pytest.raises(ValidationError):
        return_offer(offer=offer, actor=approver, comment="")
    offer = return_offer(offer=offer, actor=approver, comment="Check start date")
    assert offer.status == Offer.Status.DRAFT
    offer = submit_offer_for_approval(offer=offer, actor=hr)
    offer = approve_offer(offer=offer, actor=approver, comment="Within budget")
    assert offer.status == Offer.Status.APPROVED
    offer = extend_offer(offer=offer, actor=hr)
    assert offer.status == Offer.Status.EXTENDED and offer.application.status == Application.Status.OFFERED
    offer = decide_offer(offer=offer, actor=hr, accepted=True, note="Accepted by phone")
    assert offer.response_note == "Accepted by phone" and offer.response_recorded_by == hr


def test_offer_api_edit_resets_approval_and_activity(api_client, setup):
    offer = _offer(setup)
    submit_offer_for_approval(offer=offer, actor=setup["hr"])
    approve_offer(offer=offer, actor=setup["approver"])
    api_client.force_authenticate(setup["hr"])
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(setup["institution"].id))
    patched = api_client.patch(f"/api/v1/recruitment/offers/{offer.id}/", {"base_salary": "8000.00"}, format="json")
    assert patched.status_code == 200, patched.content
    assert patched.json()["data"]["status"] == "DRAFT" and patched.json()["data"]["candidate_name"]
    activity = api_client.get(f"/api/v1/recruitment/offers/{offer.id}/activity/").json()["data"]
    assert {"recruitment.offer.submitted", "recruitment.offer.approved"} <= {row["action"] for row in activity}


def test_offer_approve_permission_roles(setup):
    assert Role.objects.filter(institution=setup["institution"], code="DIRECTOR", permissions__code="offer.approve").exists()
    assert Role.objects.filter(institution=setup["institution"], code="HR_ADMIN", permissions__code="offer.approve").exists()
