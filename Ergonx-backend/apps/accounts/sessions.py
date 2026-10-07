"""Signed-in sessions (Wave 2): issue tokens bound to a session, list and revoke them."""

from django.conf import settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import UserSession
from apps.accounts.security import client_ip
from apps.audit.services import record_audit_event

SESSION_CLAIM = "sid"


def start_session(user, request=None):
    """Create a session and return its refresh token (access via ``.access_token``)."""
    meta = getattr(request, "META", {}) if request is not None else {}
    session = UserSession.objects.create(
        user=user,
        ip_address=client_ip(request)[0] if request is not None else None,
        user_agent=str(meta.get("HTTP_USER_AGENT", ""))[:300],
        last_seen_at=timezone.now(),
    )
    refresh = RefreshToken.for_user(user)
    refresh["email"] = user.email
    refresh[SESSION_CLAIM] = str(session.id)
    return refresh


def session_is_active(sid):
    return UserSession.objects.filter(pk=sid, revoked_at__isnull=True).exists()


def active_sessions(user):
    """Unrevoked sessions whose refresh token can still be valid."""
    cutoff = timezone.now() - settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"]
    return UserSession.objects.filter(user=user, revoked_at__isnull=True, last_seen_at__gte=cutoff).order_by("-last_seen_at")


def revoke_sessions(user, *, actor, reason, keep_sid=None, only=None):
    """Revoke the user's sessions (all, all but ``keep_sid``, or ``only`` one). Returns the count."""
    sessions = UserSession.objects.filter(user=user, revoked_at__isnull=True)
    if only is not None:
        sessions = sessions.filter(pk=only)
    elif keep_sid:
        sessions = sessions.exclude(pk=keep_sid)
    ids = [str(pk) for pk in sessions.values_list("pk", flat=True)]
    if not ids:
        return 0
    UserSession.objects.filter(pk__in=ids).update(revoked_at=timezone.now(), revoked_reason=reason[:40])
    record_audit_event(actor=actor, entity=user, action="account.session.revoked", metadata={"sessions": ids, "reason": reason})
    return len(ids)

