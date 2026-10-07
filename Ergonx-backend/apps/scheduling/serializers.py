from rest_framework import serializers

from apps.employees.models import Employee
from apps.scheduling.models import (
    FlexibleWorkRule,
    RotationPattern,
    RotationStep,
    ScheduleAssignment,
    Shift,
    ShiftPattern,
    ShiftPatternDay,
    WorkSchedule,
)
from apps.scheduling.services import (
    change_current_schedule_assignment,
    create_schedule_assignment,
)
from common.serializers import ValidatedModelSerializer, call_validated_service


class TenantRelationSerializer(ValidatedModelSerializer):
    tenant_relations = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            for field_name, model in self.tenant_relations.items():
                if field_name in self.fields:
                    self.fields[field_name].queryset = model.objects.for_institution(institution)


class ShiftSerializer(TenantRelationSerializer):
    scheduled_minutes = serializers.IntegerField(read_only=True)

    class Meta:
        model = Shift
        fields = (
            "id",
            "name",
            "code",
            "start_time",
            "end_time",
            "crosses_midnight",
            "break_minutes",
            "grace_period_minutes",
            "scheduled_minutes",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "scheduled_minutes", "created_at", "updated_at")


class ShiftPatternSerializer(TenantRelationSerializer):
    class Meta:
        model = ShiftPattern
        fields = ("id", "name", "code", "cycle_length_days", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class ShiftPatternDaySerializer(TenantRelationSerializer):
    tenant_relations = {"shift_pattern": ShiftPattern, "shift": Shift}

    class Meta:
        model = ShiftPatternDay
        fields = ("id", "shift_pattern", "day_index", "shift", "is_off_day", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class RotationPatternSerializer(TenantRelationSerializer):
    class Meta:
        model = RotationPattern
        fields = ("id", "name", "code", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class RotationStepSerializer(TenantRelationSerializer):
    tenant_relations = {
        "rotation_pattern": RotationPattern,
        "shift_pattern": ShiftPattern,
        "shift": Shift,
    }

    class Meta:
        model = RotationStep
        fields = (
            "id",
            "rotation_pattern",
            "sequence",
            "shift_pattern",
            "shift",
            "duration_days",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class FlexibleWorkRuleSerializer(TenantRelationSerializer):
    class Meta:
        model = FlexibleWorkRule
        fields = (
            "id",
            "name",
            "earliest_start",
            "latest_start",
            "earliest_end",
            "latest_end",
            "required_minutes",
            "core_start",
            "core_end",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class WorkScheduleSerializer(TenantRelationSerializer):
    tenant_relations = {
        "fixed_shift": Shift,
        "shift_pattern": ShiftPattern,
        "rotation_pattern": RotationPattern,
        "flexible_rule": FlexibleWorkRule,
    }

    class Meta:
        model = WorkSchedule
        fields = (
            "id",
            "name",
            "code",
            "schedule_type",
            "effective_from",
            "effective_to",
            "timezone",
            "is_active",
            "fixed_shift",
            "shift_pattern",
            "rotation_pattern",
            "flexible_rule",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class ScheduleAssignmentSerializer(TenantRelationSerializer):
    tenant_relations = {"employee": Employee, "work_schedule": WorkSchedule}

    class Meta:
        model = ScheduleAssignment
        fields = (
            "id",
            "employee",
            "work_schedule",
            "effective_from",
            "effective_to",
            "is_current",
            "assigned_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "assigned_by", "created_at", "updated_at")

    def create(self, validated_data):
        service = (
            change_current_schedule_assignment
            if validated_data.get("is_current", True)
            else create_schedule_assignment
        )
        return call_validated_service(service, **validated_data)

