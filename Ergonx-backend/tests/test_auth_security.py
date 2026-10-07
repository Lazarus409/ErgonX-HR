"""Sign-in abuse controls, email OTP limits, token revocation and the append-only audit trail.

Wave 0 security patch (decisions BQ-10, SEC-01, SEC-02, AUD-01; 2026-10-05).
"""

import re
from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.accounts.models import AuthAttempt, EmailOTPChallenge, UserMFA
from apps.accounts.security import LOGIN_FAILURE_LIMIT, LOGIN_IP_LIMIT, mask_email
from apps.accounts.serializers import EMAIL_OTP_ISSUE_LIMIT, _totp
from apps.audit.models import AuditLog, AuditLogImmutable

LOGIN = "/api/v1/auth/login/"
REFRESH = "/api/v1/auth/refresh/"
LOGOUT = "/api/v1/auth/logout/"
PASSWORD = "/api/v1/auth/profile/password/"
MFA = "/api/v1/auth/security/mfa/"
PASSWORD_VALUE = "StrongPass123!"
PROXY_SECRET = "test-bff-secret"


def login(client, email, password=PASSWORD_VALUE, **extra):
    return client.post(LOGIN, {"email": email, "password": password, **extra}, format="json")


def tokens(response):
    return response.json()["data"]


@pytest.fixture
def email_delivery(settings):
    settings.EMAIL_DELIVERY_ENABLED = True
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    return settings


@pytest.fixture
def email_otp_user(user_factory, email_delivery):
    user = user_factory(email="otp.user@example.com")
    UserMFA.objects.create(user=user, secret="JBSWY3DPEHPK3PXP", method=UserMFA.Method.EMAIL_OTP, is_enabled=True)
    return user


def sent_code():
    return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)


def age_attempts(**delta):
    AuthAttempt.objects.update(created_at=timezone.now() - timedelta(**delta))


# ---- Account lockout -------------------------------------------------------


def test_five_wrong_passwords_lock_the_account_even_for_the_right_password(api_client, user_factory):
    user = user_factory(email="lock.me@example.com")
    for _ in range(LOGIN_FAILURE_LIMIT):
        assert login(api_client, user.email, "wrong-password").status_code == 401
    response = login(api_client, user.email)
    assert response.status_code == 429
    assert response.data["code"] == "login_locked"
    assert "Retry-After" in response


def test_lock_lifts_once_the_failures_are_fifteen_minutes_old(api_client, user_factory):
    user = user_factory(email="lift@example.com")
    for _ in range(LOGIN_FAILURE_LIMIT):
        login(api_client, user.email, "wrong-password")
    age_attempts(minutes=16)
    assert login(api_client, user.email).status_code == 200


def test_success_resets_the_failure_count(api_client, user_factory):
    user = user_factory(email="reset@example.com")
    for _ in range(LOGIN_FAILURE_LIMIT - 1):
        login(api_client, user.email, "wrong-password")
    assert login(api_client, user.email).status_code == 200
    for _ in range(LOGIN_FAILURE_LIMIT - 1):
        login(api_client, user.email, "wrong-password")
    assert login(api_client, user.email).status_code == 200


def test_unknown_emails_lock_the_same_way_so_accounts_cannot_be_enumerated(api_client, db):
    for _ in range(LOGIN_FAILURE_LIMIT):
        assert login(api_client, "nobody@example.com", "x").status_code == 401
    assert login(api_client, "nobody@example.com", "x").data["code"] == "login_locked"
    event = AuditLog.objects.filter(action="account.login.failed").first()
    assert event.actor is None and "email_key" in event.metadata
    assert "nobody@example.com" not in str(event.metadata)


