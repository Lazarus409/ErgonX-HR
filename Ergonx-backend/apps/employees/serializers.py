from rest_framework import serializers

from apps.accounts.models import User
from apps.employees.models import EmergencyContact, Employee, EmployeeOffboarding, EmployeeOnboarding, Employment
from apps.employees.services import change_current_employment, create_employment, save_emergency_contact
from apps.organization.models import Department, Grade, Location, Position
from common.scoping import is_team_scoped
from common.serializers import ValidatedModelSerializer, call_validated_service


class EmployeeSerializer(ValidatedModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = Employee
        fields = (
            "id",
            "user",
            "employee_number",
            "first_name",
            "middle_name",
            "last_name",
            "full_name",
            "personal_email",
            "work_email",
            "phone",
            "preferred_name",
            "mobile_phone",
            "office_location",
            "linkedin_url",
            "avatar_key",
            "date_of_birth",
            "gender",
            "hire_date",
            "status",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "full_name", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        institution = getattr(request, "institution", None)
        if institution:
            self.fields["user"].queryset = User.objects.filter(
                memberships__institution=institution
            ).distinct()

    PERSONAL_FIELDS = ("personal_email", "date_of_birth", "mobile_phone")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        # Department heads see work details for their team, not personal data.
        if request and is_team_scoped(request) and instance.user_id != request.user.id:
            for field in self.PERSONAL_FIELDS:
                data.pop(field, None)
        return data

    def validate_user(self, user):
        institution = self.context["request"].institution
        if user and not user.memberships.filter(institution=institution).exists():
            raise serializers.ValidationError(
                "Linked user must have a membership in the current institution."
            )
        return user


class EmploymentSerializer(ValidatedModelSerializer):
    class Meta:
        model = Employment
        fields = (
            "id",
            "employee",
            "department",
            "position",
            "grade",
            "location",
            "reports_to",
            "employment_type",
            "staff_category",
            "start_date",
            "end_date",
            "status",
            "is_current",
            "working_pattern",
            "work_arrangement",
            "office_days",
            "time_zone",
            "team",
            "cost_centre",
            "probation_status",
            "probation_end_date",
            "notice_period_weeks",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")
        extra_kwargs = {
            "grade": {"required": True, "allow_null": False},
            "location": {"required": True, "allow_null": False},
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        institution = getattr(request, "institution", None)
        if not institution:
            return
        scoped_models = {
            "employee": Employee,
            "department": Department,
            "position": Position,
            "grade": Grade,
            "location": Location,
            "reports_to": Employment,
        }
        for field_name, model in scoped_models.items():
            self.fields[field_name].queryset = model.objects.for_institution(institution)

    def validate(self, attrs):
        institution = self.context["request"].institution
        fields = ("employee", "department", "position", "grade", "location", "reports_to")
        errors = {}
        for field in fields:
            value = attrs.get(field, getattr(self.instance, field, None))
            if value and value.institution_id != institution.id:
                errors[field] = "Referenced record must belong to the current institution."
        department = attrs.get("department", getattr(self.instance, "department", None))
        position = attrs.get("position", getattr(self.instance, "position", None))
        if department and position and position.department_id != department.id:
            errors["position"] = "Position must belong to the selected department."
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def create(self, validated_data):
        if validated_data.get("is_current", True):
            return call_validated_service(
                change_current_employment, **validated_data
            )
        return call_validated_service(create_employment, **validated_data)


class EmergencyContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyContact
        fields = (
            "id",
            "employee",
            "full_name",
            "relationship",
            "phone",
            "alternate_phone",
            "email",
            "address",
            "is_primary",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        institution = getattr(self.context.get("request"), "institution", None)
        if institution:
            self.fields["employee"].queryset = Employee.objects.for_institution(institution)

    def create(self, validated_data):
        request = self.context["request"]
        employee = validated_data.pop("employee")
        return call_validated_service(
            save_emergency_contact,
            institution=request.institution,
            employee=employee,
            **validated_data,
        )

    def update(self, instance, validated_data):
        request = self.context["request"]
        employee = validated_data.pop("employee", instance.employee)
        return call_validated_service(
            save_emergency_contact,
            institution=request.institution,
            employee=employee,
            instance=instance,
            **validated_data,
        )


class EmployeeOnboardingSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeOnboarding
        fields = ("id", "employee", "status", "started_at", "completed_at", "notes", "created_at", "updated_at")
        read_only_fields = fields


class EmployeeOffboardingSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmployeeOffboarding
        fields = ("id", "employee", "status", "initiated_at", "completed_at", "last_working_day", "reason", "notes", "created_at", "updated_at")
        read_only_fields = ("id", "employee", "status", "initiated_at", "completed_at", "created_at", "updated_at")


class EmployeeOffboardingStartSerializer(serializers.Serializer):
    last_working_day = serializers.DateField(required=False)
    reason = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class EmployeeRehireSerializer(serializers.Serializer):
    department_id = serializers.UUIDField()
    position_id = serializers.UUIDField()
    grade_id = serializers.UUIDField()
    location_id = serializers.UUIDField()
    employment_type = serializers.ChoiceField(choices=Employment.EmploymentType.choices)
    staff_category = serializers.ChoiceField(choices=Employment.StaffCategory.choices, required=False, default=Employment.StaffCategory.OTHER)
    start_date = serializers.DateField()


class EmployeeSelfServiceInvitationSerializer(serializers.Serializer):
    expires_in_hours = serializers.IntegerField(required=False, min_value=1, max_value=24 * 30, default=24 * 7)


class NewEmployeeSelfServiceInvitationSerializer(EmployeeSelfServiceInvitationSerializer):
    email = serializers.EmailField()


class SelfServiceProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = Employee
        fields = ("id", "employee_number", "first_name", "middle_name", "last_name", "full_name", "preferred_name", "personal_email", "work_email", "phone", "mobile_phone", "linkedin_url", "avatar_key", "date_of_birth", "gender", "hire_date", "status")
        read_only_fields = ("id", "employee_number", "first_name", "middle_name", "last_name", "full_name", "work_email", "hire_date", "status")
