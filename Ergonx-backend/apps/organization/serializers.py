from rest_framework import serializers

from apps.employees.models import Employee
from apps.organization.models import Department, Grade, Location, Position
from apps.organization.services import create_position, update_position
from common.serializers import ValidatedModelSerializer, call_validated_service


class TenantValidationMixin:
    def scope_relation(self, field_name, model):
        request = self.context.get("request")
        institution = getattr(request, "institution", None)
        if institution and field_name in self.fields:
            self.fields[field_name].queryset = model.objects.for_institution(institution)

    def validate_tenant_relation(self, field_name, value):
        institution = self.context["request"].institution
        if value and value.institution_id != institution.id:
            raise serializers.ValidationError(
                {field_name: "Referenced record must belong to the current institution."}
            )


class DepartmentSerializer(TenantValidationMixin, ValidatedModelSerializer):
    head_name = serializers.CharField(source="head.full_name", read_only=True, default=None)
    parent_name = serializers.CharField(source="parent.name", read_only=True, default=None)

    class Meta:
        model = Department
        fields = (
            "id",
            "name",
            "code",
            "description",
            "parent",
            "parent_name",
            "head",
            "head_name",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "head_name", "parent_name", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.scope_relation("parent", Department)
        self.scope_relation("head", Employee)

    def validate(self, attrs):
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        self.validate_tenant_relation("parent", parent)
        head = attrs.get("head", getattr(self.instance, "head", None))
        self.validate_tenant_relation("head", head)
        if "head" in attrs and head and head.status != Employee.Status.ACTIVE:
            raise serializers.ValidationError({"head": "Department head must be an active employee."})
        if self.instance and parent and parent.id == self.instance.id:
            raise serializers.ValidationError({"parent": "A department cannot be its own parent."})
        return attrs


class PositionSerializer(TenantValidationMixin, ValidatedModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True, default=None)

    class Meta:
        model = Position
        fields = (
            "id",
            "department",
            "department_name",
            "title",
            "code",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "department_name", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.scope_relation("department", Department)

    def validate(self, attrs):
        department = attrs.get("department", getattr(self.instance, "department", None))
        self.validate_tenant_relation("department", department)
        return attrs

    def create(self, validated_data):
        return call_validated_service(create_position, **validated_data)

    def update(self, instance, validated_data):
        return call_validated_service(
            update_position, position=instance, **validated_data
        )


class GradeSerializer(ValidatedModelSerializer):
    class Meta:
        model = Grade
        fields = (
            "id",
            "name",
            "code",
            "level",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class LocationSerializer(ValidatedModelSerializer):
    class Meta:
        model = Location
        fields = (
            "id",
            "name",
            "code",
            "address",
            "city",
            "country",
            "timezone",
            "is_remote",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")
