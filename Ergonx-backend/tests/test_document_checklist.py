"""Employee document checklist (ErgonX HR): requirements, status, waivers, access."""

from datetime import date, timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.documents.checklist import EXPIRED, EXPIRING, MISSING, ON_FILE, WAIVED, add_months, checklists
from apps.documents.models import EMPLOYEE_ENTITY_TYPE, Document, DocumentRequirement
from apps.employees.models import Employment

pytestmark = pytest.mark.django_db

REQUIREMENTS = "/api/v1/document-requirements/"
WAIVERS = "/api/v1/document-requirement-waivers/"


@pytest.fixture
def setup(api_client, institution_factory, user_factory, membership_factory, employee_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    hr = user_factory(email="hr.docs@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN")
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)

    def employee(employment_type="PERMANENT", **kwargs):
        person = employee_factory(institution, **kwargs)
        Employment.objects.create(institution=institution, employee=person, department=department, position=position, grade=grade, location=location, employment_type=employment_type, staff_category="SENIOR", start_date=date(2026, 1, 1), status="ACTIVE", is_current=True)
        return person

    api_client.force_authenticate(hr)
    return api_client, institution, hr, employee


def document(institution, employee, category, created_at=None):
    item = Document.objects.create(institution=institution, original_filename=f"{category}.pdf", content_type="application/pdf", size_bytes=10, category=category, entity_type=EMPLOYEE_ENTITY_TYPE, entity_id=employee.id)
    if created_at:
        Document.objects.filter(pk=item.pk).update(created_at=created_at)
    return item


def test_add_months_clamps_to_month_end():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 11, 15), 3) == date(2027, 2, 15)


def test_hr_creates_requirement_and_it_is_audited(setup):
    client, institution, _, _ = setup
    response = client.post(REQUIREMENTS, {"name": "Ghana Card", "document_category": "Identification", "employment_types": []}, format="json")
    assert response.status_code == 201, response.data
    assert AuditLog.objects.filter(institution=institution, action="document_requirement.created").exists()
    bad = client.post(REQUIREMENTS, {"name": "Bad", "document_category": "X", "employment_types": ["ASTRONAUT"]}, format="json")
    assert bad.status_code == 400


def test_checklist_statuses(setup):
    _, institution, hr, employee = setup
    person = employee()
    card = DocumentRequirement.objects.create(institution=institution, name="Ghana Card", document_category="Identification")
    medical = DocumentRequirement.objects.create(institution=institution, name="Medical fitness", document_category="Medical", validity_months=12)
    contract = DocumentRequirement.objects.create(institution=institution, name="Contract", document_category="Contract")
    certificate = DocumentRequirement.objects.create(institution=institution, name="Certificate", document_category="Qualification")
    document(institution, person, "identification")  # category matching ignores case
    document(institution, person, "Medical", created_at=timezone.now() - timedelta(days=400))
    certificate.waivers.create(institution=institution, employee=person, reason="Joined before certificates were required.", waived_by=hr)
    items = {item["requirement"]: item for item in checklists(institution, [person])[person.id]}
    assert items["Ghana Card"]["status"] == ON_FILE
    assert items["Medical fitness"]["status"] == EXPIRED
    assert items["Contract"]["status"] == MISSING
    assert items["Certificate"]["status"] == WAIVED
    document(institution, person, "Medical", created_at=timezone.now() - timedelta(days=350))
    assert {item["requirement"]: item for item in checklists(institution, [person])[person.id]}["Medical fitness"]["status"] == EXPIRING
    assert contract.id and card.id and medical.id


def test_requirement_limited_to_employment_types(setup):
    _, institution, _, employee = setup
    intern = employee(employment_type="INTERN")
    DocumentRequirement.objects.create(institution=institution, name="Pension form", document_category="Pension", employment_types=["PERMANENT"])
    assert checklists(institution, [intern])[intern.id] == []


def test_compliance_overview_and_employee_checklist_endpoints(setup):
    client, institution, _, employee = setup
    complete, incomplete = employee(), employee()
    DocumentRequirement.objects.create(institution=institution, name="Ghana Card", document_category="Identification")
    document(institution, complete, "Identification")
    overview = client.get(f"{REQUIREMENTS}compliance/").data
    assert overview["employees"] == 2 and overview["complete_employees"] == 1 and overview["compliance_rate"] == 50.0
    row = next(item for item in overview["employees_detail"] if item["employee_id"] == str(incomplete.id))
    assert row["outstanding"] == ["Ghana Card"]
    checklist = client.get(f"/api/v1/employees/{incomplete.id}/document-checklist/").data
    assert checklist["summary"]["missing"] == 1 and checklist["items"][0]["status"] == MISSING


def test_waiver_needs_reason_and_is_audited(setup):
    client, institution, _, employee = setup
    person = employee()
    requirement = DocumentRequirement.objects.create(institution=institution, name="Ghana Card", document_category="Identification")
    assert client.post(WAIVERS, {"requirement": str(requirement.id), "employee": str(person.id), "reason": " "}, format="json").status_code == 400
    response = client.post(WAIVERS, {"requirement": str(requirement.id), "employee": str(person.id), "reason": "Foreign national; passport on file instead."}, format="json")
    assert response.status_code == 201, response.data
    assert AuditLog.objects.filter(action="document_requirement.waived").exists()
    assert client.delete(f"{WAIVERS}{response.data['id']}/").status_code == 204
    assert AuditLog.objects.filter(action="document_requirement.waiver_removed").exists()


def test_employee_sees_only_own_checklist(setup, user_factory, membership_factory):
    client, institution, _, employee = setup
    staff = user_factory(email="staff.docs@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    own, other = employee(user=staff), employee()
    DocumentRequirement.objects.create(institution=institution, name="Ghana Card", document_category="Identification")
    client.force_authenticate(staff)
    mine = client.get("/api/v1/employees/me/document-checklist/")
    assert mine.status_code == 200 and mine.data["employee_id"] == str(own.id)
    assert client.get(f"/api/v1/employees/{other.id}/document-checklist/").status_code == 403
    assert client.post(REQUIREMENTS, {"name": "X", "document_category": "X"}, format="json").status_code == 403


def test_self_service_upload_accepts_requirement_category(setup, user_factory, membership_factory):
    from django.core.files.uploadedfile import SimpleUploadedFile

    client, institution, _, employee = setup
    staff = user_factory(email="staff.upload@example.com")
    membership_factory(user=staff, institution=institution, role_code="EMPLOYEE")
    employee(user=staff)
    DocumentRequirement.objects.create(institution=institution, name="SSNIT card", document_category="SSNIT")
    client.force_authenticate(staff)
    upload = SimpleUploadedFile("ssnit.pdf", b"%PDF-1.4 test", content_type="application/pdf")
    response = client.post("/api/v1/employees/me/documents/", {"category": "SSNIT", "uploaded_file": upload}, format="multipart")
    assert response.status_code == 201, response.data
    statuses = [item["status"] for item in client.get("/api/v1/employees/me/document-checklist/").data["items"]]
    assert statuses == [ON_FILE]
