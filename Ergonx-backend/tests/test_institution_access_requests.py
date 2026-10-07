import pytest
from django.core import mail
from django.core.cache import cache
from django.urls import reverse

from apps.accounts.models import InstitutionAccessRequest, InstitutionAdminInvitation

pytestmark = pytest.mark.django_db

LIST_URL = reverse("v1:institution-access-request")


def _payload(**overrides):
    payload = {
        "institution_name": "  Volta Health Partners ",
        "contact_name": "Akosua Darko",
        "job_title": "HR Director",
        "email": "Akosua.Darko@VoltaHealth.example",
        "phone": "+233 24 000 0000",
        "country_code": "gh",
        "organization_size": "51-200",
        "message": "We run three clinics and want HR and payroll.",
    }
    payload.update(overrides)
    return payload


def _decision_url(access_request, decision):
    return reverse("v1:institution-access-request-decision", args=(access_request.id, decision))


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


def test_anyone_can_submit_a_request_without_an_account(api_client):
    response = api_client.post(LIST_URL, _payload(), format="json")

    assert response.status_code == 202, response.data
    stored = InstitutionAccessRequest.objects.get()
    assert stored.institution_name == "Volta Health Partners"
    assert stored.email == "akosua.darko@voltahealth.example"
    assert stored.country_code == "GH"
    assert stored.status == InstitutionAccessRequest.Status.PENDING


def test_duplicate_and_honeypot_submissions_are_accepted_but_not_stored(api_client):
    assert api_client.post(LIST_URL, _payload(), format="json").status_code == 202
    assert api_client.post(LIST_URL, _payload(), format="json").status_code == 202
    assert api_client.post(LIST_URL, _payload(email="bot@spam.example", website="http://spam.example"), format="json").status_code == 202

    assert InstitutionAccessRequest.objects.count() == 1


def test_required_fields_are_validated(api_client):
    response = api_client.post(LIST_URL, _payload(institution_name="  ", email="not-an-email", country_code="Ghana"), format="json")

    assert response.status_code == 400
    assert InstitutionAccessRequest.objects.count() == 0


def test_submissions_are_rate_limited(api_client, settings):
    settings.INSTITUTION_ACCESS_REQUEST_RATE = "2/hour"

    statuses = [api_client.post(LIST_URL, _payload(email=f"contact{n}@example.com"), format="json").status_code for n in range(3)]

    assert statuses == [202, 202, 429]


def test_platform_admins_are_emailed_about_new_requests(api_client, user_factory, settings):
    settings.EMAIL_DELIVERY_ENABLED = True
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    user_factory(email="platform@ergonx.example", is_platform_admin=True)
    user_factory(email="staff@tenant.example")

    api_client.post(LIST_URL, _payload(), format="json")

    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["platform@ergonx.example"]
    assert "Volta Health Partners" in mail.outbox[0].subject


def test_only_platform_admins_can_list_or_decide(api_client, user_factory):
    access_request = InstitutionAccessRequest.objects.create(institution_name="Volta", contact_name="Akosua", email="a@volta.example")
    api_client.force_authenticate(user_factory())

    assert api_client.get(LIST_URL).status_code == 403
    assert api_client.post(_decision_url(access_request, "approve"), {}, format="json").status_code == 403

    api_client.force_authenticate(None)
    assert api_client.get(LIST_URL).status_code == 401


def test_approving_issues_an_institution_admin_invitation(api_client, user_factory):
    admin = user_factory(is_platform_admin=True)
    access_request = InstitutionAccessRequest.objects.create(institution_name="Volta", contact_name="Akosua", email="a@volta.example")
    api_client.force_authenticate(admin)

    response = api_client.post(_decision_url(access_request, "approve"), {"expires_in_hours": 72}, format="json")

    assert response.status_code == 200, response.data
    invitation = InstitutionAdminInvitation.objects.get()
    assert invitation.email == "a@volta.example"
    assert invitation.invited_by == admin
    assert response.data["invitation"]["acceptance_token"]
    access_request.refresh_from_db()
    assert access_request.status == InstitutionAccessRequest.Status.INVITED
    assert access_request.invitation == invitation
    assert access_request.reviewed_by == admin

    again = api_client.post(_decision_url(access_request, "decline"), {}, format="json")
    assert again.status_code == 409


def test_declining_records_the_reason(api_client, user_factory):
    api_client.force_authenticate(user_factory(is_platform_admin=True))
    access_request = InstitutionAccessRequest.objects.create(institution_name="Volta", contact_name="Akosua", email="a@volta.example")

    response = api_client.post(_decision_url(access_request, "decline"), {"reason": "Not a registered organization."}, format="json")

    assert response.status_code == 200, response.data
    access_request.refresh_from_db()
    assert access_request.status == InstitutionAccessRequest.Status.DECLINED
    assert access_request.decline_reason == "Not a registered organization."
    assert InstitutionAdminInvitation.objects.count() == 0


def test_cannot_invite_an_email_that_already_has_an_account(api_client, user_factory):
    api_client.force_authenticate(user_factory(is_platform_admin=True))
    user_factory(email="taken@volta.example")
    access_request = InstitutionAccessRequest.objects.create(institution_name="Volta", contact_name="Akosua", email="taken@volta.example")

    listed = api_client.get(LIST_URL)
    response = api_client.post(_decision_url(access_request, "approve"), {}, format="json")

    assert listed.data[0]["has_account"] is True
    assert response.status_code == 409
    access_request.refresh_from_db()
    assert access_request.status == InstitutionAccessRequest.Status.PENDING


def test_request_details_and_terms_carry_into_the_invitation(api_client, user_factory):
    assert api_client.post(LIST_URL, _payload(accepted_terms=False), format="json").status_code == 400
    response = api_client.post(LIST_URL, _payload(institution_type="HEALTHCARE", website_url="https://voltahealth.example", accepted_terms=True), format="json")
    assert response.status_code == 202, response.data
    stored = InstitutionAccessRequest.objects.get()
    assert (stored.institution_type, stored.website_url) == ("HEALTHCARE", "https://voltahealth.example")
    assert stored.terms_accepted_at is not None

    api_client.force_authenticate(user_factory(is_platform_admin=True))
    token = api_client.post(_decision_url(stored, "approve"), {"expires_in_hours": 72}, format="json").data["invitation"]["acceptance_token"]
    api_client.force_authenticate(None)
    prefill = api_client.get(reverse("v1:institution-admin-invitation-acceptance", args=(token,))).data["prefill"]
    assert prefill["institution_type"] == "HEALTHCARE" and prefill["website"] == "https://voltahealth.example"
    assert (prefill["first_name"], prefill["last_name"]) == ("Akosua", "Darko")
