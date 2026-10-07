from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import InstitutionAccessRequest, InstitutionAdminInvitation
from apps.audit.models import AuditLog

pytestmark = pytest.mark.django_db

INVITATIONS_URL = reverse("v1:institution-admin-invitation")
INSTITUTIONS_URL = reverse("v1:platform-institution-list")
OVERVIEW_URL = reverse("v1:platform-overview")
AUDIT_URL = reverse("v1:platform-audit")


def _detail_url(institution):
    return reverse("v1:platform-institution-detail", args=(institution.id,))


def _status_url(institution, action):
    return reverse("v1:platform-institution-status", args=(institution.id, action))


def _invitation_url(invitation, action):
    return reverse("v1:institution-admin-invitation-action", args=(invitation.id, action))


@pytest.fixture
def platform_admin(user_factory):
    return user_factory(email="root@ergonx.example", is_platform_admin=True)


def test_platform_endpoints_refuse_tenant_users_and_anonymous(api_client, user_factory, institution_factory, membership_factory):
    institution = institution_factory()
    member = user_factory()
    membership_factory(user=member, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    urls = [OVERVIEW_URL, INSTITUTIONS_URL, _detail_url(institution), AUDIT_URL]

    assert all(api_client.get(url).status_code == 401 for url in urls)
    api_client.force_authenticate(member)
    assert all(api_client.get(url).status_code == 403 for url in urls)
    assert api_client.post(_status_url(institution, "suspend"), {"reason": "x"}, format="json").status_code == 403


def test_directory_lists_organizations_with_admin_and_counts(api_client, platform_admin, user_factory, institution_factory, membership_factory, employee_factory):
    volta = institution_factory(name="Volta Health", email="hr@volta.example")
    institution_factory(name="Ashanti Mills", is_active=False)
    admin = user_factory(email="ama@volta.example", first_name="Ama", last_name="Owusu")
    membership_factory(user=admin, institution=volta, role_code="INSTITUTION_ADMIN", is_primary=True)
    membership_factory(user=user_factory(), institution=volta)
    employee_factory(volta)
    api_client.force_authenticate(platform_admin)

    response = api_client.get(INSTITUTIONS_URL)

    assert response.status_code == 200, response.data
    assert response.data["count"] == 2
    row = next(item for item in response.data["results"] if item["name"] == "Volta Health")
    assert row["member_count"] == 2
    assert row["employee_count"] == 1
    assert row["primary_admin"] == {"email": "ama@volta.example", "name": "Ama Owusu"}

    assert [item["name"] for item in api_client.get(INSTITUTIONS_URL, {"status": "suspended"}).data["results"]] == ["Ashanti Mills"]
    assert [item["name"] for item in api_client.get(INSTITUTIONS_URL, {"q": "volta"}).data["results"]] == ["Volta Health"]


def test_detail_includes_modules_administrators_and_member_breakdown(api_client, platform_admin, user_factory, institution_factory, membership_factory):
    institution = institution_factory()
    admin = user_factory()
    membership_factory(user=admin, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    membership_factory(user=user_factory(), institution=institution, status="SUSPENDED")
    api_client.force_authenticate(platform_admin)

    data = api_client.get(_detail_url(institution)).data

    assert {module["code"] for module in data["modules"]} >= {"CORE_HR", "PAYROLL"}
    assert [item["email"] for item in data["administrators"]] == [admin.email]
    assert data["members_by_status"]["ACTIVE"] == 1
    assert data["members_by_status"]["SUSPENDED"] == 1


def test_suspending_blocks_members_until_reactivated_and_is_audited(api_client, platform_admin, user_factory, institution_factory, membership_factory):
    institution = institution_factory()
    member = user_factory()
    membership_factory(user=member, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    bootstrap = reverse("v1:auth-bootstrap")

    api_client.force_authenticate(platform_admin)
    assert api_client.post(_status_url(institution, "suspend"), {}, format="json").status_code == 400
    response = api_client.post(_status_url(institution, "suspend"), {"reason": "Unpaid subscription"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["is_active"] is False
    assert response.data["suspension_reason"] == "Unpaid subscription"
    assert api_client.post(_status_url(institution, "suspend"), {"reason": "again"}, format="json").status_code == 409

    api_client.force_authenticate(member)
    blocked = api_client.get(bootstrap)
    assert blocked.status_code == 403
    assert blocked.data["code"] == "institution_suspended"

    api_client.force_authenticate(platform_admin)
    assert api_client.post(_status_url(institution, "reactivate"), {}, format="json").status_code == 200
    api_client.force_authenticate(member)
    assert api_client.get(bootstrap).status_code == 200

    actions = list(AuditLog.objects.filter(institution=institution).order_by("created_at").values_list("action", flat=True))
    assert actions == ["platform.institution.suspended", "platform.institution.reactivated"]


def test_revoking_and_reissuing_invitations(api_client, platform_admin):
    api_client.force_authenticate(platform_admin)
    created = api_client.post(INVITATIONS_URL, {"email": "new@org.example", "expires_in_hours": 24}, format="json").data
    invitation = InstitutionAdminInvitation.objects.get(pk=created["id"])

    assert api_client.post(_invitation_url(invitation, "revoke"), {}, format="json").status_code == 200
    invitation.refresh_from_db()
    assert invitation.status == InstitutionAdminInvitation.Status.REVOKED
    assert api_client.post(_invitation_url(invitation, "revoke"), {}, format="json").status_code == 409

    reissued = api_client.post(_invitation_url(invitation, "reissue"), {"expires_in_hours": 72}, format="json")
    assert reissued.status_code == 200, reissued.data
    replacement = InstitutionAdminInvitation.objects.get(pk=reissued.data["invitation"]["id"])
    assert replacement.status == InstitutionAdminInvitation.Status.PENDING
    assert replacement.email == "new@org.example"
    assert reissued.data["invitation"]["acceptance_token"]

    # The old token no longer works; the new one does.
    old_token_check = api_client.get(reverse("v1:institution-admin-invitation-acceptance", args=(created["acceptance_token"],)))
    assert old_token_check.status_code == 404
    new_token_check = api_client.get(reverse("v1:institution-admin-invitation-acceptance", args=(reissued.data["invitation"]["acceptance_token"],)))
    assert new_token_check.status_code == 200

    actions = set(AuditLog.objects.values_list("action", flat=True))
    assert {"platform.invitation.created", "platform.invitation.revoked", "platform.invitation.reissued"} <= actions


def test_reissuing_a_pending_invitation_revokes_it_and_moves_the_access_request(api_client, platform_admin):
    api_client.force_authenticate(platform_admin)
    access_request = InstitutionAccessRequest.objects.create(institution_name="Volta", contact_name="Akosua", email="a@volta.example")
    api_client.post(reverse("v1:institution-access-request-decision", args=(access_request.id, "approve")), {}, format="json")
    original = InstitutionAdminInvitation.objects.get()

    response = api_client.post(_invitation_url(original, "reissue"), {}, format="json")

    assert response.status_code == 200, response.data
    original.refresh_from_db()
    access_request.refresh_from_db()
    assert original.status == InstitutionAdminInvitation.Status.REVOKED
    assert str(access_request.invitation_id) == response.data["invitation"]["id"]


def test_listing_marks_lapsed_invitations_expired(api_client, platform_admin):
    api_client.force_authenticate(platform_admin)
    created = api_client.post(INVITATIONS_URL, {"email": "late@org.example", "expires_in_hours": 1}, format="json").data
    InstitutionAdminInvitation.objects.filter(pk=created["id"]).update(expires_at=timezone.now() - timedelta(minutes=1))

    listed = api_client.get(INVITATIONS_URL).data

    assert listed[0]["status"] == "EXPIRED"


def test_accepting_an_invitation_links_the_new_organization(api_client, platform_admin):
    api_client.force_authenticate(platform_admin)
    token = api_client.post(INVITATIONS_URL, {"email": "founder@org.example", "expires_in_hours": 24}, format="json").data["acceptance_token"]
    api_client.force_authenticate(None)

    url = reverse("v1:institution-admin-invitation-acceptance", args=(token,))
    payload = {"first_name": "Kofi", "last_name": "Mensah", "password": "StrongPass123!x", "institution_name": "Kofi Farms", "institution_type": "SME", "country_code": "GH", "employee_size": "51-200", "website": "https://kofifarms.example", "phone": "+233200000099", "default_currency": "GHS", "timezone": "Africa/Accra"}
    preview = api_client.get(url)
    assert preview.status_code == 200 and preview.data["email"] == "founder@org.example"
    assert {"value": "SME", "label": "SME"} in preview.data["institution_types"]
    # The terms must be accepted explicitly.
    assert api_client.post(url, payload, format="json").status_code == 400
    assert api_client.post(url, {**payload, "accepted_terms": False}, format="json").status_code == 400

    accepted = api_client.post(url, {**payload, "accepted_terms": True}, format="json")

    assert accepted.status_code == 201, accepted.data
    invitation = InstitutionAdminInvitation.objects.get()
    assert invitation.institution.name == "Kofi Farms"
    assert (invitation.institution.institution_type, invitation.institution.employee_size, invitation.institution.website, invitation.institution.phone) == ("SME", "51-200", "https://kofifarms.example", "+233200000099")
    assert AuditLog.objects.filter(action="platform.institution.created", institution=invitation.institution).exists()

    api_client.force_authenticate(platform_admin)
    detail = api_client.get(_detail_url(invitation.institution)).data
    assert detail["origin_invitation"]["email"] == "founder@org.example"
    assert detail["primary_admin"]["email"] == "founder@org.example"


def test_overview_and_audit_feed(api_client, platform_admin, institution_factory):
    institution_factory()
    suspended = institution_factory(name="Dormant Co")
    InstitutionAccessRequest.objects.create(institution_name="Volta", contact_name="Akosua", email="a@volta.example")
    api_client.force_authenticate(platform_admin)
    api_client.post(_status_url(suspended, "suspend"), {"reason": "Closed"}, format="json")

    overview = api_client.get(OVERVIEW_URL)

    assert overview.status_code == 200, overview.data
    assert overview.data["institutions"] == {"total": 2, "active": 1, "suspended": 1, "new_last_30_days": 2}
    assert overview.data["pipeline"]["pending_requests"] == 1
    assert len(overview.data["growth"]["months"]) == 12
    assert overview.data["growth"]["institutions"][-1] == 2
    assert overview.data["growth"]["access_requests"][-1] == 1

    feed = api_client.get(AUDIT_URL).data
    assert feed["count"] == 1
    event = feed["results"][0]
    assert event["action"] == "platform.institution.suspended"
    assert event["actor_email"] == platform_admin.email
    assert event["institution"]["name"] == "Dormant Co"
    assert api_client.get(AUDIT_URL, {"action": "invitation"}).data["count"] == 0
