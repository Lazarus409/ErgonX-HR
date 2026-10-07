"""Sign-in abuse controls: account lockout, per-IP limits, email masking and token revocation.

Limits (Wave 0 decision BQ-10, 2026-10-05):

* 5 failed sign-ins for one email within 15 minutes lock that email until the
  oldest of those failures is 15 minutes old. A wrong password, authenticator
  code or email code all count; a correct password during a lock is refused.
* 20 sign-in attempts per client IP per minute, applied only when the client IP
  is known (forwarded by the BFF with the shared secret). Without it every user
  would share the proxy's address.

Counts live in ``AuthAttempt`` rows so all gunicorn workers agree.
"""

import hmac
import ipaddress
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.exceptions import Throttled

from apps.accounts.models import AuthAttempt

LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW = timedelta(minutes=15)
LOGIN_IP_LIMIT = 20
LOGIN_IP_WINDOW = timedelta(minutes=1)
ATTEMPT_RETENTION = timedelta(days=1)

CLIENT_IP_HEADER = "HTTP_X_ERGONX_CLIENT_IP"
PROXY_SECRET_HEADER = "HTTP_X_ERGONX_PROXY_SECRET"


class LoginLocked(Throttled):
    api_code = "login_locked"


class LoginRateLimited(Throttled):
    api_code = "login_rate_limited"


def _minutes(seconds):
    minutes = max(1, -(-int(seconds) // 60))
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


def client_ip(request):
    """Return ``(ip, trusted)``.

    The browser reaches Django through the Next.js BFF, so REMOTE_ADDR is the
    proxy. The BFF forwards the real client address together with a shared
    secret; only then is the address trusted for rate limiting.
    """
    secret = getattr(settings, "BFF_PROXY_SECRET", "")
    supplied = request.META.get(PROXY_SECRET_HEADER, "")
    forwarded = request.META.get(CLIENT_IP_HEADER, "").strip()
    if secret and supplied and forwarded and hmac.compare_digest(secret, supplied):
        try:
            return str(ipaddress.ip_address(forwarded)), True
        except ValueError:
            pass
    return request.META.get("REMOTE_ADDR") or None, False


def email_key(email):
    return salted_hmac("ergonx-auth-attempt", str(email or "").strip().lower()).hexdigest()


def mask_email(email):
    """d•••@g•••.com: enough to recognise the mailbox, not enough to harvest it."""
    local, _, domain = str(email or "").partition("@")
    if not domain:
        return "•••"
    name, dot, tld = domain.rpartition(".")
    masked_domain = f"{name[:1]}•••{dot}{tld}" if dot else f"{domain[:1]}•••"
    return f"{local[:1]}•••@{masked_domain}"


def ensure_login_allowed(*, key, ip, ip_trusted):
    now = timezone.now()
    if ip and ip_trusted:
        recent = list(
            AuthAttempt.objects.filter(ip_address=ip, created_at__gte=now - LOGIN_IP_WINDOW)
            .order_by("-created_at")
            .values_list("created_at", flat=True)[:LOGIN_IP_LIMIT]
        )
        if len(recent) >= LOGIN_IP_LIMIT:
            wait = max(1, int((recent[-1] + LOGIN_IP_WINDOW - now).total_seconds()))
            raise LoginRateLimited(wait=wait, detail="Too many sign-in attempts from this network. Wait a minute and try again.")

    failures = AuthAttempt.objects.filter(
        email_key=key, outcome=AuthAttempt.Outcome.FAILED, created_at__gte=now - LOGIN_FAILURE_WINDOW
    )
    last_success = (
        AuthAttempt.objects.filter(email_key=key, outcome=AuthAttempt.Outcome.SUCCEEDED)
        .order_by("-created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    if last_success:
        failures = failures.filter(created_at__gt=last_success)
    times = list(failures.order_by("-created_at").values_list("created_at", flat=True)[:LOGIN_FAILURE_LIMIT])
    if len(times) >= LOGIN_FAILURE_LIMIT:
        unlock_at = times[-1] + LOGIN_FAILURE_WINDOW
        wait = max(1, int((unlock_at - now).total_seconds()))
        raise LoginLocked(
            wait=wait,
            detail=f"Too many failed sign-in attempts. For your security this account is locked; try again in {_minutes(wait)}.",
        )


def record_login_attempt(*, key, ip, outcome, reason=""):
    now = timezone.now()
    AuthAttempt.objects.create(email_key=key, ip_address=ip, outcome=outcome, reason=reason[:40])
    AuthAttempt.objects.filter(created_at__lt=now - ATTEMPT_RETENTION).delete()


def revoke_refresh_tokens(user, *, keep_jti=None):
    """Blacklist every live refresh token the user holds, optionally sparing one session."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    tokens = OutstandingToken.objects.filter(user=user, expires_at__gt=timezone.now(), blacklistedtoken__isnull=True)
    if keep_jti:
        tokens = tokens.exclude(jti=keep_jti)
    revoked = 0
    for token in tokens:
        BlacklistedToken.objects.get_or_create(token=token)
        revoked += 1
    return revoked
