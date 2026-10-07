"""Every tenant endpoint names the permission it needs (fail-closed review guard).

TenantRBACPermission allows a request when a view resolves no permission
code. That is intended only for the endpoints listed here, whose services
authorize the actor themselves. Any new unmapped endpoint fails this test.
"""

from django.urls import get_resolver
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from common.permissions import TenantRBACPermission

# Decisions are authorized by step assignment (approver) or authorship (cancel)
# inside the workflow service; the access request is self-service.
SERVICE_AUTHORIZED = {
    ("AccessRequestView", "post", None),
    ("ApprovalRequestViewSet", "post", "approve"),
    ("ApprovalRequestViewSet", "post", "reject"),
    ("ApprovalRequestViewSet", "post", "return_for_changes"),
    ("ApprovalRequestViewSet", "post", "cancel"),
}


def _unmapped():
    factory = APIRequestFactory()
    found = set()

    def walk(patterns):
        for pattern in patterns:
            if hasattr(pattern, "url_patterns"):
                walk(pattern.url_patterns)
                continue
            cls = getattr(pattern.callback, "cls", None)
            if cls is None or TenantRBACPermission not in getattr(cls, "permission_classes", []):
                continue
            actions = getattr(pattern.callback, "actions", None) or {}
            pairs = actions.items() if actions else [(m, None) for m in ("get", "post", "put", "patch", "delete") if hasattr(cls, m)]
            for method, action_name in pairs:
                view = cls()
                view.action = action_name
                view.request = Request(getattr(factory, method)("/"))
                view.kwargs = {}
                view.format_kwarg = None
                if view.get_required_permission() is None:
                    found.add((cls.__name__, method, action_name))

    walk(get_resolver().url_patterns)
    return found


def test_only_service_authorized_endpoints_skip_the_permission_check(db):
    assert _unmapped() == SERVICE_AUTHORIZED