def test_wrong_authenticator_codes_count_towards_the_lock(api_client, user_factory):
    user = user_factory(email="totp@example.com")
    UserMFA.objects.create(user=user, secret="JBSWY3DPEHPK3PXP", is_enabled=True)
    challenge = login(api_client, user.email)
    assert challenge.data["code"] == "mfa_required"
    assert AuthAttempt.objects.get().outcome == AuthAttempt.Outcome.CHALLENGED
    for _ in range(LOGIN_FAILURE_LIMIT):
        assert login(api_client, user.email, mfa_code="000000").status_code == 401
    good = _totp("JBSWY3DPEHPK3PXP")
    assert login(api_client, user.email, mfa_code=good).data["code"] == "login_locked"


def test_successful_and_failed_sign_ins_are_audited(api_client, user_factory):
    user = user_factory(email="audited@example.com")
    login(api_client, user.email, "wrong-password")
    login(api_client, user.email)
    failed = AuditLog.objects.get(action="account.login.failed")
    assert failed.actor == user and failed.metadata["reason"] == "invalid_credentials"
    succeeded = AuditLog.objects.get(action="account.login.succeeded")
    assert succeeded.actor == user and succeeded.metadata == {"method": "password"}


# ---- Per-IP limit -----------------------------------------------------------


def test_ip_limit_applies_only_to_ips_forwarded_with_the_bff_secret(api_client, user_factory, settings):
    settings.BFF_PROXY_SECRET = PROXY_SECRET
    user_factory(email="ip@example.com")
    headers = {"HTTP_X_ERGONX_PROXY_SECRET": PROXY_SECRET, "HTTP_X_ERGONX_CLIENT_IP": "203.0.113.9"}
    for number in range(LOGIN_IP_LIMIT):
        api_client.post(LOGIN, {"email": f"spray{number}@example.com", "password": "x"}, format="json", **headers)
    blocked = api_client.post(LOGIN, {"email": "ip@example.com", "password": PASSWORD_VALUE}, format="json", **headers)
    assert blocked.status_code == 429 and blocked.data["code"] == "login_rate_limited"
    other_ip = {**headers, "HTTP_X_ERGONX_CLIENT_IP": "203.0.113.10"}
    assert api_client.post(LOGIN, {"email": "ip@example.com", "password": PASSWORD_VALUE}, format="json", **other_ip).status_code == 200


def test_forwarded_ip_without_the_secret_is_ignored(api_client, user_factory, settings):
    settings.BFF_PROXY_SECRET = PROXY_SECRET
    user_factory(email="spoof@example.com")
    spoofed = {"HTTP_X_ERGONX_PROXY_SECRET": "guess", "HTTP_X_ERGONX_CLIENT_IP": "198.51.100.1"}
    api_client.post(LOGIN, {"email": "spoof@example.com", "password": "wrong"}, format="json", **spoofed)
    assert AuthAttempt.objects.get().ip_address != "198.51.100.1"


# ---- Email OTP --------------------------------------------------------------


def test_email_otp_challenge_masks_the_destination_and_reports_the_cooldown(api_client, email_otp_user):
    response = login(api_client, email_otp_user.email)
    assert response.status_code == 401 and response.data["code"] == "email_otp_required"
    assert response.data["errors"]["destination"] == "o•••@e•••.com"
    assert 0 < int(response.data["errors"]["resend_available_in"]) <= 60
    assert len(mail.outbox) == 1
    assert AuditLog.objects.filter(action="account.mfa.email_otp.issued", actor=email_otp_user).count() == 1


def test_resend_within_the_cooldown_keeps_the_open_code(api_client, email_otp_user):
    login(api_client, email_otp_user.email)
    code = sent_code()
    login(api_client, email_otp_user.email)
    assert len(mail.outbox) == 1
    assert login(api_client, email_otp_user.email, mfa_code=code).status_code == 200


def test_resend_after_the_cooldown_sends_a_new_code_and_retires_the_old(api_client, email_otp_user):
    login(api_client, email_otp_user.email)
    old_code = sent_code()
    EmailOTPChallenge.objects.update(sent_at=timezone.now() - timedelta(seconds=61))
    login(api_client, email_otp_user.email)
    assert len(mail.outbox) == 2
    new_code = sent_code()
    if old_code != new_code:
        assert login(api_client, email_otp_user.email, mfa_code=old_code).status_code == 401
    assert login(api_client, email_otp_user.email, mfa_code=new_code).status_code == 200


