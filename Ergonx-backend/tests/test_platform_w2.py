"""Wave 2 platform rules: no hard deletes, one search path, governed settings, Notification Center."""

from uuid import uuid4

import pytest
from django.core import mail

from apps.audit.models import AuditLog
from apps.institutions.models import InstitutionModule, InstitutionSetting
from apps.institutions.services import institution_setting
from apps.notifications.models import Notification
from apps.notifications.serializers import NotificationSerializer
from apps.notifications.services import notification_module
from apps.recruitment.models import Candidate

pytestmark = pytest.mark.django_db

SETTINGS = "/api/v1/institutions/settings/"
NOTIFICATIONS = "/api/v1/notifications/"


@pytest.fixture
def org(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory()
    InstitutionModule.objects.filter(institution=institution).update(is_enabled=True)
    admin = user_factory(email="ia@example.com")
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    hr = user_factory(email="hr@example.com")
    membership_factory(user=hr, institution=institution, role_code="HR_ADMIN", is_primary=True)

    def as_user(user):
        api_client.force_authenticate(user)
        api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
        return api_client

    return {"institution": institution, "admin": admin, "hr": hr, "as": as_user}


# ---- W0-API-02 / W0-API-03 ------------------------------------------------------


def test_records_have_no_hard_delete_route(org):
    client = org["as"](org["admin"])
    candidate = Candidate.objects.create(institution=org["institution"], first_name="Ama", last_name="Owusu", email="ama@example.com")
    for path in (
        f"/api/v1/recruitment/candidates/{candidate.id}/",
        f"/api/v1/recruitment/job-postings/{uuid4()}/",
        f"/api/v1/recruitment/interviews/{uuid4()}/",
        f"/api/v1/recruitment/offers/{uuid4()}/",
        f"/api/v1/approval-requests/{uuid4()}/",
        f"/api/v1/import-jobs/{uuid4()}/",
        f"/api/v1/export-jobs/{uuid4()}/",
    ):
        response = client.delete(path)
        assert response.status_code in (403, 405), (path, response.status_code)
    assert Candidate.objects.filter(pk=candidate.pk).exists()


def test_search_is_mounted_once(org):
    client = org["as"](org["admin"])
    assert client.get("/api/v1/search/", {"q": "anything"}).status_code == 200
    assert client.get("/api/v1/institutions/search/", {"q": "anything"}).status_code == 404


# ---- W0-PERM-05: governed institution settings ------------------------------------


def test_security_settings_need_the_security_permission_and_a_valid_shape(org):
    body = {"key": "security.separation_of_duties", "value": {"payroll": True, "journals": False}}
    assert org["as"](org["hr"]).put(SETTINGS, body, format="json").status_code == 403

    client = org["as"](org["admin"])
    assert client.put(SETTINGS, {**body, "value": {"payroll": "yes"}}, format="json").status_code == 400
    assert client.put(SETTINGS, {"key": "security.unknown", "value": True}, format="json").status_code == 400
    assert client.put(SETTINGS, body, format="json").status_code == 200

    assert institution_setting(org["institution"], "security.separation_of_duties") == {"payroll": True, "journals": False}
    event = AuditLog.objects.get(action="institution.setting.updated")
    assert event.metadata["changes"]["value"] == [None, {"payroll": True, "journals": False}]


def test_separation_of_duties_defaults_on(org):
    assert institution_setting(org["institution"], "security.separation_of_duties") == {"payroll": True, "journals": True}


def test_notification_settings_need_the_notifications_permission(org):
    body = {"key": "notifications.email_enabled", "value": False}
    assert org["as"](org["hr"]).put(SETTINGS, body, format="json").status_code == 403
    assert org["as"](org["admin"]).put(SETTINGS, body, format="json").status_code == 200


# ---- Notification Center (S056) -------------------------------------------------------


def _notify(org, user, notification_type="LEAVE_APPROVAL_REQUIRED", **metadata):
    return Notification.objects.create(
        institution=org["institution"], user=user, notification_type=notification_type,
        title="Leave approval required", message="A leave request awaits you.",
        channel=Notification.Channel.IN_APP, metadata=metadata,
    )


def test_bulk_actions_touch_only_the_callers_notifications(org):
    mine = _notify(org, org["admin"])
    theirs = _notify(org, org["hr"])
    client = org["as"](org["admin"])

    response = client.post(f"{NOTIFICATIONS}bulk/", {"ids": [str(mine.id), str(theirs.id)], "action": "archive"}, format="json")
    assert response.json()["data"]["updated"] == 1
    theirs.refresh_from_db()
    assert theirs.archived_at is None

    assert client.get(NOTIFICATIONS).json()["data"]["results"] == []
    archived = client.get(NOTIFICATIONS, {"archived": "true"}).json()["data"]["results"]
    assert [item["id"] for item in archived] == [str(mine.id)]
    assert archived[0]["is_archived"] is True

    client.post(f"{NOTIFICATIONS}bulk/", {"ids": [str(mine.id)], "action": "unarchive"}, format="json")
    client.post(f"{NOTIFICATIONS}bulk/", {"ids": [str(mine.id)], "action": "mark_read"}, format="json")
    mine.refresh_from_db()
    assert mine.archived_at is None and mine.status == Notification.Status.READ


def test_module_filter_and_derived_categories(org):
    _notify(org, org["admin"])
    _notify(org, org["admin"], notification_type="APPROVAL_STEP_ASSIGNED", approval_request_id=str(uuid4()))
    client = org["as"](org["admin"])

    listed = client.get(NOTIFICATIONS, {"module": "APPROVALS"}).json()["data"]["results"]
    assert [item["module"] for item in listed] == ["APPROVALS"]
    assert listed[0]["route_hint"] == "/approvals"
    assert notification_module("PAYSLIP_AVAILABLE") == "PAYROLL"
    assert notification_module("SOMETHING_NEW", {"employee_id": str(uuid4())}) == "HR"
    assert notification_module("SOMETHING_NEW") == "SYSTEM"


def test_untrusted_route_hints_are_dropped():
    assert NotificationSerializer.route_for("X", {"route_hint": "https://evil.example/approvals"}) is None
    assert NotificationSerializer.route_for("X", {"route_hint": "/approvals"}) == "/approvals"


@pytest.fixture
def email_on(settings):
    settings.EMAIL_DELIVERY_ENABLED = True
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    return settings


def test_email_copy_follows_the_members_preference(org, email_on, django_capture_on_commit_callbacks):
    client = org["as"](org["admin"])
    preferences = client.get(f"{NOTIFICATIONS}preferences/").json()["data"]
    assert preferences == {"email_modules": [], "email_available": True}

    with django_capture_on_commit_callbacks(execute=True):
        _notify(org, org["admin"])
    assert mail.outbox == []

    assert client.put(f"{NOTIFICATIONS}preferences/", {"email_modules": ["LEAVE"]}, format="json").status_code == 200
    with django_capture_on_commit_callbacks(execute=True):
        sent = _notify(org, org["admin"], leave_request_id=str(uuid4()))
        _notify(org, org["admin"], notification_type="PAYSLIP_AVAILABLE")
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == [org["admin"].email]
    assert "/leave/requests/" in mail.outbox[0].body
    sent.refresh_from_db()
    assert sent.metadata["email_status"] == "SENT"


def test_institution_can_turn_notification_email_off(org, email_on, django_capture_on_commit_callbacks):
    client = org["as"](org["admin"])
    client.put(f"{NOTIFICATIONS}preferences/", {"email_modules": ["LEAVE"]}, format="json")
    InstitutionSetting.objects.create(institution=org["institution"], key="notifications.email_enabled", value=False)

    with django_capture_on_commit_callbacks(execute=True):
        _notify(org, org["admin"])
    assert mail.outbox == []
    assert client.get(f"{NOTIFICATIONS}preferences/").json()["data"]["email_available"] is False


def test_preferences_reject_unknown_modules(org):
    response = org["as"](org["admin"]).put(f"{NOTIFICATIONS}preferences/", {"email_modules": ["PROCUREMENT"]}, format="json")
    assert response.status_code == 400


# ---- Audit trail (S011) ----------------------------------------------------------------


def test_audit_summary_and_result_filter(org):
    from apps.audit.services import record_audit_event

    institution, admin = org["institution"], org["admin"]
    record_audit_event(actor=admin, institution=institution, action="account.login.failed")
    record_audit_event(actor=admin, institution=institution, action="account.login.succeeded")
    record_audit_event(actor=admin, institution=institution, action="leave.request.rejected")
    client = org["as"](admin)

    summary = client.get("/api/v1/audit/summary/").json()["data"]
    assert summary["failed"] == 1
    assert summary["successful"] == summary["total"] - 1
    assert summary["security"] >= 2

    failed = client.get("/api/v1/audit/", {"result": "failed"}).json()["data"]["results"]
    assert [row["action"] for row in failed] == ["account.login.failed"]
    security = client.get("/api/v1/audit/", {"category": "security"}).json()["data"]["results"]
    assert "leave.request.rejected" not in {row["action"] for row in security}


def test_audit_summary_needs_audit_permission(org):
    assert org["as"](org["hr"]).get("/api/v1/audit/summary/").status_code == 403
