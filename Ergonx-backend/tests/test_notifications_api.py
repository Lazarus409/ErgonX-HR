import pytest

from apps.notifications.models import Notification
from apps.notifications.serializers import NotificationSerializer


@pytest.mark.django_db
def test_notifications_are_recipient_and_tenant_scoped_and_can_be_read(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="NOTIFY-ONE")
    foreign_institution = institution_factory(code="NOTIFY-TWO")
    user = user_factory()
    other_user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    membership_factory(user=other_user, institution=institution, role_code="HR_ADMIN")
    membership_factory(user=user, institution=foreign_institution, role_code="HR_ADMIN")
    own = Notification.objects.create(
        institution=institution, user=user, notification_type="TEST", title="Own",
        message="Visible", channel=Notification.Channel.IN_APP,
    )
    Notification.objects.create(
        institution=institution, user=other_user, notification_type="TEST", title="Other",
        message="Hidden", channel=Notification.Channel.IN_APP,
    )
    Notification.objects.create(
        institution=foreign_institution, user=user, notification_type="TEST", title="Foreign",
        message="Hidden", channel=Notification.Channel.IN_APP,
    )
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))

    listed = api_client.get("/api/v1/notifications/")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.data["results"]] == [str(own.id)]
    assert listed.data["results"][0]["is_read"] is False

    marked = api_client.post(f"/api/v1/notifications/{own.id}/mark-read/")
    assert marked.status_code == 200
    assert marked.data["is_read"] is True
    own.refresh_from_db()
    assert own.status == Notification.Status.READ
    assert own.read_at is not None


@pytest.mark.django_db
def test_mark_all_notifications_read_does_not_cross_tenant_or_recipient(
    api_client, institution_factory, user_factory, membership_factory
):
    institution = institution_factory(code="NOTIFY-ALL")
    user = user_factory()
    other_user = user_factory()
    membership_factory(user=user, institution=institution, role_code="HR_ADMIN", is_primary=True)
    membership_factory(user=other_user, institution=institution, role_code="HR_ADMIN")
    own = Notification.objects.create(institution=institution, user=user, notification_type="TEST", title="Own", message="Visible", channel=Notification.Channel.IN_APP)
    other = Notification.objects.create(institution=institution, user=other_user, notification_type="TEST", title="Other", message="Hidden", channel=Notification.Channel.IN_APP)
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))

    response = api_client.post("/api/v1/notifications/mark-all-read/")
    assert response.status_code == 200
    assert response.data["updated"] == 1
    own.refresh_from_db(); other.refresh_from_db()
    assert own.status == Notification.Status.READ
    assert other.status == Notification.Status.PENDING


def test_notification_route_hints_are_limited_to_controlled_destinations():
    allowed = Notification(notification_type="TEST", title="Allowed", message="", metadata={"route_hint": "/leave/requests/abc"})
    rejected = Notification(notification_type="TEST", title="Rejected", message="", metadata={"route_hint": "https://example.com"})

    assert NotificationSerializer(allowed).data["route_hint"] == "/leave/requests/abc"
    assert NotificationSerializer(rejected).data["route_hint"] is None
