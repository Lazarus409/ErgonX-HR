"""Super Admin (platform) console: organizations directory, overview and audit.

Every endpoint here is for platform administrators only. Tenant endpoints never
serve these users, because a platform administrator has no institution membership.
"""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Count, IntegerField, Max, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import InstitutionAccessRequest, InstitutionAdminInvitation, User
from apps.audit.models import AuditLog
from apps.audit.serializers import safe_metadata
from apps.audit.services import record_audit_event
from apps.employees.models import Employee
from apps.institutions.models import Institution, InstitutionMembership, InstitutionModule

PLATFORM_ACTION_PREFIX = "platform."


class IsPlatformAdmin(BasePermission):
    message = "Only a platform administrator can use the platform console."

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if not (user.is_platform_admin or user.is_superuser):
            raise PermissionDenied(self.message)
        return True


PLATFORM_PERMISSIONS = [IsAuthenticated, IsPlatformAdmin]


def expire_stale_admin_invitations():
    """Mark pending invitations whose link has lapsed, so lists show the truth."""
    InstitutionAdminInvitation.objects.filter(
        status=InstitutionAdminInvitation.Status.PENDING, expires_at__lte=timezone.now()
    ).update(status=InstitutionAdminInvitation.Status.EXPIRED, updated_at=timezone.now())


def record_platform_event(*, actor, action, institution=None, entity=None, metadata=None):
    return record_audit_event(
        actor=actor,
        action=f"{PLATFORM_ACTION_PREFIX}{action}",
        institution=institution,
        entity=entity,
        metadata=metadata,
    )


def _admin_memberships():
    return InstitutionMembership.objects.filter(role__code="INSTITUTION_ADMIN").exclude(
        status=InstitutionMembership.Status.INACTIVE
    )


def _annotated_institutions():
    active_members = (
        InstitutionMembership.objects.filter(institution=OuterRef("pk"), status=InstitutionMembership.Status.ACTIVE)
        .values("institution")
        .annotate(total=Count("pk"))
        .values("total")
    )
    employees = (
        Employee.objects.filter(institution=OuterRef("pk"))
        .values("institution")
        .annotate(total=Count("pk"))
        .values("total")
    )
    last_sign_in = (
        InstitutionMembership.objects.filter(institution=OuterRef("pk"))
        .values("institution")
        .annotate(latest=Max("user__last_login"))
        .values("latest")
    )
    primary_admin = _admin_memberships().filter(institution=OuterRef("pk")).order_by("joined_at", "created_at")
    return Institution.objects.select_related("onboarding").annotate(
        member_count=Coalesce(Subquery(active_members, output_field=IntegerField()), Value(0)),
        employee_count=Coalesce(Subquery(employees, output_field=IntegerField()), Value(0)),
        last_sign_in_at=Subquery(last_sign_in),
        admin_email=Subquery(primary_admin.values("user__email")[:1]),
        admin_first_name=Subquery(primary_admin.values("user__first_name")[:1]),
        admin_last_name=Subquery(primary_admin.values("user__last_name")[:1]),
    )


class PlatformInstitutionSerializer(serializers.ModelSerializer):
    member_count = serializers.IntegerField(read_only=True)
    employee_count = serializers.IntegerField(read_only=True)
    last_sign_in_at = serializers.DateTimeField(read_only=True, allow_null=True)
    onboarding_status = serializers.SerializerMethodField()
    primary_admin = serializers.SerializerMethodField()

    class Meta:
        model = Institution
        fields = (
            "id", "name", "code", "institution_type", "country_code", "email", "is_active",
            "suspended_at", "created_at", "member_count", "employee_count", "last_sign_in_at",
            "onboarding_status", "primary_admin",
        )
        read_only_fields = fields

    def get_onboarding_status(self, instance) -> str:
        onboarding = getattr(instance, "onboarding", None)
        return onboarding.status if onboarding else "NOT_STARTED"

    def get_primary_admin(self, instance) -> dict | None:
        if not instance.admin_email:
            return None
        name = " ".join(part for part in (instance.admin_first_name, instance.admin_last_name) if part)
        return {"email": instance.admin_email, "name": name or instance.admin_email}


class PlatformAuditEventSerializer(serializers.ModelSerializer):
    actor_email = serializers.EmailField(source="actor.email", read_only=True, allow_null=True)
    institution = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ("id", "created_at", "action", "actor_email", "institution", "entity_type", "entity_id", "ip_address", "metadata")
        read_only_fields = fields

    def get_institution(self, instance) -> dict | None:
        if instance.institution_id is None:
            return None
        return {"id": str(instance.institution_id), "name": instance.institution.name}

    def get_metadata(self, instance) -> dict:
        return safe_metadata(instance.metadata)


class SuspendInstitutionSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)


class PlatformInstitutionListView(ListAPIView):
    serializer_class = PlatformInstitutionSerializer
    permission_classes = PLATFORM_PERMISSIONS

    @extend_schema(parameters=[OpenApiParameter("q", str), OpenApiParameter("status", str, enum=["active", "suspended"])])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        queryset = _annotated_institutions().order_by("name", "id")
        params = self.request.query_params
        if search := params.get("q", "").strip():
            queryset = queryset.filter(Q(name__icontains=search) | Q(code__icontains=search) | Q(email__icontains=search))
        status = params.get("status")
        if status == "active":
            queryset = queryset.filter(is_active=True)
        elif status == "suspended":
            queryset = queryset.filter(is_active=False)
        return queryset


class PlatformInstitutionDetailView(APIView):
    permission_classes = PLATFORM_PERMISSIONS

    @staticmethod
    def detail_payload(institution):
        data = PlatformInstitutionSerializer(institution).data
        enabled = set(institution.modules.filter(is_enabled=True).values_list("module_code", flat=True))
        admins = (
            _admin_memberships()
            .filter(institution=institution)
            .select_related("user", "user__mfa")
            .order_by("joined_at", "created_at")
        )
        members_by_status = dict(
            institution.memberships.order_by().values("status").annotate(total=Count("pk")).values_list("status", "total")
        )
        invitation = institution.admin_invitations.select_related("invited_by").order_by("created_at").first()
        events = (
            AuditLog.objects.filter(institution=institution, action__startswith=PLATFORM_ACTION_PREFIX)
            .select_related("actor", "institution")
            .order_by("-created_at")[:10]
        )
        data.update({
            "phone": institution.phone,
            "address": institution.address,
            "timezone": institution.timezone,
            "default_currency": institution.default_currency,
            "suspension_reason": institution.suspension_reason,
            "modules": [
                {"code": code, "name": label, "enabled": code in enabled}
                for code, label in InstitutionModule.ModuleCode.choices
                if code not in settings.ERGONX_EXCLUDED_MODULES
            ],
            "administrators": [
                {
                    "name": membership.user.get_full_name() or membership.user.email,
                    "email": membership.user.email,
                    "status": membership.status,
                    "last_login": membership.user.last_login,
                    "mfa_enabled": bool(getattr(getattr(membership.user, "mfa", None), "is_enabled", False)),
                }
                for membership in admins
            ],
            "members_by_status": {status: members_by_status.get(status, 0) for status in InstitutionMembership.Status.values},
            "origin_invitation": None if invitation is None else {
                "id": str(invitation.id),
                "email": invitation.email,
                "created_at": invitation.created_at,
                "accepted_at": invitation.accepted_at,
                "invited_by_email": invitation.invited_by.email if invitation.invited_by else None,
            },
            "recent_events": PlatformAuditEventSerializer(events, many=True).data,
        })
        return data

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request, pk):
        institution = _annotated_institutions().filter(pk=pk).first()
        if institution is None:
            return Response({"detail": "Organization not found."}, status=404)
        return Response(self.detail_payload(institution))


class PlatformInstitutionStatusView(APIView):
    """Suspend (with a reason) or reactivate an organization."""

    permission_classes = PLATFORM_PERMISSIONS

    @extend_schema(request=SuspendInstitutionSerializer, responses={200: OpenApiTypes.OBJECT})
    @transaction.atomic
    def post(self, request, pk, action):
        if action not in ("suspend", "reactivate"):
            return Response({"detail": "Unknown action."}, status=404)
        institution = Institution.objects.select_for_update().filter(pk=pk).first()
        if institution is None:
            return Response({"detail": "Organization not found."}, status=404)
        if action == "suspend":
            if not institution.is_active:
                return Response({"detail": "This organization is already suspended."}, status=409)
            serializer = SuspendInstitutionSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            institution.is_active = False
            institution.suspended_at = timezone.now()
            institution.suspension_reason = serializer.validated_data["reason"]
            metadata = {"reason": institution.suspension_reason}
        else:
            if institution.is_active:
                return Response({"detail": "This organization is already active."}, status=409)
            metadata = {"previous_reason": institution.suspension_reason}
            institution.is_active = True
            institution.suspended_at = None
            institution.suspension_reason = ""
        institution.save(update_fields=("is_active", "suspended_at", "suspension_reason", "updated_at"))
        record_platform_event(
            actor=request.user,
            action=f"institution.{'suspended' if action == 'suspend' else 'reactivated'}",
            institution=institution,
            entity=institution,
            metadata=metadata,
        )
        refreshed = _annotated_institutions().get(pk=institution.pk)
        return Response(PlatformInstitutionDetailView.detail_payload(refreshed))


