"""Member-initiated access requests (concept "Governed empty, error and loading states": "Request access").

A member who meets a permission-restricted page can ask for access. The request goes to the members
who can manage users as an in-app notification and is kept in the audit trail; granting access stays
a deliberate change in Users & Access.
"""
from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import record_audit_event
from apps.institutions.models import InstitutionMembership
from apps.notifications.models import Notification
from common.exceptions import CodedValidationError
from common.permissions import TenantContextPermission, TenantRBACPermission

ACCESS_REQUEST_TYPE = "ACCESS_REQUESTED"
ADMIN_PERMISSION = "settings.users.manage"
REPEAT_WINDOW = timedelta(hours=24)


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class AccessRequestView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]

    def get_required_permission(self):
        return None  # Any active member may ask; the request itself grants nothing.

    def post(self, request):
        area = str(request.data.get("area", "")).strip()[:200]
        permission = str(request.data.get("permission", "")).strip()[:100]
        path = str(request.data.get("path", "")).strip()[:300]
        note = str(request.data.get("note", "")).strip()[:1000]
        if not area and not permission:
            raise CodedValidationError({"area": "Say which page or permission you need."}, api_code="validation_error")

        institution, user = request.institution, request.user
        recent = Notification.objects.filter(
            institution=institution, notification_type=ACCESS_REQUEST_TYPE, created_at__gte=timezone.now() - REPEAT_WINDOW,
            metadata__requester_id=str(user.id), metadata__area=area, metadata__permission=permission,
        )
        if recent.exists():
            return Response({"sent_to": 0, "already_requested": True})

        admins = InstitutionMembership.objects.filter(
            institution=institution, status=InstitutionMembership.Status.ACTIVE, role__permissions__code=ADMIN_PERMISSION,
        ).exclude(user=user).select_related("user").distinct()
        name = user.get_full_name() or user.email
        subject = area or permission
        metadata = {"requester_id": str(user.id), "requester": name, "area": area, "permission": permission, "path": path, "note": note}
        for membership in admins:
            Notification.objects.create(
                institution=institution, user=membership.user, notification_type=ACCESS_REQUEST_TYPE,
                title=f"{name} requested access", message=f"{name} asked for access to {subject}." + (f" Note: {note}" if note else ""),
                channel=Notification.Channel.IN_APP, metadata={**metadata, "href": "/settings/users"},
            )
        record_audit_event(actor=user, institution=institution, entity=request.membership, action="access.requested", metadata=metadata)
        return Response({"sent_to": admins.count(), "already_requested": False}, status=201)
