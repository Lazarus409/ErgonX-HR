from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.decorators import action
from django.utils import timezone
from datetime import timedelta
from drf_spectacular.utils import OpenApiTypes, extend_schema

from apps.institutions.serializers import (
    CurrentInstitutionSerializer,
    MembershipSerializer,
    MembershipUpdateSerializer,
    MembershipInviteSerializer,
    InvitationCreateSerializer,
    PermissionSerializer,
    RoleSerializer,
    CustomRoleCreateSerializer,
    CloneRoleSerializer,
    CustomRoleUpdateSerializer,
    UserPreferenceSerializer,
    InstitutionOnboardingSerializer,
    InstitutionModuleSerializer,
    InstitutionSettingSerializer,
    InstitutionProfileUpdateSerializer,
    LocaleCataloguesSerializer,
    InstitutionInvitationSerializer,
)
from apps.institutions.models import InstitutionInvitation, InstitutionMembership, InstitutionModule, InstitutionOnboarding, InstitutionOnboardingStep, InstitutionSetting, Permission, Role, UserPreference
from apps.audit.services import record_audit_event
from apps.institutions.services import ONBOARDING_STEP_DEFINITIONS, effective_permission_codes, governed_setting_permission, validate_governed_setting, set_module_enabled, clone_role, create_custom_role, create_invitation, invite_existing_user, reconcile_institution_onboarding, resume_institution_onboarding_step, revoke_invitation, skip_institution_onboarding_step, update_custom_role, update_membership, validate_institution_onboarding
from apps.institutions.search import universal_search
from apps.institutions.catalogues import locale_catalogues
from common.product import excluded_permission_codes_q, excluded_role_codes
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet
from common.scoping import scope_to_employees
from common.permissions import TenantContextPermission, TenantRBACPermission


class CurrentInstitutionView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]
    required_module = None

    def get_required_permission(self):
        return "settings.institution.manage" if self.request.method == "PATCH" else "institution.view"

    def _context_response(self, request):
        capabilities = list(
            request.institution.modules.filter(is_enabled=True)
            .order_by("module_code")
            .values_list("module_code", flat=True)
        )
        return Response(CurrentInstitutionSerializer({
            "institution": request.institution,
            "membership": request.membership,
            "active_capabilities": capabilities,
        }).data)

    @extend_schema(responses=CurrentInstitutionSerializer)
    def get(self, request):
        return self._context_response(request)

    @extend_schema(request=InstitutionProfileUpdateSerializer, responses=CurrentInstitutionSerializer)
    def patch(self, request):
        serializer = InstitutionProfileUpdateSerializer(
            request.institution,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        reconcile_institution_onboarding(request.institution)
        call_validated_service(validate_institution_onboarding, institution=request.institution, actor=request.user)
        return self._context_response(request)


class MyMembershipsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=MembershipSerializer(many=True))
    def get(self, request):
        memberships = request.user.memberships.select_related(
            "institution", "role"
        ).prefetch_related("role__permissions")
        return Response(MembershipSerializer(memberships, many=True).data)


class MembershipViewSet(TenantModelViewSet):
    model = InstitutionMembership
    serializer_class = MembershipSerializer
    required_permission = "settings.users.manage"
    http_method_names = ("get", "post", "patch", "head", "options")
    search_fields = ("user__email", "user__first_name", "user__last_name", "role__code")
    ordering_fields = ("status", "joined_at", "created_at")

    def get_queryset(self):
        return super().get_queryset().select_related("user", "role", "institution").prefetch_related("role__permissions")

    def partial_update(self, request, *args, **kwargs):
        payload = MembershipUpdateSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data.copy()
        role_id = values.pop("role_id", None)
        role = None
        if role_id:
            role = Role.objects.for_institution(request.institution).get(pk=role_id)
        membership = call_validated_service(
            update_membership,
            membership=self.get_object(),
            institution=request.institution,
            actor=request.user,
            role=role,
            **values,
        )
        return Response(self.get_serializer(membership).data)

    def create(self, request, *args, **kwargs):
        payload = MembershipInviteSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        role = Role.objects.for_institution(request.institution).get(pk=payload.validated_data["role_id"])
        membership = call_validated_service(
            invite_existing_user,
            institution=request.institution,
            actor=request.user,
            role=role,
            email=payload.validated_data["email"],
            is_primary=payload.validated_data["is_primary"],
        )
        return Response(self.get_serializer(membership).data, status=201)

    @action(detail=False, methods=("post",), url_path="invite-link")
    def invite_link(self, request):
        payload = InvitationCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        role = Role.objects.for_institution(request.institution).get(pk=payload.validated_data["role_id"])
        invitation, token = call_validated_service(create_invitation, institution=request.institution, actor=request.user, role=role, email=payload.validated_data["email"], expires_at=timezone.now() + timedelta(hours=payload.validated_data["expires_in_hours"]))
        return Response({"id": str(invitation.id), "email": invitation.email, "expires_at": invitation.expires_at, "acceptance_token": token})


