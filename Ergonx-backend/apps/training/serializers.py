from rest_framework import serializers

from apps.documents.models import Document
from apps.employees.models import Employee
from apps.training.models import TrainingCourse, TrainingEnrollment
from common.serializers import ValidatedModelSerializer


class TrainingCourseSerializer(ValidatedModelSerializer):
    enrolled = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = TrainingCourse
        fields = (
            "id", "code", "title", "description", "category", "delivery_mode", "provider", "duration_hours",
            "certificate_validity_months", "is_mandatory", "is_active", "enrolled", "created_at", "updated_at",
        )
        read_only_fields = ("id", "is_active", "enrolled", "created_at", "updated_at")
        extra_kwargs = {"code": {"required": False, "allow_blank": True}}


class TrainingEnrollmentSerializer(serializers.ModelSerializer):
    course_title = serializers.CharField(source="course.title", read_only=True)
    course_code = serializers.CharField(source="course.code", read_only=True)
    course_category = serializers.CharField(source="course.category", read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_number = serializers.CharField(source="employee.employee_number", read_only=True)
    certificate_status = serializers.SerializerMethodField()

    class Meta:
        model = TrainingEnrollment
        fields = (
            "id", "course", "course_title", "course_code", "course_category", "employee", "employee_name", "employee_number",
            "status", "planned_start", "planned_end", "completed_on", "score", "certificate_number", "certificate_expires_on",
            "certificate_status", "certificate_document", "notes", "created_at", "updated_at",
        )
        read_only_fields = fields

    def get_certificate_status(self, obj) -> str | None:
        from django.utils import timezone

        from apps.training.services import certificate_status

        return certificate_status(obj.certificate_expires_on, timezone.localdate()) if obj.status == TrainingEnrollment.Status.COMPLETED else None


class EnrollSerializer(serializers.Serializer):
    course = serializers.UUIDField()
    employees = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=500)
    planned_start = serializers.DateField(required=False, allow_null=True)
    planned_end = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class CompleteEnrollmentSerializer(serializers.Serializer):
    passed = serializers.BooleanField(default=True)
    completed_on = serializers.DateField(required=False)
    score = serializers.DecimalField(max_digits=5, decimal_places=1, required=False, allow_null=True)
    certificate_number = serializers.CharField(required=False, allow_blank=True, default="")
    certificate_expires_on = serializers.DateField(required=False, allow_null=True)
    certificate_document = serializers.UUIDField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class CancelEnrollmentSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


def resolve_employees(institution, ids):
    employees = list(Employee.objects.for_institution(institution).filter(id__in=ids))
    if len(employees) != len(set(ids)):
        raise serializers.ValidationError({"employees": "One or more employees were not found."})
    return employees


def resolve_document(institution, document_id):
    if not document_id:
        return None
    document = Document.objects.for_institution(institution).filter(id=document_id, is_active=True).first()
    if document is None:
        raise serializers.ValidationError({"certificate_document": "Document not found."})
    return document
