import pytest

from apps.institutions.models import InstitutionInvitation


pytestmark = pytest.mark.django_db


def _authenticate(api_client, user, institution):
    api_client.force_authenticate(user)
    api_client.credentials(HTTP_X_INSTITUTION_ID=str(institution.id))


def test_access_admin_can_create_reissue_and_revoke_tenant_invitation(
    api_client, institution_factory, user_factory, membership_factory,
):
    institution = institution_factory(code="INVITATIONS")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    _authenticate(api_client, user, institution)
    role = institution.roles.get(code="HR_ADMIN")

    created = api_client.post(
        "/api/v1/institutions/invitations/",
        {"email": "ama@example.com", "role_id": str(role.id)},
        format="json",
    )
    assert created.status_code == 201
    assert created.data["invitation"]["status"] == "PENDING"
    assert created.data["acceptance_token"]
    invitation_id = created.data["invitation"]["id"]

    listed = api_client.get("/api/v1/institutions/invitations/")
    assert listed.status_code == 200
    assert listed.data["count"] == 1
    assert "acceptance_token" not in listed.data["results"][0]

    reissued = api_client.post(f"/api/v1/institutions/invitations/{invitation_id}/resend/", format="json")
    assert reissued.status_code == 200
    assert reissued.data["invitation"]["id"] != invitation_id
    assert InstitutionInvitation.objects.get(pk=invitation_id).status == InstitutionInvitation.Status.REVOKED

    revoked = api_client.post(f"/api/v1/institutions/invitations/{reissued.data['invitation']['id']}/revoke/", format="json")
    assert revoked.status_code == 200
    assert revoked.data["status"] == "REVOKED"


def test_locale_catalogue_and_profile_validation_preserve_legacy_value(
    api_client, institution_factory, user_factory, membership_factory,
):
    institution = institution_factory(code="CATALOGUE", country_code="XX")
    user = user_factory()
    membership_factory(user=user, institution=institution, role_code="INSTITUTION_ADMIN", is_primary=True)
    _authenticate(api_client, user, institution)

    catalogue = api_client.get("/api/v1/institutions/locale-catalogues/")
    assert catalogue.status_code == 200
    assert {"countries", "currencies", "timezones"} == set(catalogue.data)
    assert any(item["code"] == "GH" for item in catalogue.data["countries"])

    unchanged = api_client.patch("/api/v1/institutions/current/", {"country_code": "XX"}, format="json")
    assert unchanged.status_code == 200
    invalid = api_client.patch("/api/v1/institutions/current/", {"country_code": "INVALID"}, format="json")
    assert invalid.status_code == 400
