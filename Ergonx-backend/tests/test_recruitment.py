from datetime import date, timedelta

import json

import pytest
from django.core.exceptions import ValidationError

from apps.compensation.models import EmployeeCompensation, SalaryStructure
from apps.documents.models import Document
from apps.employees.models import Employee, Employment
from apps.institutions.models import InstitutionModule, UserActivityEvent
from apps.recruitment.models import Application, Candidate, JobPosting, Offer, RecruitmentStage
from apps.recruitment.services import (
    decide_offer,
    extend_offer,
    hire_candidate,
    move_application_stage,
    publish_job_posting,
    submit_application,
)



def approved(posting):
    """Test setup: mark a requisition approved by someone else, as BQ-06 requires before publishing."""
    from apps.recruitment.models import JobPosting

    JobPosting.objects.filter(pk=posting.pk).update(status=JobPosting.Status.APPROVED)
    posting.refresh_from_db()
    return posting

def recruitment_setup(institution, organization_factory, assignment_dimensions_factory, user):
    InstitutionModule.objects.filter(institution=institution, module_code="RECRUITMENT").update(is_enabled=True)
    department, position = organization_factory(institution)
    grade, location = assignment_dimensions_factory(institution)
    stage = RecruitmentStage.objects.create(institution=institution, name="Applied", sequence=1)
    posting = JobPosting.objects.create(institution=institution, code="REC-001", title="HR Analyst", department=department, position=position, location=location, hiring_manager=user if user.memberships.filter(institution=institution, status="ACTIVE").exists() else None, employment_type=Employment.EmploymentType.PERMANENT)
    candidate = Candidate.objects.create(institution=institution, first_name="Ada", last_name="Applicant", email="ada@example.com")
    application = Application.objects.create(institution=institution, job_posting=posting, candidate=candidate)
    return department, position, grade, location, stage, posting, candidate, application


@pytest.mark.django_db
def test_recruitment_state_transitions_and_idempotent_hire(institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory(code="REC-HOME")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    department, position, grade, location, stage, posting, candidate, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, user)
    publish_job_posting(job_posting=approved(posting), actor=user)
    submit_application(application=application, actor=user)
    stage_two = RecruitmentStage.objects.create(institution=institution, name="Interview", sequence=2)
    move_application_stage(application=application, stage=stage_two, actor=user, comment="Shortlisted")
    structure = SalaryStructure.objects.create(institution=institution, name="Standard", code="STANDARD")
    offer = Offer.objects.create(institution=institution, application=application, proposed_start_date=date.today() + timedelta(days=14), employment_type=Employment.EmploymentType.PERMANENT, department=department, position=position, grade=grade, location=location, salary_structure=structure, base_salary="5000.00", currency="GHS")
    extend_offer(offer=offer, actor=user)
    decide_offer(offer=offer, actor=user, accepted=True)
    first = hire_candidate(offer=offer, actor=user, employee_number="REC-001")
    second = hire_candidate(offer=offer, actor=user, employee_number="REC-001")
    assert first.id == second.id
    assert Employment.objects.filter(employee=first, is_current=True).count() == 1
    assert EmployeeCompensation.objects.filter(employee=first, is_current=True).count() == 1
    offer.refresh_from_db(); application.refresh_from_db(); candidate.refresh_from_db()
    assert offer.status == Offer.Status.HIRED
    assert application.status == Application.Status.HIRED
    assert candidate.status == Candidate.Status.HIRED
    assert UserActivityEvent.objects.filter(institution=institution, activity_code="application.submit", entity_id=application.id).exists()
    assert UserActivityEvent.objects.filter(institution=institution, activity_code="offer.manage", entity_id=offer.id).count() == 2


@pytest.mark.django_db
def test_hire_rolls_back_when_employee_number_conflicts(institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory, employee_factory):
    institution = institution_factory(code="REC-ROLLBACK")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    department, position, grade, location, _, posting, candidate, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, user)
    publish_job_posting(job_posting=approved(posting), actor=user); submit_application(application=application, actor=user)
    employee_factory(institution, employee_number="DUPLICATE")
    offer = Offer.objects.create(institution=institution, application=application, proposed_start_date=date.today(), employment_type=Employment.EmploymentType.PERMANENT, department=department, position=position, grade=grade, location=location)
    extend_offer(offer=offer, actor=user); decide_offer(offer=offer, actor=user, accepted=True)
    with pytest.raises(ValidationError):
        hire_candidate(offer=offer, actor=user, employee_number="DUPLICATE")
    offer.refresh_from_db(); application.refresh_from_db(); candidate.refresh_from_db()
    assert offer.hired_employee_id is None
    assert offer.status == Offer.Status.ACCEPTED
    assert application.status == Application.Status.OFFERED
    assert candidate.status == Candidate.Status.ACTIVE


@pytest.mark.django_db
def test_recruitment_api_enforces_module_permission_and_tenant_scope(api_client, institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    home = institution_factory(code="REC-API")
    other = institution_factory(code="REC-OTHER")
    user = user_factory()
    membership_factory(user=user, institution=home, role_code="HR_ADMIN", is_primary=True)
    _, _, _, _, _, _, other_candidate, _ = recruitment_setup(other, organization_factory, assignment_dimensions_factory, user_factory())
    api_client.force_authenticate(user=user)
    disabled = api_client.get("/api/v1/recruitment/candidates/")
    assert disabled.status_code == 403
    InstitutionModule.objects.filter(institution=home, module_code="RECRUITMENT").update(is_enabled=True)
    scoped = api_client.get("/api/v1/recruitment/candidates/")
    assert scoped.status_code == 200
    assert other_candidate.email not in str(scoped.data)
    cross_tenant = api_client.get(f"/api/v1/recruitment/candidates/{other_candidate.id}/")
    assert cross_tenant.status_code == 404
    home_candidate = Candidate.objects.create(institution=home, first_name="Home", last_name="Candidate", email="home@example.com")
    document = Document.objects.create(institution=home, uploaded_by=user, file_reference="private://candidates/home-cv.pdf", original_filename="home-cv.pdf", content_type="application/pdf", size_bytes=42, entity_type="recruitment.Candidate", entity_id=home_candidate.id)
    document_response = api_client.get(f"/api/v1/recruitment/candidates/{home_candidate.id}/documents/")
    assert document_response.status_code == 200
    assert str(document.id) in str(document_response.data)
    auditor = user_factory(email="auditor@example.com")
    membership_factory(user=auditor, institution=home, role_code="AUDITOR")
    api_client.force_authenticate(user=auditor)
    assert api_client.get("/api/v1/recruitment/candidates/").status_code == 403


@pytest.mark.django_db
def test_application_status_is_not_patchable_and_api_envelope(api_client, institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory(code="REC-PATCH")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    InstitutionModule.objects.filter(institution=institution, module_code="RECRUITMENT").update(is_enabled=True)
    *_, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, user)
    api_client.force_authenticate(user=user)
    response = api_client.patch(f"/api/v1/recruitment/applications/{application.id}/", {"status": "HIRED"}, format="json")
    assert response.status_code == 200
    application.refresh_from_db()
    assert application.status == Application.Status.DRAFT
    payload = json.loads(response.content)
    assert payload["success"] is True
    assert payload["data"]["status"] == Application.Status.DRAFT
