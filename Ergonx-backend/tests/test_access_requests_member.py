"""Member "Request access" from permission-restricted states."""
import pytest

from apps.audit.models import AuditLog
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


def test_access_request_notifies_user_managers_once_per_day(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="ACCESS-REQ")
    admin = user_factory(email="access.admin@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    employee = user_factory(email="access.employee@example.com", first_name="Esi", last_name="Boateng")
    membership_factory(user=employee, institution=institution, role_code="EMPLOYEE", is_primary=True)
    api_client.force_authenticate(employee)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    payload = {"area": "Payroll", "permission": "payroll.view", "path": "/hr/payroll", "note": "Covering for payroll officer"}

    response = api_client.post("/api/v1/access-requests/", payload, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["data"] == {"sent_to": 1, "already_requested": False}
    notification = Notification.objects.get(user=admin, notification_type="ACCESS_REQUESTED")
    assert notification.title == "Esi Boateng requested access" and "Payroll" in notification.message
    assert AuditLog.objects.filter(action="access.requested", actor=employee).exists()

    again = api_client.post("/api/v1/access-requests/", payload, format="json")
    assert again.status_code == 200 and again.json()["data"]["already_requested"] is True
    assert Notification.objects.filter(notification_type="ACCESS_REQUESTED").count() == 1

    assert api_client.post("/api/v1/access-requests/", {}, format="json").status_code == 400


def test_access_request_requires_membership(api_client, institution_factory, user_factory):
    institution = institution_factory(code="ACCESS-REQ-2")
    outsider = user_factory(email="outsider@example.com")
    api_client.force_authenticate(outsider)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
    assert api_client.post("/api/v1/access-requests/", {"area": "Payroll"}, format="json").status_code in (403, 404)
