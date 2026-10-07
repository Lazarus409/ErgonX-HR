from datetime import date

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.employees.models import Employee
from apps.organization.models import Department
from apps.recruitment.models import JobPosting

pytestmark = pytest.mark.django_db


def _admin(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    return institution, user


def test_employee_number_is_generated_when_blank(api_client, institution_factory, user_factory, membership_factory):
    institution, _ = _admin(api_client, institution_factory, user_factory, membership_factory)

    first = api_client.post(reverse("v1:employee-list"), {"first_name": "Ama", "last_name": "Mensah", "hire_date": "2026-01-01"}, format="json")
    second = api_client.post(reverse("v1:employee-list"), {"employee_number": "", "first_name": "Kofi", "last_name": "Boateng", "hire_date": "2026-01-01"}, format="json")

    assert first.status_code == 201, first.data
    assert second.status_code == 201, second.data
    assert first.data["employee_number"] == "EMP-000001"
    assert second.data["employee_number"] == "EMP-000002"


def test_generated_codes_continue_after_existing_ones_and_skip_foreign_formats(institution_factory, employee_factory):
    institution = institution_factory()
    other = institution_factory()
    employee_factory(institution, employee_number="EMP-000113")
    employee_factory(institution, employee_number="LEGACY-9")
    employee_factory(other, employee_number="EMP-000500")

    employee = Employee.objects.create(institution=institution, first_name="New", last_name="Hire", hire_date=date(2026, 1, 1))

    assert employee.employee_number == "EMP-000114"


def test_sequence_grows_past_its_padding(institution_factory):
    institution = institution_factory()
    Department.objects.create(institution=institution, name="Last padded", code="DPT-999")

    department = Department.objects.create(institution=institution, name="Next", code="")

    assert department.code == "DPT-1000"
    assert Department.objects.create(institution=institution, name="After", code="").code == "DPT-1001"


def test_explicit_code_is_kept(institution_factory):
    institution = institution_factory()

    department = Department.objects.create(institution=institution, name="Finance", code="fin")

    assert department.code == "FIN"


def test_job_posting_code_includes_the_year(institution_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    department, position = organization_factory(institution)
    _, location = assignment_dimensions_factory(institution)

    posting = JobPosting.objects.create(institution=institution, title="Analyst", department=department, position=position, location=location, employment_type="PERMANENT")

    assert posting.code == f"JOB-{timezone.localdate().year}-00001"


def test_documents_of_any_type_upload_and_download_as_attachments(api_client, institution_factory, user_factory, membership_factory):
    _admin(api_client, institution_factory, user_factory, membership_factory)
    files = [
        SimpleUploadedFile("budget.xlsx", b"PK\x03\x04sheet", content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        SimpleUploadedFile("notes.txt", b"plain text", content_type="text/plain"),
        SimpleUploadedFile("archive.zip", b"PK\x03\x04zip", content_type=""),
        SimpleUploadedFile("page.html", b"<script>alert(1)</script>", content_type="text/html"),
    ]
    content_types = {}
    for uploaded in files:
        response = api_client.post("/api/v1/documents/", {"uploaded_file": uploaded, "category": "GENERAL"}, format="multipart")
        assert response.status_code == 201, response.data
        assert response.data["original_filename"] == uploaded.name

        download = api_client.get(f"/api/v1/documents/{response.data['id']}/download/")
        assert download.status_code == 200
        assert download["Content-Disposition"].startswith("attachment;")
        assert download["X-Content-Type-Options"] == "nosniff"
        content_types[uploaded.name] = response.data["content_type"]

    # A browser that sends no type gets one guessed from the extension.
    assert content_types["archive.zip"] in ("application/zip", "application/x-zip-compressed")