def _monthly_counts(queryset, months):
    start = months[0]
    counts = {
        row["month"].date(): row["total"]
        for row in queryset.order_by().filter(created_at__gte=start)
        .annotate(month=TruncMonth("created_at"))
        .values("month")
        .annotate(total=Count("pk"))
    }
    return [counts.get(month.date(), 0) for month in months]


def _last_twelve_months(now):
    first_of_month = timezone.localtime(now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    months = []
    cursor = first_of_month
    for _ in range(12):
        months.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return list(reversed(months))


class PlatformOverviewView(APIView):
    permission_classes = PLATFORM_PERMISSIONS

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        expire_stale_admin_invitations()
        now = timezone.now()
        institutions = Institution.objects.all()
        tenant_users = User.objects.filter(is_active=True, is_platform_admin=False, is_superuser=False)
        months = _last_twelve_months(now)
        onboarding_counts = dict(
            institutions.order_by().values("onboarding__status").annotate(total=Count("pk")).values_list("onboarding__status", "total")
        )
        pending_invitations = InstitutionAdminInvitation.objects.filter(status=InstitutionAdminInvitation.Status.PENDING)
        return Response({
            # Whether approving an access request emails the invitation link.
            "email_delivery_enabled": settings.EMAIL_DELIVERY_ENABLED,
            "institutions": {
                "total": institutions.count(),
                "active": institutions.filter(is_active=True).count(),
                "suspended": institutions.filter(is_active=False).count(),
                "new_last_30_days": institutions.filter(created_at__gte=now - timedelta(days=30)).count(),
            },
            "users": {
                "total": tenant_users.count(),
                "signed_in_last_30_days": tenant_users.filter(last_login__gte=now - timedelta(days=30)).count(),
            },
            "employees": {"total": Employee.objects.count()},
            "onboarding": {
                status: onboarding_counts.get(status, 0) + (onboarding_counts.get(None, 0) if status == "NOT_STARTED" else 0)
                for status in ("NOT_STARTED", "IN_PROGRESS", "BLOCKED", "READY")
            },
            "pipeline": {
                "pending_requests": InstitutionAccessRequest.objects.filter(status=InstitutionAccessRequest.Status.PENDING).count(),
                "pending_invitations": pending_invitations.count(),
                "invitations_expiring_48h": pending_invitations.filter(expires_at__lte=now + timedelta(hours=48)).count(),
            },
            "growth": {
                "months": [month.date().isoformat() for month in months],
                "institutions": _monthly_counts(institutions, months),
                "access_requests": _monthly_counts(InstitutionAccessRequest.objects.all(), months),
            },
            "recent_institutions": PlatformInstitutionSerializer(
                _annotated_institutions().order_by("-created_at")[:5], many=True
            ).data,
        })


class PlatformAuditLogView(ListAPIView):
    """Actions taken by platform administrators and organization sign-ups."""

    serializer_class = PlatformAuditEventSerializer
    permission_classes = PLATFORM_PERMISSIONS

    @extend_schema(parameters=[OpenApiParameter("action", str), OpenApiParameter("institution", str), OpenApiParameter("q", str)])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        queryset = (
            AuditLog.objects.filter(action__startswith=PLATFORM_ACTION_PREFIX)
            .select_related("actor", "institution")
            .order_by("-created_at", "-id")
        )
        params = self.request.query_params
        if action := params.get("action", "").strip():
            queryset = queryset.filter(action__startswith=f"{PLATFORM_ACTION_PREFIX}{action}")
        if institution := params.get("institution", "").strip():
            queryset = queryset.filter(institution_id=institution) if _is_uuid(institution) else queryset.none()
        if search := params.get("q", "").strip():
            queryset = queryset.filter(
                Q(actor__email__icontains=search) | Q(institution__name__icontains=search) | Q(metadata__icontains=search)
            )
        return queryset


def _is_uuid(value):
    from uuid import UUID

    try:
        UUID(value)
    except ValueError:
        return False
    return True
