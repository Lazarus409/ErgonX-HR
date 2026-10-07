from datetime import timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.institutions.models import InstitutionMembership, InstitutionModule, Permission
from apps.notifications.models import Notification
from apps.reports.library import run_due_items
from apps.reports.models import AnalyticsItem

URL = "/api/v1/report-library/"


@pytest.fixture
def library(api_client, institution_factory, user_factory, membership_factory):
    institution = institution_factory(code="LIBRARY")
    InstitutionModule.objects.filter(institution=institution).update(is_enabled=True)

    def member(role_code):
        user = user_factory()
        membership_factory(user=user, institution=institution, role_code=role_code, is_primary=True)
        return user

    def as_user(user):
        api_client.force_authenticate(user)
        api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))
        return api_client

    return institution, member, as_user


@pytest.mark.django_db
def test_library_lists_only_what_the_role_can_open(library):
    institution, member, as_user = library
    hr = member("HR_ADMIN")
    response = as_user(hr).get(URL)
    assert response.status_code == 200
    sources = {(entry["kind"], entry["source"]) for entry in response.data["results"]}
    assert ("DASHBOARD", "hr") in sources
    assert ("REPORT", "leave") in sources
    # HR has no accounting permissions, so finance dashboards and journals stay hidden.
    assert ("DASHBOARD", "finance") not in sources
    assert ("REPORT", "accounting") not in sources
    assert response.data["counts"]["dashboards"]["institution"] >= 1
    assert AnalyticsItem.objects.filter(institution=institution, is_system=True).count() == 16

    employee = member("EMPLOYEE")
    assert as_user(employee).get(URL).status_code == 403


@pytest.mark.django_db
def test_saved_report_sharing_publication_and_refresh(library):
    institution, member, as_user = library
    owner = member("HR_ADMIN")
    colleague = member("DIRECTOR")
    client = as_user(owner)

    created = client.post(URL, {"name": "Leave this quarter", "kind": "REPORT", "source": "leave", "filters": {"status": "APPROVED"}, "schedule": "WEEKLY"}, format="json")
    assert created.status_code == 201, created.data
    item_id = created.data["id"]
    assert created.data["status"] == "DRAFT" and created.data["visibility"] == "PRIVATE"
    assert created.data["href"] == "/reports/dashboard?report=leave&status=APPROVED"

    # A private draft is invisible to others until shared.
    assert item_id not in {entry["id"] for entry in as_user(colleague).get(URL).data["results"]}
    client = as_user(owner)
    shared = client.post(f"{URL}{item_id}/share/", {"user_id": str(colleague.id)}, format="json")
    assert shared.status_code == 200, shared.data
    assert shared.data["visibility"] == "SHARED"
    assert Notification.objects.filter(user=colleague, notification_type="ANALYTICS_SHARED").exists()

    colleague_view = as_user(colleague).get(URL).data
    entry = next(entry for entry in colleague_view["results"] if entry["id"] == item_id)
    assert entry["shared_with_me"] and not entry["can_edit"]
    assert colleague_view["counts"]["reports"]["shared"] == 1
    assert as_user(colleague).patch(f"{URL}{item_id}/", {"name": "Hijacked"}, format="json").status_code == 403

    refreshed = as_user(owner).post(f"{URL}{item_id}/refresh/")
    assert refreshed.status_code == 200
    assert refreshed.data["freshness"]["state"] == "UP_TO_DATE"
    assert refreshed.data["last_row_count"] is not None

    published = as_user(owner).patch(f"{URL}{item_id}/", {"status": "PUBLISHED", "visibility": "INSTITUTION"}, format="json")
    assert published.status_code == 200, published.data
    actions = set(AuditLog.objects.filter(entity_id=item_id).values_list("action", flat=True))
    assert {"reports.analytics_item.created", "reports.analytics_item.shared", "reports.analytics_item.refreshed", "reports.analytics_item.updated"} <= actions
    activity = as_user(owner).get(f"{URL}{item_id}/activity/")
    assert activity.status_code == 200 and len(activity.data) >= 4


@pytest.mark.django_db
def test_publishing_to_everyone_needs_report_publish(library):
    institution, member, as_user = library
    # Read-only roles cannot save items at all.
    auditor = member("AUDITOR")
    assert as_user(auditor).post(URL, {"name": "Journals", "kind": "REPORT", "source": "accounting"}, format="json").status_code == 403

    author = member("HR_ADMIN")
    role = InstitutionMembership.objects.get(user=author, institution=institution).role
    role.permissions.remove(Permission.objects.get(code="report.publish"))
    client = as_user(author)
    created = client.post(URL, {"name": "Leave", "kind": "REPORT", "source": "leave"}, format="json")
    assert created.status_code == 201, created.data
    denied = client.patch(f"{URL}{created.data['id']}/", {"status": "PUBLISHED", "visibility": "INSTITUTION"}, format="json")
    assert denied.status_code == 403
    # Publishing for specific people stays open to the author.
    assert client.patch(f"{URL}{created.data['id']}/", {"status": "PUBLISHED"}, format="json").status_code == 200
    # A source the role cannot open cannot be saved either.
    assert client.post(URL, {"name": "Money", "kind": "DASHBOARD", "source": "finance"}, format="json").status_code == 403


@pytest.mark.django_db
def test_scheduled_items_refresh_and_notify(library):
    institution, member, as_user = library
    owner = member("HR_ADMIN")
    created = as_user(owner).post(URL, {"name": "Weekly leave", "kind": "REPORT", "source": "leave", "schedule": "WEEKLY"}, format="json")
    AnalyticsItem.objects.filter(pk=created.data["id"]).update(next_run_on=timezone.localdate() - timedelta(days=1))
    assert run_due_items() == 1
    item = AnalyticsItem.objects.get(pk=created.data["id"])
    assert item.last_refreshed_at is not None and item.next_run_on > timezone.localdate()
    assert Notification.objects.filter(user=owner, notification_type="ANALYTICS_REFRESHED").count() == 1
