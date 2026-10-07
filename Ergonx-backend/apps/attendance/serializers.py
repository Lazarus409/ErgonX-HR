from rest_framework import serializers

from apps.attendance.models import AttendanceAdjustment, AttendanceRecord, OvertimeRecord
from apps.attendance.services import request_adjustment
from apps.employees.models import Employee
from common.serializers import ValidatedModelSerializer, call_validated_service


class AttendanceRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = (
            "id",
            "employee",
            "schedule_assignment",
            "attendance_date",
            "check_in",
            "check_out",
            "worked_minutes",
            "late_minutes",
            "early_departure_minutes",
            "overtime_minutes",
            "status",
            "source",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class ClockInSerializer(serializers.Serializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.none())
    at = serializers.DateTimeField(required=False)
    source = serializers.ChoiceField(
        choices=AttendanceRecord.Source.choices,
        default=AttendanceRecord.Source.WEB,
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["employee"].queryset = Employee.objects.for_institution(institution)


class ClockOutSerializer(serializers.Serializer):
    at = serializers.DateTimeField(required=False)


class AttendanceClassificationSerializer(serializers.Serializer):
    employee = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.none())
    attendance_date = serializers.DateField()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["employee"].queryset = Employee.objects.for_institution(institution)


class AttendanceAdjustmentSerializer(ValidatedModelSerializer):
    reference = serializers.CharField(read_only=True)
    employee = serializers.UUIDField(source="attendance_record.employee_id", read_only=True)
    employee_name = serializers.CharField(source="attendance_record.employee.full_name", read_only=True)
    attendance_date = serializers.DateField(source="attendance_record.attendance_date", read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    assigned_to_name = serializers.SerializerMethodField()

    @staticmethod
    def _name(user):
        return (user.get_full_name() or user.email) if user else None

    def get_requested_by_name(self, obj):
        return self._name(obj.requested_by)

    def get_approved_by_name(self, obj):
        return self._name(obj.approved_by)

    def get_assigned_to_name(self, obj):
        return self._name(obj.assigned_to)

    class Meta:
        model = AttendanceAdjustment
        fields = (
            "id",
            "reference",
            "attendance_record",
            "employee",
            "employee_name",
            "attendance_date",
            "requested_by",
            "requested_by_name",
            "adjustment_type",
            "reason",
            "old_values",
            "proposed_values",
            "evidence",
            "status",
            "approved_by",
            "approved_by_name",
            "assigned_to",
            "assigned_to_name",
            "decision_note",
            "acted_at",
            "changes_requested_at",
            "resubmitted_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "requested_by",
            "old_values",
            "status",
            "approved_by",
            "assigned_to",
            "decision_note",
            "acted_at",
            "changes_requested_at",
            "resubmitted_at",
            "created_at",
            "updated_at",
        )
        extra_kwargs = {"adjustment_type": {"required": False}}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            from apps.documents.models import Document

            self.fields["attendance_record"].queryset = AttendanceRecord.objects.for_institution(
                institution
            )
            self.fields["evidence"].queryset = Document.objects.for_institution(institution)

    def create(self, validated_data):
        return call_validated_service(
            request_adjustment,
            actor=self.context["request"].user,
            **validated_data,
        )


class AdjustmentDecisionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class AdjustmentResubmitSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False)
    proposed_values = serializers.JSONField(required=False)
    evidence = serializers.UUIDField(required=False, allow_null=True)
    adjustment_type = serializers.ChoiceField(choices=AttendanceAdjustment.AdjustmentType.choices, required=False)


class AdjustmentDelegateSerializer(serializers.Serializer):
    delegate = serializers.UUIDField()
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class OvertimeRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = OvertimeRecord
        fields = (
            "id",
            "employee",
            "attendance_record",
            "calculated_minutes",
            "approved_minutes",
            "rate_multiplier",
            "status",
            "approved_by",
            "approved_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class OvertimeDecisionSerializer(serializers.Serializer):
    approved_minutes = serializers.IntegerField(required=False, min_value=0)
