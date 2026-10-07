"""Wave 4: requisitions publish only after approval (BQ-06); evaluation needs its own grant (PERM-06)."""

import pytest
from django.core.exceptions import ValidationError

from apps.institutions.models import InstitutionModule
from apps.institutions.services import create_custom_role
from apps.recruitment.services import publish_job_posting, submit_application
from tests.test_recruitment import approved, recruitment_setup

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(institution_factory, user_factory, membership_factory, organization_factory, assignment_dimensions_factory):
    institution = institution_factory()
    InstitutionModule.objects.filter(institution=institution, module_code="RECRUITMENT").update(is_enabled=True)
    admin = user_factory(email="w4.admin@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    *_, posting, candidate, application = recruitment_setup(institution, organization_factory, assignment_dimensions_factory, admin)
    return {"institution": institution, "admin": admin, "posting": posting, "candidate": candidate, "application": application}


def test_even_an_approver_cannot_publish_a_draft(setup):
    with pytest.raises(ValidationError, match="Submit the requisition for approval"):
        publish_job_posting(job_posting=setup["posting"], actor=setup["admin"])


def test_scorecards_need_view_to_read_and_evaluation_grant_to_record(api_client, setup, user_factory, membership_factory):
    institution, admin = setup["institution"], setup["admin"]
    publish_job_posting(job_posting=approved(setup["posting"]), actor=admin)
    submit_application(application=setup["application"], actor=admin)
    create_custom_role(institution=institution, actor=admin, code="CANDIDATE_VIEWER", name="Candidate viewer", permission_codes=["candidate.view", "home.view"])
    viewer = user_factory(email="w4.viewer@example.com")
    membership_factory(user=viewer, institution=institution, role_code="CANDIDATE_VIEWER", is_primary=True)
    employee = user_factory(email="w4.employee@example.com")
    membership_factory(user=employee, institution=institution, role_code="EMPLOYEE", is_primary=True)

    def client_for(user):
        api_client.force_authenticate(user)
        api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
        return api_client

    candidate_card = f"/api/v1/recruitment/candidates/{setup['candidate'].id}/scorecard/"
    application_card = f"/api/v1/recruitment/applications/{setup['application'].id}/scorecard/"
    assert client_for(employee).get(candidate_card).status_code == 403
    assert client_for(viewer).get(candidate_card).status_code == 200
    assert client_for(viewer).get(application_card).status_code == 200
    assert client_for(viewer).post(application_card, {"ratings": [], "submit": False}, format="json").status_code == 403
