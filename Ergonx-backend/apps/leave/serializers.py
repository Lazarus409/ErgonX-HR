from rest_framework import serializers

from apps.employees.models import Employee, Employment
from apps.leave.models import (
    LeaveRequestComment,
    LeaveApproval,
    LeaveBalance,
    LeavePolicy,
    LeaveRequest,
    LeaveType,
)
from apps.leave.services import configure_policy, create_leave_request, update_leave_request
from apps.organization.models import Department, Grade, Location
from common.serializers import ValidatedModelSerializer, call_validated_service


class LeaveTypeSerializer(ValidatedModelSerializer):
    class Meta:
        model = LeaveType
        fields = (
            "id",
            "name",
            "code",
            "description",
            "is_paid",
            "requires_approval",
            "requires_attachment",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class LeavePolicySerializer(ValidatedModelSerializer):
    eligible_department_ids = serializers.PrimaryKeyRelatedField(
        source="eligible_departments", queryset=Department.objects.none(), many=True, required=False
    )
    eligible_grade_ids = serializers.PrimaryKeyRelatedField(
        source="eligible_grades", queryset=Grade.objects.none(), many=True, required=False
    )
    eligible_location_ids = serializers.PrimaryKeyRelatedField(
        source="eligible_locations", queryset=Location.objects.none(), many=True, required=False
    )
    eligible_employment_types = serializers.ListField(
        child=serializers.ChoiceField(choices=Employment.EmploymentType.choices),
        required=False,
    )
    eligible_genders = serializers.ListField(
        child=serializers.ChoiceField(choices=Employee.Gender.choices), required=False
    )

    class Meta:
        model = LeavePolicy
        fields = (
            "id",
            "leave_type",
            "name",
            "annual_entitlement",
            "accrual_method",
            "accrual_rate",
            "max_carry_forward",
            "min_service_days",
            "max_consecutive_days",
            "allow_negative_balance",
            "requires_document",
            "effective_from",
            "effective_to",
            "is_active",
            "eligible_department_ids",
            "eligible_grade_ids",
            "eligible_location_ids",
            "eligible_employment_types",
            "eligible_genders",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["leave_type"].queryset = LeaveType.objects.for_institution(institution)
            self.fields["eligible_department_ids"].queryset = Department.objects.for_institution(
                institution
            )
            self.fields["eligible_grade_ids"].queryset = Grade.objects.for_institution(
                institution
            )
            self.fields["eligible_location_ids"].queryset = Location.objects.for_institution(
                institution
            )

    @staticmethod
    def _eligibility(validated_data):
        return {
            key: validated_data.pop(key)
            for key in (
                "eligible_departments",
                "eligible_grades",
                "eligible_locations",
                "eligible_employment_types",
                "eligible_genders",
            )
            if key in validated_data
        }

    def create(self, validated_data):
        eligibility = self._eligibility(validated_data)
        return call_validated_service(
            configure_policy, eligibility=eligibility, **validated_data
        )

    def update(self, instance, validated_data):
        eligibility = self._eligibility(validated_data)
        return call_validated_service(
            configure_policy,
            policy=instance,
            eligibility=eligibility,
            institution=instance.institution,
            **validated_data,
        )


class LeaveBalanceSerializer(ValidatedModelSerializer):
    available = serializers.DecimalField(max_digits=8, decimal_places=2, read_only=True)

    class Meta:
        model = LeaveBalance
        fields = (
            "id",
            "employee",
            "leave_type",
            "year",
            "opening_balance",
            "accrued",
            "used",
            "adjusted",
            "available",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "used", "available", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["employee"].queryset = Employee.objects.for_institution(institution)
            self.fields["leave_type"].queryset = LeaveType.objects.for_institution(institution)


class LeaveRequestSerializer(ValidatedModelSerializer):
    reference = serializers.CharField(read_only=True)

    class Meta:
        model = LeaveRequest
        fields = (
            "id",
            "reference",
            "employee",
            "leave_type",
            "start_date",
            "end_date",
            "requested_days",
            "reason",
            "attachment",
            "status",
            "submitted_at",
            "cancelled_at",
            "changes_requested_at",
            "changes_requested_note",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "status",
            "submitted_at",
            "cancelled_at",
            "changes_requested_at",
            "changes_requested_note",
            "created_at",
            "updated_at",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            from apps.documents.models import Document

            self.fields["employee"].queryset = Employee.objects.for_institution(institution)
            self.fields["leave_type"].queryset = LeaveType.objects.for_institution(institution)
            self.fields["attachment"].queryset = Document.objects.for_institution(institution)

    def validate_attachment(self, attachment):
        """Only a leave supporting document the requester uploaded may be attached."""
        if attachment is None:
            return attachment
        request = self.context["request"]
        if attachment.category != "LEAVE_SUPPORTING":
            raise serializers.ValidationError("Attach a leave supporting document.")
        on_behalf = request.membership.role.permissions.filter(code="leave.configure").exists()
        if attachment.uploaded_by_id != request.user.id and not on_behalf:
            raise serializers.ValidationError("You can only attach documents you uploaded.")
        return attachment

    def create(self, validated_data):
        return call_validated_service(
            create_leave_request,
            actor=self.context["request"].user,
            **validated_data,
        )

    def update(self, instance, validated_data):
        validated_data.pop("employee", None)
        return call_validated_service(
            update_leave_request,
            leave_request=instance,
            actor=self.context["request"].user,
            **validated_data,
        )


class LeaveApprovalSerializer(serializers.ModelSerializer):
    approver_name = serializers.SerializerMethodField()

    def get_approver_name(self, obj):
        return obj.approver.get_full_name() or obj.approver.email

    class Meta:
        model = LeaveApproval
        fields = (
            "id",
            "leave_request",
            "approver",
            "approver_name",
            "delegated_from",
            "sequence",
            "status",
            "comment",
            "acted_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class ApprovalCommentSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)


class AccrualSerializer(serializers.Serializer):
    amount = serializers.DecimalField(
        max_digits=8, decimal_places=4, required=False, min_value=0
    )
    as_of_date = serializers.DateField(required=False)


class CarryForwardSerializer(serializers.Serializer):
    target_year = serializers.IntegerField(required=False, min_value=1, max_value=9999)


class LeaveRequestCommentSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    def get_author_name(self, obj):
        return obj.author.get_full_name() or obj.author.email

    class Meta:
        model = LeaveRequestComment
        fields = ("id", "leave_request", "author", "author_name", "body", "created_at")
        read_only_fields = fields


class LeaveCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=2000, trim_whitespace=True)


class LeaveDelegateSerializer(serializers.Serializer):
    delegate = serializers.UUIDField()
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)