class InstitutionInvitationViewSet(TenantModelViewSet):
    """Invitation lifecycle for access administrators; no tokens are persisted or listed."""

    model = InstitutionInvitation
    serializer_class = InstitutionInvitationSerializer
    required_permission = "settings.users.manage"
    http_method_names = ("get", "post", "head", "options")
    ordering_fields = ("created_at", "expires_at", "status", "email")
    search_fields = ("email", "role__name", "role__code")

    def get_queryset(self):
        return super().get_queryset().select_related("role", "invited_by").prefetch_related("role__permissions")

    def create(self, request, *args, **kwargs):
        payload = InvitationCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        role = Role.objects.for_institution(request.institution).get(pk=payload.validated_data["role_id"])
        invitation, token = call_validated_service(
            create_invitation,
            institution=request.institution,
            actor=request.user,
            role=role,
            email=payload.validated_data["email"],
            expires_at=timezone.now() + timedelta(hours=payload.validated_data["expires_in_hours"]),
        )
        return Response({"invitation": self.get_serializer(invitation).data, "acceptance_token": token}, status=201)

    @action(detail=True, methods=("post",))
    def revoke(self, request, pk=None):
        invitation = call_validated_service(revoke_invitation, invitation=self.get_object(), institution=request.institution, actor=request.user)
        return Response(self.get_serializer(invitation).data)

    @action(detail=True, methods=("post",))
    def resend(self, request, pk=None):
        previous = self.get_object()
        call_validated_service(revoke_invitation, invitation=previous, institution=request.institution, actor=request.user)
        invitation, token = call_validated_service(
            create_invitation,
            institution=request.institution,
            actor=request.user,
            role=previous.role,
            email=previous.email,
            expires_at=timezone.now() + timedelta(days=7),
        )
        return Response({"invitation": self.get_serializer(invitation).data, "acceptance_token": token})


class PermissionCatalogView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]

    def get_required_permission(self):
        return "settings.roles.manage"

    @extend_schema(responses=PermissionSerializer(many=True))
    def get(self, request):
        offered = Permission.objects.exclude(excluded_permission_codes_q()).order_by("code")
        return Response(PermissionSerializer(offered, many=True).data)


class RoleViewSet(TenantModelViewSet):
    model = Role
    serializer_class = RoleSerializer
    required_permission = "settings.roles.manage"
    http_method_names = ("get", "post", "patch", "head", "options")
    search_fields = ("code", "name", "description")
    ordering_fields = ("code", "name", "created_at", "updated_at")

    def get_queryset(self):
        return super().get_queryset().exclude(code__in=excluded_role_codes()).prefetch_related("permissions")

    def create(self, request, *args, **kwargs):
        payload = CustomRoleCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        role = call_validated_service(create_custom_role, institution=request.institution, actor=request.user, **payload.validated_data)
        return Response(self.get_serializer(role).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        payload = CustomRoleUpdateSerializer(data=request.data, partial=True)
        payload.is_valid(raise_exception=True)
        role = call_validated_service(update_custom_role, role=self.get_object(), institution=request.institution, actor=request.user, **payload.validated_data)
        return Response(self.get_serializer(role).data)

    @action(detail=False, methods=("post",), url_path="clone")
    def clone(self, request):
        payload = CloneRoleSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        source_role = Role.objects.for_institution(request.institution).get(pk=payload.validated_data.pop("source_role_id"))
        role = call_validated_service(clone_role, source_role=source_role, institution=request.institution, actor=request.user, **payload.validated_data)
        return Response(self.get_serializer(role).data, status=201)


class MyPreferencesView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]
    serializer_class = UserPreferenceSerializer

    def get_required_permission(self):
        return "settings.profile.manage_self"

    def get(self, request):
        rows = UserPreference.objects.for_institution(request.institution).filter(user=request.user)
        return Response(UserPreferenceSerializer(rows, many=True).data)

    @extend_schema(request=UserPreferenceSerializer, responses=UserPreferenceSerializer)
    def put(self, request):
        payload = UserPreferenceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        preference, _ = UserPreference.objects.update_or_create(
            institution=request.institution,
            user=request.user,
            preference_key=payload.validated_data["preference_key"],
            defaults={"value_json": payload.validated_data["value_json"]},
        )
        return Response(UserPreferenceSerializer(preference).data)


