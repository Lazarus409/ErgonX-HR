from apps.accounts.security import client_ip
from apps.audit.context import (
    reset_audit_request_context,
    set_audit_request_context,
)


class AuditRequestContextMiddleware:
    """Makes trustworthy request metadata available to service-layer audit writes."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = set_audit_request_context(
            ip=client_ip(request)[0],
            user_agent=request.META.get("HTTP_USER_AGENT", ""),
        )
        try:
            return self.get_response(request)
        finally:
            reset_audit_request_context(token)