def test_email_otp_issue_cap(api_client, email_otp_user):
    for _ in range(EMAIL_OTP_ISSUE_LIMIT):
        login(api_client, email_otp_user.email)
        EmailOTPChallenge.objects.update(sent_at=timezone.now() - timedelta(seconds=61))
    response = login(api_client, email_otp_user.email)
    assert response.status_code == 429 and response.data["code"] == "email_otp_throttled"
    assert len(mail.outbox) == EMAIL_OTP_ISSUE_LIMIT


def test_email_otp_expires(api_client, email_otp_user):
    login(api_client, email_otp_user.email)
    code = sent_code()
    EmailOTPChallenge.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    response = login(api_client, email_otp_user.email, mfa_code=code)
    assert response.status_code == 401
    assert AuditLog.objects.filter(action="account.login.failed").latest("created_at").metadata["reason"] == "email_otp_invalid"


def test_email_otp_cannot_be_reused(api_client, email_otp_user):
    login(api_client, email_otp_user.email)
    code = sent_code()
    assert login(api_client, email_otp_user.email, mfa_code=code).status_code == 200
    assert login(api_client, email_otp_user.email, mfa_code=code).status_code in (401,)


def test_email_otp_attempt_limit_locks_the_code(api_client, email_otp_user):
    login(api_client, email_otp_user.email)
    code = sent_code()
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(4):
        login(api_client, email_otp_user.email, mfa_code=wrong)
    AuthAttempt.objects.all().delete()  # isolate the per-code limit from the account lock
    login(api_client, email_otp_user.email, mfa_code=wrong)
    AuthAttempt.objects.all().delete()
    assert login(api_client, email_otp_user.email, mfa_code=code).status_code == 401
    assert AuditLog.objects.filter(action="account.mfa.email_otp.locked").exists()


def test_mfa_enrolment_response_masks_the_email(api_client, user_factory, email_delivery):
    user = user_factory(email="enrol.me@example.com")
    api_client.force_authenticate(user)
    response = api_client.patch(MFA, {"method": "EMAIL_OTP"}, format="json")
    assert response.status_code == 200
    assert response.json()["data"]["email"] == mask_email(user.email) == "e•••@e•••.com"


# ---- Token revocation -------------------------------------------------------


def test_logout_blacklists_the_refresh_token(api_client, user_factory):
    user = user_factory(email="logout@example.com")
    pair = tokens(login(api_client, user.email))
    assert api_client.post(LOGOUT, {"refresh": pair["refresh"]}, format="json").status_code == 200
    assert api_client.post(REFRESH, {"refresh": pair["refresh"]}, format="json").status_code == 401
    assert AuditLog.objects.filter(action="account.logout", actor=user).exists()


def test_logout_with_a_bad_token_still_succeeds(api_client, db):
    response = api_client.post(LOGOUT, {"refresh": "not-a-token"}, format="json")
    assert response.status_code == 200 and response.json()["data"] == {"logged_out": True}


def test_password_change_ends_other_sessions_but_keeps_this_one(api_client, user_factory):
    user = user_factory(email="pw@example.com")
    this_session = tokens(login(api_client, user.email))
    other_session = tokens(login(api_client, user.email))
    api_client.force_authenticate(user)
    response = api_client.post(
        PASSWORD,
        {"current_password": PASSWORD_VALUE, "new_password": "AnotherStrong456!", "current_refresh": this_session["refresh"]},
        format="json",
    )
    assert response.status_code == 200, response.data
    api_client.force_authenticate(None)
    assert api_client.post(REFRESH, {"refresh": other_session["refresh"]}, format="json").status_code == 401
    assert api_client.post(REFRESH, {"refresh": this_session["refresh"]}, format="json").status_code == 200
    assert AuditLog.objects.get(action="account.password.changed").metadata["sessions_revoked"] == 1