class InstitutionSettingsView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]
    serializer_class = InstitutionSettingSerializer

    def get_required_permission(self):
        return "settings.institution.view"

    def get(self, request):
        rows = InstitutionSetting.objects.for_institution(request.institution).filter(is_sensitive=False)
        return Response(InstitutionSettingSerializer(rows, many=True).data)

    @extend_schema(request=InstitutionSettingSerializer, responses=InstitutionSettingSerializer)
    def put(self, request):
        from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError

        payload = InstitutionSettingSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        key = payload.validated_data["key"].strip().lower()
        value = payload.validated_data["value"]
        # Each settings family has its own permission (W0-PERM-05).
        required = governed_setting_permission(key)
        if required not in effective_permission_codes(request.membership):
            raise PermissionDenied("Your institution role does not grant this permission.")
        problem = validate_governed_setting(key, value)
        if problem:
            raise DRFValidationError({"value": problem})
        existing = InstitutionSetting.objects.filter(institution=request.institution, key=key).first()
        before = existing.value if existing else None
        setting, _ = InstitutionSetting.objects.update_or_create(
            institution=request.institution,
            key=key,
            defaults={"value": value, "updated_by": request.user},
        )
        if before != value:
            record_audit_event(actor=request.user, institution=request.institution, entity=setting, action="institution.setting.updated", metadata={"key": key, "changes": {"value": [before, value]}})
        return Response(InstitutionSettingSerializer(setting).data)


class InstitutionModuleViewSet(TenantModelViewSet):
    model = InstitutionModule
    serializer_class = InstitutionModuleSerializer
    required_permission = "settings.modules.manage"
    http_method_names = ("get", "patch", "head", "options")
    ordering_fields = ("module_code", "updated_at")

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        module = instance
        if "is_enabled" in serializer.validated_data:
            module = call_validated_service(set_module_enabled, module=instance, institution=request.institution, actor=request.user, is_enabled=serializer.validated_data["is_enabled"])
        call_validated_service(validate_institution_onboarding, institution=request.institution, actor=request.user)
        return Response(self.get_serializer(module).data)


class InstitutionOnboardingView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]

    def get_required_permission(self):
        return "onboarding.view"

    @extend_schema(responses=InstitutionOnboardingSerializer)
    def get(self, request):
        reconcile_institution_onboarding(request.institution)
        onboarding, _ = InstitutionOnboarding.objects.get_or_create(institution=request.institution)
        return Response(InstitutionOnboardingSerializer(onboarding).data)

    @extend_schema(
        operation_id="institutions_onboarding_validate",
        request=OpenApiTypes.OBJECT,
        responses=InstitutionOnboardingSerializer,
    )
    def post(self, request):
        if "onboarding.manage" not in request.membership.role.permissions.values_list("code", flat=True):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Your institution role does not grant this permission.")
        onboarding, _ = call_validated_service(validate_institution_onboarding, institution=request.institution, actor=request.user)
        return Response(InstitutionOnboardingSerializer(onboarding).data)


@extend_schema(responses=InstitutionOnboardingSerializer)
class InstitutionOnboardingStepActionView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]
    serializer_class = InstitutionOnboardingSerializer

    def get_required_permission(self):
        return "onboarding.manage"

    @extend_schema(operation_id="institutions_onboarding_step_action")
    def post(self, request, step_code, action_name):
        if action_name not in {"skip", "resume"}:
            from rest_framework.exceptions import NotFound
            raise NotFound("Unsupported onboarding action.")
        if step_code not in {item[0] for item in ONBOARDING_STEP_DEFINITIONS}:
            from rest_framework.exceptions import NotFound
            raise NotFound("Onboarding step was not found.")
        reconcile_institution_onboarding(request.institution)
        service = skip_institution_onboarding_step if action_name == "skip" else resume_institution_onboarding_step
        call_validated_service(service, institution=request.institution, actor=request.user, step_code=step_code)
        onboarding, _ = call_validated_service(validate_institution_onboarding, institution=request.institution, actor=request.user)
        return Response(InstitutionOnboardingSerializer(onboarding).data)


