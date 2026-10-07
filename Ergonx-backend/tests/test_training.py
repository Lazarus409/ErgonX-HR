"""Training records (ErgonX HR): courses, enrolment lifecycle, certificates, access."""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.notifications.models import Notification
from apps.training.models import TrainingCourse, TrainingEnrollment
from apps.training.services import EXPIRED, EXPIRING, VALID, current_certifications

pytestmark = pytest.mark.django_db

COURSES = "/api/v1/training-courses/"
ENROLLMENTS = "/api/v1/training-enrollments/"


@pytest.fixture
def setup(api_client, institution_factory, user_factory, membership_factory, employee_factory):
    institution = institution_factory()
    hr = user_factory(email="hr.training@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    api_client.force_authenticate(hr)
    return api_client, institution, hr, employee_factory


def course(institution, **values):
    return TrainingCourse.objects.create(institution=institution, title=values.pop("title", "Fire safety"), **values)


def test_course_gets_code_and_is_audited(setup):
    client, institution, _, _ = setup
    response = client.post(COURSES, {"title": "Fire Safety & Evacuation", "category": "SAFETY", "certificate_validity_months": 24}, format="json")
    assert response.status_code == 201, response.data
    assert response.data["code"] == "TRN-001"
    assert AuditLog.objects.filter(institution=institution, action="training.course.created").exists()
    assert client.post(COURSES, {"title": "Bad", "certificate_validity_months": 0}, format="json").status_code == 400


def test_enrol_complete_and_certificate_expiry(setup, user_factory, membership_factory):
    client, institution, _, employee_factory = setup
    staff = user_factory(email="staff.training@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    person = employee_factory(institution, user=staff)
    other = employee_factory(institution)
    safety = course(institution, certificate_validity_months=12)
    response = client.post(ENROLLMENTS, {"course": str(safety.id), "employees": [str(person.id), str(other.id)], "planned_start": "2026-03-02"}, format="json")
    assert response.status_code == 201 and len(response.data["created"]) == 2
    # Enrolling again while still open is skipped, not duplicated.
    again = client.post(ENROLLMENTS, {"course": str(safety.id), "employees": [str(person.id)]}, format="json")
    assert again.data["created"] == [] and len(again.data["skipped"]) == 1
    assert Notification.objects.filter(user=staff, notification_type="TRAINING_ENROLLED").exists()

    enrollment = TrainingEnrollment.objects.get(employee=person)
    assert client.post(f"{ENROLLMENTS}{enrollment.id}/start/").data["status"] == "IN_PROGRESS"
    completed = client.post(f"{ENROLLMENTS}{enrollment.id}/complete/", {"completed_on": "2026-03-06", "score": "88", "certificate_number": "FS-001"}, format="json")
    assert completed.status_code == 200, completed.data
    assert completed.data["status"] == "COMPLETED" and completed.data["certificate_expires_on"] == "2027-03-06"
    assert client.post(f"{ENROLLMENTS}{enrollment.id}/cancel/").status_code == 400
    assert AuditLog.objects.filter(action="training.enrollment.completed").exists()


def test_future_completion_and_failed_course(setup):
    client, institution, _, employee_factory = setup
    person = employee_factory(institution)
    safety = course(institution, certificate_validity_months=12)
    enrollment = TrainingEnrollment.objects.create(institution=institution, course=safety, employee=person)
    future = (timezone.localdate() + timedelta(days=3)).isoformat()
    assert client.post(f"{ENROLLMENTS}{enrollment.id}/complete/", {"completed_on": future}, format="json").status_code == 400
    failed = client.post(f"{ENROLLMENTS}{enrollment.id}/complete/", {"passed": False, "score": "40"}, format="json").data
    assert failed["status"] == "NOT_PASSED" and failed["certificate_expires_on"] is None


def test_certification_status_uses_latest_completion(setup):
    _, institution, _, employee_factory = setup
    person = employee_factory(institution)
    safety = course(institution, certificate_validity_months=12)
    today = timezone.localdate()
    TrainingEnrollment.objects.create(institution=institution, course=safety, employee=person, status="COMPLETED", completed_on=today - timedelta(days=500), certificate_expires_on=today - timedelta(days=135))
    rows = current_certifications(TrainingEnrollment.objects.all(), today)
    assert [row["status"] for row in rows] == [EXPIRED]
    TrainingEnrollment.objects.create(institution=institution, course=safety, employee=person, status="COMPLETED", completed_on=today - timedelta(days=330), certificate_expires_on=today + timedelta(days=35))
    assert [row["status"] for row in current_certifications(TrainingEnrollment.objects.all(), today)] == [EXPIRING]
    assert current_certifications(TrainingEnrollment.objects.filter(certificate_expires_on__gt=today + timedelta(days=90)), today) == []
    assert VALID


def test_overview_counts(setup):
    client, institution, _, employee_factory = setup
    person = employee_factory(institution)
    safety = course(institution, certificate_validity_months=12)
    TrainingEnrollment.objects.create(institution=institution, course=safety, employee=person, status="PLANNED")
    TrainingEnrollment.objects.create(institution=institution, course=safety, employee=employee_factory(institution), status="COMPLETED", completed_on=date(timezone.localdate().year, 1, 15), certificate_expires_on=timezone.localdate() + timedelta(days=10))
    data = client.get(f"{ENROLLMENTS}overview/").data
    assert data["planned"] == 1 and data["completed_this_year"] == 1 and data["certificates_expiring"] == 1 and len(data["attention"]) == 1


def test_employee_sees_only_own_training(setup, user_factory, membership_factory):
    client, institution, _, employee_factory = setup
    staff = user_factory(email="staff.own@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    own, other = employee_factory(institution, user=staff), employee_factory(institution)
    safety = course(institution)
    TrainingEnrollment.objects.create(institution=institution, course=safety, employee=own)
    TrainingEnrollment.objects.create(institution=institution, course=safety, employee=other)
    client.force_authenticate(staff)
    mine = client.get("/api/v1/training/my/")
    assert mine.status_code == 200 and len(mine.data["enrollments"]) == 1
    assert client.get(ENROLLMENTS).status_code == 403
    assert client.post(COURSES, {"title": "X"}, format="json").status_code == 403
