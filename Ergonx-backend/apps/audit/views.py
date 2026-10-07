from django.db.models import Q
from django.utils.dateparse import parse_datetime
from uuid import UUID
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditLog
from apps.audit.serializers import AuditLogSerializer
from common.permissions import TenantContextPermission, TenantRBACPermission


# A "failed" event is a refused or failed attempt (sign-in, code, step-up),
# not a business decision such as a rejected leave request.
FAILED_ACTIONS = Q(action__endswith=".failed") | Q(action__endswith="_refused") | Q(action__endswith=".refused") | Q(action__endswith=".locked") | Q(action__endswith=".denied")
# Identity, access and institution-configuration events.
SECURITY_ACTIONS = Q(action__startswith="account.") | Q(action__startswith="access.") | Q(action__startswith="institution.setting") | Q(action__startswith="institution.module") | Q(action__startswith="security.")

FILTER_PARAMETERS = [
    OpenApiParameter("from", str), OpenApiParameter("to", str), OpenApiParameter("actor", str),
    OpenApiParameter("action", str), OpenApiParameter("entity_type", str), OpenApiParameter("entity_id", str), OpenApiParameter("q", str),
    OpenApiParameter("result", str, enum=("success", "failed")), OpenApiParameter("category", str, enum=("security",)),
]


def filtered_audit_logs(request):
    """This institution's audit events narrowed by the shared query parameters."""
    queryset = AuditLog.objects.for_institution(request.institution).select_related("actor")
    params = request.query_params
    if value := params.get("from"):
        parsed = parse_datetime(value)
        if not parsed:
            raise ValidationError({"from": "Use an ISO-8601 date-time."})
        queryset = queryset.filter(created_at__gte=parsed)
    if value := params.get("to"):
        parsed = parse_datetime(value)
        if not parsed:
            raise ValidationError({"to": "Use an ISO-8601 date-time."})
        queryset = queryset.filter(created_at__lte=parsed)
    if value := params.get("actor"):
        queryset = queryset.filter(actor__email__icontains=value)
    if value := params.get("action"):
        queryset = queryset.filter(action__icontains=value)
    if value := params.get("entity_type"):
        queryset = queryset.filter(entity_type__icontains=value)
    if value := params.get("entity_id"):
        try:
            queryset = queryset.filter(entity_id=UUID(value))
        except ValueError as error:
            raise ValidationError({"entity_id": "Use a UUID."}) from error
    if value := params.get("q"):
        queryset = queryset.filter(Q(action__icontains=value) | Q(entity_type__icontains=value) | Q(actor__email__icontains=value))
    result = params.get("result")
    if result == "failed":
        queryset = queryset.filter(FAILED_ACTIONS)
    elif result == "success":
        queryset = queryset.exclude(FAILED_ACTIONS)
    if params.get("category") == "security":
        queryset = queryset.filter(SECURITY_ACTIONS)
    return queryset


class AuditLogListView(ListAPIView):
    serializer_class = AuditLogSerializer
    permission_classes = [TenantContextPermission, TenantRBACPermission]
    required_module = None

    def get_required_permission(self):
        return "audit.view"

    @extend_schema(parameters=FILTER_PARAMETERS, responses=AuditLogSerializer(many=True))
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AuditLog.objects.none()
        return filtered_audit_logs(self.request)


class AuditSummaryView(APIView):
    """Counts for the audit trail header, under the same filters as the list."""

    permission_classes = [TenantContextPermission, TenantRBACPermission]
    required_module = None

    def get_required_permission(self):
        return "audit.view"

    @extend_schema(parameters=FILTER_PARAMETERS, responses={200: {"type": "object", "properties": {"total": {"type": "integer"}, "successful": {"type": "integer"}, "failed": {"type": "integer"}, "security": {"type": "integer"}}}})
    def get(self, request):
        queryset = filtered_audit_logs(request)
        total = queryset.count()
        failed = queryset.filter(FAILED_ACTIONS).count()
        return Response({"total": total, "successful": total - failed, "failed": failed, "security": queryset.filter(SECURITY_ACTIONS).count()})