class LocaleCataloguesView(APIView):
    """Public reference data; values are validated by profile serializers."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=LocaleCataloguesSerializer)
    @extend_schema(responses=UserPreferenceSerializer(many=True))
    @extend_schema(responses=InstitutionSettingSerializer(many=True))
    def get(self, request):
        return Response(locale_catalogues())


@extend_schema(responses={200: OpenApiTypes.OBJECT})
class UniversalSearchView(APIView):
    permission_classes = [TenantContextPermission, TenantRBACPermission]

    def get_required_permission(self):
        return "search.use"

    def get(self, request):
        from common.exceptions import CodedValidationError

        query = request.query_params.get("q", "").strip()
        if len(query) < 2:
            raise CodedValidationError("Search query must contain at least two characters.", api_code="search_query_invalid")
        raw_types = request.query_params.get("types", "")
        result_types = tuple(item.strip().upper() for item in raw_types.split(",") if item.strip())
        module = request.query_params.get("module", "").strip().upper() or None
        try:
            limit = min(max(int(request.query_params.get("limit", 20)), 1), 50)
        except ValueError:
            raise CodedValidationError("Limit must be a whole number.", api_code="search_query_invalid")
        from datetime import timedelta

        from django.utils import timezone

        from apps.institutions.models import SearchEntry

        window = {"7d": 7, "30d": 30, "365d": 365}.get(request.query_params.get("since", ""))
        full = request.query_params.get("full") == "1"
        results = universal_search(
            institution=request.institution,
            permission_codes=request.membership.role.permissions.values_list("code", flat=True),
            query=query,
            result_types=result_types,
            module=module,
            limit=200 if full else limit,
            per_provider=25 if full else None,
            scope=lambda queryset, employee_field, broad=None: scope_to_employees(queryset, request, employee_field, broad=broad),
            since=timezone.now() - timedelta(days=window) if window else None,
            department=request.query_params.get("department") or None,
            location=request.query_params.get("location") or None,
            sort=request.query_params.get("sort", "relevance"),
        )
        counts = {}
        for row in results:
            counts[row["group"]] = counts.get(row["group"], 0) + 1
        if full:
            # Remember the query as a recent search (latest ten per user).
            entry = SearchEntry.objects.filter(institution=request.institution, user=request.user, kind=SearchEntry.Kind.RECENT, query__iexact=query).first()
            if entry:
                entry.save(update_fields=("updated_at",))
            else:
                SearchEntry.objects.create(institution=request.institution, user=request.user, kind=SearchEntry.Kind.RECENT, query=query[:200])
            stale = SearchEntry.objects.filter(institution=request.institution, user=request.user, kind=SearchEntry.Kind.RECENT).order_by("-updated_at").values_list("id", flat=True)[10:]
            SearchEntry.objects.filter(id__in=list(stale)).delete()
        for row in results:
            row.pop("department_id", None)
            row.pop("location_id", None)
        return Response({"query": query, "results": results if full else results[:limit], "count": len(results), "groups": counts})


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
class SearchEntriesView(APIView):
    """Recent and saved searches for the signed-in user."""

    permission_classes = [TenantContextPermission, TenantRBACPermission]

    def get_required_permission(self):
        return "search.use"

    def _rows(self, request):
        from apps.institutions.models import SearchEntry

        rows = SearchEntry.objects.filter(institution=request.institution, user=request.user)
        return {
            "recent": [{"id": str(row.id), "query": row.query, "updated_at": row.updated_at} for row in rows.filter(kind=SearchEntry.Kind.RECENT)[:10]],
            "saved": [{"id": str(row.id), "query": row.query, "name": row.name or row.query, "filters": row.filters} for row in rows.filter(kind=SearchEntry.Kind.SAVED)],
        }

    def get(self, request):
        return Response(self._rows(request))

    def post(self, request):
        from apps.institutions.models import SearchEntry
        from common.exceptions import CodedValidationError

        query = str(request.data.get("query", "")).strip()
        if len(query) < 2:
            raise CodedValidationError("Search query must contain at least two characters.", api_code="search_query_invalid")
        filters = request.data.get("filters") if isinstance(request.data.get("filters"), dict) else {}
        SearchEntry.objects.create(institution=request.institution, user=request.user, kind=SearchEntry.Kind.SAVED, query=query[:200],
                                   name=str(request.data.get("name", ""))[:120], filters=filters)
        return Response(self._rows(request), status=201)

    def delete(self, request):
        from apps.institutions.models import SearchEntry

        entries = SearchEntry.objects.filter(institution=request.institution, user=request.user)
        if request.query_params.get("id"):
            entries.filter(pk=request.query_params["id"]).delete()
        elif request.query_params.get("kind") == "RECENT":
            entries.filter(kind=SearchEntry.Kind.RECENT).delete()
        return Response(self._rows(request))
