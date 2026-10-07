from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken

from apps.accounts.sessions import SESSION_CLAIM, session_is_active


class SessionJWTAuthentication(JWTAuthentication):
    """JWT authentication that also refuses tokens of a revoked session.

    Tokens issued before sessions existed carry no ``sid`` and are accepted
    until they expire.
    """

    def get_validated_token(self, raw_token):
        token = super().get_validated_token(raw_token)
        sid = token.get(SESSION_CLAIM)
        if sid and not session_is_active(sid):
            raise InvalidToken({"detail": "This session has been signed out.", "code": "session_revoked"})
        return token


try:
    from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme
except ImportError:  # pragma: no cover - schema tooling not installed
    SimpleJWTScheme = None

if SimpleJWTScheme is not None:

    class SessionJWTScheme(SimpleJWTScheme):
        """Document SessionJWTAuthentication as the same bearer scheme (``jwtAuth``)."""

        target_class = "apps.accounts.authentication.SessionJWTAuthentication"
