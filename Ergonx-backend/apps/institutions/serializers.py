from rest_framework import serializers

from apps.institutions.models import (
    Institution,
    InstitutionMembership,
    InstitutionModule,
    Role,
    Permission,
    UserPreference,
    InstitutionOnboarding,
    InstitutionOnboardingStep,
    InstitutionSetting,
    InstitutionInvitation,
)
from apps.institutions.catalogues import locale_catalogues
from common.product import offered_permission_codes


class RoleSummarySerializer(serializers.ModelSerializer):
    permissions = serializers.SlugRelatedField(many=True, read_only=True, slug_field="code")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Hide permissions of modules this edition does not offer (common.product).
        data["permissions"] = offered_permission_codes(data["permissions"], Permission)
        return data

    class Meta:
        model = Role
        fields = ("id", "code", "name", "is_system_role", "is_custom", "is_active", "permissions")


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ("code", "name", "module_code", "classification", "description")
        read_only_fields = fields


class RoleSerializer(RoleSummarySerializer):
    class Meta(RoleSummarySerializer.Meta):
        model = Role
        fields = (
            "id", "code", "name", "description", "is_system_role", "is_custom",
            "is_active", "data_scope", "is_read_only", "permissions", "created_at", "updated_at",
        )
        read_only_fields = ("id", "code", "is_system_role", "is_custom", "created_at", "updated_at")


class CustomRoleCreateSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=50)
    name = serializers.CharField(max_length=150)
    description = serializers.CharField(required=False, allow_blank=True)
    permission_codes = serializers.ListField(
        child=serializers.CharField(max_length=100), required=False, default=list
    )
    data_scope = serializers.ChoiceField(choices=Role.DataScope.choices, required=False, default=Role.DataScope.INSTITUTION)
    is_read_only = serializers.BooleanField(required=False, default=False)


class CloneRoleSerializer(CustomRoleCreateSerializer):
    source_role_id = serializers.UUIDField()


class CustomRoleUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    permission_codes = serializers.ListField(child=serializers.CharField(max_length=100), required=False)
    is_active = serializers.BooleanField(required=False)
    data_scope = serializers.ChoiceField(choices=Role.DataScope.choices, required=False)
    is_read_only = serializers.BooleanField(required=False)


class UserPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserPreference
        fields = ("id", "preference_key", "value_json", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class InstitutionOnboardingStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstitutionOnboardingStep
        fields = ("code", "sequence", "status", "required_module", "blocker_code", "blocker_message", "completed_at", "is_admin_skipped")
        read_only_fields = fields


class InstitutionOnboardingSerializer(serializers.ModelSerializer):
    steps = InstitutionOnboardingStepSerializer(source="institution.onboarding_steps", many=True, read_only=True)

    class Meta:
        model = InstitutionOnboarding
        fields = ("status", "current_step", "completion_percentage", "started_at", "completed_at", "validation_summary", "steps")
        read_only_fields = fields


class InstitutionSerializer(serializers.ModelSerializer):
    country = serializers.CharField(source="country_code", read_only=True)
    currency = serializers.CharField(source="default_currency", read_only=True)

    class Meta:
        model = Institution
        fields = (
            "id",
            "name",
            "code",
            "email",
            "phone",
            "address",
            "country_code",
            "default_currency",
            "country",
            "currency",
            "timezone",
            "institution_type",
            "executive_title",
            "logo",
            "is_active",
        )


class InstitutionProfileUpdateSerializer(serializers.ModelSerializer):
    """The editable profile fields needed by institution onboarding."""

    class Meta:
        model = Institution
        fields = (
            "name",
            "email",
            "phone",
            "address",
            "country_code",
            "default_currency",
            "timezone",
            "institution_type",
            "executive_title",
            "logo",
        )

    def validate(self, attrs):
        """Accept only catalogue values while retaining a legacy stored value unchanged."""
        catalogues = locale_catalogues()
        valid_values = {
            "country_code": {item["code"] for item in catalogues["countries"]},
            "default_currency": {item["code"] for item in catalogues["currencies"]},
            "timezone": {item["id"] for item in catalogues["timezones"]},
        }
        errors = {}
        for field, allowed in valid_values.items():
            value = attrs.get(field)
            if value is None:
                continue
            if field != "timezone":
                value = value.upper()
                attrs[field] = value
            existing_value = getattr(self.instance, field, None)
            if value not in allowed and value != existing_value:
                errors[field] = "Choose a value from the supported international catalogue."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


class InstitutionModuleSerializer(serializers.ModelSerializer):
    depends_on = serializers.SerializerMethodField()
    required_by = serializers.SerializerMethodField()
    can_disable = serializers.SerializerMethodField()

    class Meta:
        model = InstitutionModule
        fields = ("id", "module_code", "is_enabled", "configuration_status", "depends_on", "required_by", "can_disable")
        read_only_fields = ("id", "module_code", "configuration_status")

    def get_depends_on(self, obj) -> list[str]:
        from apps.institutions.services import MODULE_DEPENDENCIES

        return list(MODULE_DEPENDENCIES.get(obj.module_code, ()))

    def get_required_by(self, obj) -> list[str]:
        from apps.institutions.services import MODULE_DEPENDENCIES

        return sorted(code for code, needs in MODULE_DEPENDENCIES.items() if obj.module_code in needs)

    def get_can_disable(self, obj) -> bool:
        from apps.institutions.services import ALWAYS_ENABLED_MODULES

        return obj.module_code not in ALWAYS_ENABLED_MODULES


class InstitutionSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstitutionSetting
        fields = ("id", "key", "value", "is_sensitive", "updated_at")
        read_only_fields = ("id", "is_sensitive", "updated_at")


class MembershipUserSerializer(serializers.Serializer):
    """Safe user identity shown to institution access administrators."""

    id = serializers.UUIDField(read_only=True)
    email = serializers.EmailField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)


class MembershipSerializer(serializers.ModelSerializer):
    institution = InstitutionSerializer(read_only=True)
    role = RoleSummarySerializer(read_only=True)
    user = MembershipUserSerializer(read_only=True)

    class Meta:
        model = InstitutionMembership
        fields = (
            "id",
            "institution",
            "user",
            "role",
            "status",
            "is_primary",
            "joined_at",
            "ended_at",
        )


class MembershipUpdateSerializer(serializers.Serializer):
    role_id = serializers.UUIDField(required=False)
    status = serializers.ChoiceField(choices=InstitutionMembership.Status.choices, required=False)
    is_primary = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide at least one membership field to update.")
        return attrs


class MembershipInviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role_id = serializers.UUIDField()
    is_primary = serializers.BooleanField(required=False, default=False)


class InvitationCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role_id = serializers.UUIDField()
    expires_in_hours = serializers.IntegerField(required=False, default=168, min_value=1, max_value=720)


class InstitutionInvitationSerializer(serializers.ModelSerializer):
    role = RoleSummarySerializer(read_only=True)
    invited_by_email = serializers.EmailField(source="invited_by.email", read_only=True)

    class Meta:
        model = InstitutionInvitation
        fields = ("id", "email", "role", "status", "expires_at", "accepted_at", "invited_by_email", "created_at", "updated_at")
        read_only_fields = fields


class CurrentInstitutionSerializer(serializers.Serializer):
    institution = InstitutionSerializer()
    membership = MembershipSerializer()
    active_capabilities = serializers.ListField(child=serializers.CharField())


class LocaleCataloguesSerializer(serializers.Serializer):
    countries = serializers.ListField(child=serializers.DictField(), read_only=True)
    currencies = serializers.ListField(child=serializers.DictField(), read_only=True)
    timezones = serializers.ListField(child=serializers.DictField(), read_only=True)
