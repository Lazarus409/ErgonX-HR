"""Record history and lineage endpoint (concept "Record history and lineage")."""
from datetime import date, timedelta

import pytest

from apps.compensation.models import SalaryStructure
from apps.employees.models import Employment
from apps.recruitment.models import Offer
from apps.recruitment.services import decide_offer, extend_offer, hire_candidate, publish_job_posting, submit_application
from tests.test_recruitment import approved, recruitment_setup

pytestmark = pytest.mark.django_db


def test_application_history_links_to_employee_and_back(api_client, institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory(code="HIST-WS")
    hr = user_factory(email="hist.hr@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)
    department, position, grade, location, stage, posting, candidate, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, hr)
    publish_job_posting(job_posting=approved(posting), actor=hr)
    submit_application(application=application, actor=hr)
    structure = SalaryStructure.objects.create(institution=institution, name="Standard", code="STD-HIST")
    offer = Offer.objects.create(institution=institution, application=application, proposed_start_date=date.today() + timedelta(days=14), employment_type=Employment.EmploymentType.PERMANENT,
                                 department=department, position=position, grade=grade, location=location, salary_structure=structure, base_salary="5000.00", currency="GHS")
    extend_offer(offer=offer, actor=hr)
    decide_offer(offer=offer, actor=hr, accepted=True)
    employee = hire_candidate(offer=offer, actor=hr, employee_number="HIST-001")

    api_client.force_authenticate(hr)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    data = api_client.get(f"/api/v1/record-history/application/{application.id}/").json()["data"]
    assert data["current_state"]["label"] == "Converted to employee"
    assert data["lineage"]["successors"][-1]["reference"] == "HIST-001"
    assert {stage["label"] for stage in data["stages"]} >= {"Application", "Offer"}
    assert data["read_only"] is True
    back = api_client.get(f"/api/v1/record-history/employee/{employee.id}/").json()["data"]
    assert back["lineage"]["predecessors"][0]["label"] == "Recruitment application"
    assert api_client.get(f"/api/v1/record-history/unknown/{employee.id}/").status_code == 400
