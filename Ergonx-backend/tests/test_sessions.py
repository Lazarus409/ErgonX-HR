"""Active sessions: list, revoke one, revoke others; revoked sessions stop at once (Wave 2)."""

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import UserSession
from apps.audit.models import AuditLog

LOGIN = "/api/v1/auth/login/"
REFRESH = "/api/v1/auth/refresh/"
LOGOUT = "/api/v1/auth/logout/"
SESSIONS = "/api/v1/auth/sessions/"
ME = "/api/v1/auth/me/"
PASSWORD = "/api/v1/auth/profile/password/"


def sign_in(email, user_agent="Browser A"):
    client = APIClient(HTTP_USER_AGENT=user_agent)
    pair = client.post(LOGIN, {"email": email, "password": "StrongPass123!"}, format="json").json()["data"]
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {pair['access']}")
    return client, pair


@pytest.fixture
def user(user_factory):
    return user_factory(email="sessions@example.com")


def test_sign_in_creates_a_session_bound_to_both_tokens(user):
    client, pair = sign_in(user.email)
    session = UserSession.objects.get(user=user)
    assert RefreshToken(pair["refresh"])["sid"] == str(session.id)
    assert session.user_agent == "Browser A"
    rows = client.get(SESSIONS).json()["data"]["sessions"]
    assert [(row["id"], row["current"]) for row in rows] == [(str(session.id), True)]


def test_revoking_a_session_stops_its_access_and_refresh_tokens_immediately(user):
    first, first_pair = sign_in(user.email, "Browser A")
    second, _ = sign_in(user.email, "Browser B")
    target = UserSession.objects.get(user=user, user_agent="Browser A")
    response = second.post(f"{SESSIONS}{target.id}/revoke/")
    assert response.status_code == 200 and response.json()["data"]["current"] is False
    assert first.get(ME).status_code == 401
    assert APIClient().post(REFRESH, {"refresh": first_pair["refresh"]}, format="json").status_code == 401
    assert second.get(ME).status_code == 200
    assert AuditLog.objects.filter(action="account.session.revoked", actor=user).exists()


def test_revoke_others_keeps_the_current_session(user):
    first, _ = sign_in(user.email, "Browser A")
    second, _ = sign_in(user.email, "Browser B")
    third, _ = sign_in(user.email, "Browser C")
    assert third.post(f"{SESSIONS}revoke-others/").json()["data"]["revoked"] == 2
    assert first.get(ME).status_code == 401 and second.get(ME).status_code == 401
    assert third.get(ME).status_code == 200


def test_cannot_revoke_another_users_session(user, user_factory):
    other = user_factory(email="other@example.com")
    sign_in(other.email)
    client, _ = sign_in(user.email)
    foreign = UserSession.objects.get(user=other)
    assert client.post(f"{SESSIONS}{foreign.id}/revoke/").status_code == 404
    assert UserSession.objects.get(pk=foreign.pk).revoked_at is None


def test_logout_revokes_the_session(user):
    client, pair = sign_in(user.email)
    APIClient().post(LOGOUT, {"refresh": pair["refresh"]}, format="json")
    assert UserSession.objects.get(user=user).revoked_reason == "signed_out"
    assert client.get(ME).status_code == 401


def test_refresh_keeps_the_session_and_marks_it_seen(user):
    _, pair = sign_in(user.email)
    session = UserSession.objects.get(user=user)
    before = session.last_seen_at
    rotated = APIClient().post(REFRESH, {"refresh": pair["refresh"]}, format="json").json()["data"]
    assert RefreshToken(rotated["refresh"])["sid"] == str(session.id)
    session.refresh_from_db()
    assert session.last_seen_at >= before


def test_password_change_signs_out_other_sessions(user):
    first, _ = sign_in(user.email, "Browser A")
    second, _ = sign_in(user.email, "Browser B")
    response = second.post(PASSWORD, {"current_password": "StrongPass123!", "new_password": "AnotherStrong456!"}, format="json")
    assert response.status_code == 200
    assert first.get(ME).status_code == 401
    assert second.get(ME).status_code == 200


def test_tokens_issued_before_sessions_still_work_until_they_expire(user):
    legacy = RefreshToken.for_user(user)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {legacy.access_token}")
    assert client.get(ME).status_code == 200