# ---- Append-only audit -------------------------------------------------------


def test_audit_records_cannot_be_changed_or_deleted(user_factory):
    user = user_factory()
    event = AuditLog.objects.create(actor=user, action="test.event")
    event.action = "tampered"
    with pytest.raises(AuditLogImmutable):
        event.save()
    with pytest.raises(AuditLogImmutable):
        event.delete()
    with pytest.raises(AuditLogImmutable):
        AuditLog.objects.filter(pk=event.pk).update(action="tampered")
    with pytest.raises(AuditLogImmutable):
        AuditLog.objects.filter(pk=event.pk).delete()


def test_deleting_a_user_keeps_their_audit_records(user_factory):
    user = user_factory()
    AuditLog.objects.create(actor=user, action="test.event")
    user.delete()
    assert AuditLog.objects.get(action="test.event").actor is None


# ---- Authenticator app (TOTP) and MFA removal --------------------------------


def _totp_now(secret):
    import time

    return _totp(secret, int(time.time()))


def test_authenticator_setup_confirms_only_with_a_valid_code(api_client, user_factory):
    user = user_factory(email="totp.setup@example.com")
    api_client.force_authenticate(user)
    secret = api_client.post(MFA, {}, format="json").json()["data"]["secret"]

    wrong = api_client.put(MFA, {"code": "000000" if _totp_now(secret) != "000000" else "111111"}, format="json")
    assert wrong.status_code == 400
    assert not UserMFA.objects.get(user=user).is_enabled

    right = api_client.put(MFA, {"code": _totp_now(secret)}, format="json")
    assert right.status_code == 200
    assert UserMFA.objects.get(user=user).is_enabled
    assert AuditLog.objects.filter(actor=user, action="account.mfa.enabled").exists()


def test_sign_in_with_authenticator_rejects_a_drifted_code(api_client, user_factory):
    user = user_factory(email="totp.drift@example.com")
    mfa = UserMFA.objects.create(user=user, secret="JBSWY3DPEHPK3PXP", is_enabled=True)
    import time

    stale = _totp(mfa.secret, int(time.time()) - 5 * 30)
    if stale in {_totp(mfa.secret, int(time.time()) + drift * 30) for drift in (-1, 0, 1)}:
        pytest.skip("the stale code happens to equal a current one")
    assert login(api_client, user.email, mfa_code=stale).status_code in (400, 401)
    assert login(api_client, user.email, mfa_code=_totp_now(mfa.secret)).status_code == 200


def test_turning_off_mfa_needs_the_current_password(api_client, user_factory):
    user = user_factory(email="totp.off@example.com")
    UserMFA.objects.create(user=user, secret="JBSWY3DPEHPK3PXP", is_enabled=True)
    api_client.force_authenticate(user)

    refused = api_client.delete(MFA, {"current_password": "wrong"}, format="json")
    assert refused.status_code == 400
    assert UserMFA.objects.filter(user=user, is_enabled=True).exists()
    assert AuditLog.objects.filter(actor=user, action="account.mfa.disable_refused").exists()

    assert api_client.delete(MFA, format="json").status_code == 400

    allowed = api_client.delete(MFA, {"current_password": PASSWORD_VALUE}, format="json")
    assert allowed.status_code == 200
    assert not UserMFA.objects.filter(user=user).exists()
    assert AuditLog.objects.filter(actor=user, action="account.mfa.disabled").exists()


def test_sign_in_activity_lists_only_the_callers_events(api_client, user_factory):
    user = user_factory(email="activity.owner@example.com")
    other = user_factory(email="activity.other@example.com")
    login(api_client, user.email, "wrong-password")
    login(api_client, user.email)
    login(api_client, other.email)
    api_client.force_authenticate(user)

    events = api_client.get("/api/v1/auth/security/activity/").json()["data"]["events"]

    assert [event["action"] for event in events] == ["account.login.succeeded", "account.login.failed"]
    assert all("code" not in str(event["detail"]).lower() for event in events)
