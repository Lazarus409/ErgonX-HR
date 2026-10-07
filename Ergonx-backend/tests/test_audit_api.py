import pytest
from rest_framework import status

from apps.audit.services import record_audit_event


pytestmark = pytest.mark.django_db


def _authenticate(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))


def test_audit_log_is_tenant_scoped_and_redacts_sensitive_metadata(
    api_client, institution_factory, user_factory, membership_factory,
):
    institution = institution_factory(code="AUDIT")
    foreign = institution_factory(code="AUDIT-FOREIGN")
    auditor = user_factory(email="auditor@example.com")
    membership_factory(user=auditor, institution=institution, role_code="AUDITOR", is_primary=True)
    record = record_audit_event(actor=auditor, institution=institution, entity=institution, action="access.test", metadata={"token": "must-not-leak", "safe": "visible"})
    record_audit_event(actor=auditor, institution=foreign, action="foreign.event")
    _authenticate(api_client, auditor, institution)

    response = api_client.get("/api/v1/audit/?action=access")
    assert response.status_code == 200
    assert response.data["count"] == 1
    assert response.data["results"][0]["metadata"] == {"token": "[redacted]", "safe": "visible"}

    by_reference = api_client.get(f"/api/v1/audit/?entity_id={record.entity_id}")
    assert by_reference.status_code == status.HTTP_200_OK
    assert by_reference.data["count"] == 1
    invalid_reference = api_client.get("/api/v1/audit/?entity_id=not-a-uuid")
    assert invalid_reference.status_code == status.HTTP_400_BAD_REQUEST


def test_non_audit_role_cannot_read_audit_history(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="NO-AUDIT")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="EMPLOYEE", is_primary=True)
    _authenticate(api_client, user, institution)
    assert api_client.get("/api/v1/audit/").status_code == 403
