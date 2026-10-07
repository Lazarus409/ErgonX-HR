from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.services import field_changes, record_audit_event, snapshot
from apps.employees.models import Employee
from apps.training.models import TrainingCourse, TrainingEnrollment
from apps.training.serializers import (
    CancelEnrollmentSerializer,
    CompleteEnrollmentSerializer,
    EnrollSerializer,
    TrainingCourseSerializer,
    TrainingEnrollmentSerializer,
    resolve_document,
    resolve_employees,
)
from apps.training.services import cancel_enrollment, complete_enrollment, current_certifications, enroll_employees, start_enrollment, training_overview
from common.permissions import TenantContextPermission, TenantRBACPermission
from common.scoping import scope_to_employees
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet

COURSE_FIELDS = ("code", "title", "description", "category", "delivery_mode", "provider", "duration_hours", "certificate_validity_months", "is_mandatory", "is_active")
READ_ACTIONS = ("list", "retrieve", "overview", "certifications")


class TrainingCourseViewSet(TenantModelViewSet):
    model = TrainingCourse
    serializer_class = TrainingCourseSerializer
    http_method_names = ("get", "post", "patch", "delete", "head", "options")
    filterset_fields = ("category", "delivery_mode", "is_active", "is_mandatory")
    search_fields = ("code", "title", "provider")
    ordering_fields = ("title", "code", "created_at")
    ordering = ("title",)

    def get_required_permission(self):
        return "training.view" if self.action in READ_ACTIONS else "training.manage"

    def get_queryset(self):
        return super().get_queryset().annotate(enrolled=Count("enrollments", filter=Q(enrollments__status__in=TrainingEnrollment.OPEN_STATUSES)))

    def perform_create(self, serializer):
        course = serializer.save(institution=self.request.institution)
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=course, action="training.course.created", metadata={"title": course.title})

    def perform_update(self, serializer):
        before = snapshot(serializer.instance, COURSE_FIELDS)
        course = serializer.save()
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=course, action="training.course.updated", metadata={"changes": field_changes(before, snapshot(course, COURSE_FIELDS))})

    def perform_destroy(self, instance):
        super().perform_destroy(instance)  # Deactivates: enrolment history is kept.
        record_audit_event(actor=self.request.user, institution=self.request.institution, entity=instance, action="training.course.deactivated", metadata={"title": instance.title})


class TrainingEnrollmentViewSet(TenantModelViewSet):
    model = TrainingEnrollment
    serializer_class = TrainingEnrollmentSerializer
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("status", "course", "employee")
    search_fields = ("employee__first_name", "employee__last_name", "employee__employee_number", "course__title")
    ordering_fields = ("planned_start", "completed_on", "certificate_expires_on", "created_at")
    ordering = ("-planned_start", "-created_at")

    def get_required_permission(self):
        return "training.view" if self.action in READ_ACTIONS else "training.manage"

    def get_queryset(self):
        return scope_to_employees(super().get_queryset().select_related("course", "employee"), self.request)

    def _scoped_employees(self):
        return scope_to_employees(Employee.objects.for_institution(self.request.institution), self.request, "")

    @extend_schema(request=EnrollSerializer, responses={201: OpenApiTypes.OBJECT})
    def create(self, request, *args, **kwargs):
        payload = EnrollSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        values = payload.validated_data
        course = get_object_or_404(TrainingCourse.objects.for_institution(request.institution), pk=values["course"])
        employees = resolve_employees(request.institution, values["employees"])
        visible = set(self._scoped_employees().filter(id__in=[item.id for item in employees]).values_list("id", flat=True))
        if len(visible) != len(employees):
            raise NotFound("One or more employees were not found.")
        created, skipped = call_validated_service(
            enroll_employees, course=course, employees=employees, actor=request.user,
            planned_start=values.get("planned_start"), planned_end=values.get("planned_end"), notes=values.get("notes", ""),
        )
        return Response({
            "created": TrainingEnrollmentSerializer(created, many=True).data,
            "skipped": [{"employee_id": str(item.id), "employee": item.full_name} for item in skipped],
        }, status=status.HTTP_201_CREATED)

    @extend_schema(request=None, responses=TrainingEnrollmentSerializer)
    @action(detail=True, methods=("post",))
    def start(self, request, pk=None):
        enrollment = call_validated_service(start_enrollment, enrollment=self.get_object(), actor=request.user)
        return Response(TrainingEnrollmentSerializer(enrollment).data)

    @extend_schema(request=CompleteEnrollmentSerializer, responses=TrainingEnrollmentSerializer)
    @action(detail=True, methods=("post",))
    def complete(self, request, pk=None):
        payload = CompleteEnrollmentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        values = dict(payload.validated_data)
        values["certificate_document"] = resolve_document(request.institution, values.get("certificate_document"))
        enrollment = call_validated_service(complete_enrollment, enrollment=self.get_object(), actor=request.user, **values)
        return Response(TrainingEnrollmentSerializer(enrollment).data)

    @extend_schema(request=CancelEnrollmentSerializer, responses=TrainingEnrollmentSerializer)
    @action(detail=True, methods=("post",))
    def cancel(self, request, pk=None):
        payload = CancelEnrollmentSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        enrollment = call_validated_service(cancel_enrollment, enrollment=self.get_object(), actor=request.user, reason=payload.validated_data["reason"])
        return Response(TrainingEnrollmentSerializer(enrollment).data)

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    @action(detail=False, methods=("get",))
    def overview(self, request):
        return Response(training_overview(request.institution, self.get_queryset()))

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    @action(detail=False, methods=("get",))
    def certifications(self, request):
        rows = current_certifications(self.get_queryset())
        wanted = request.query_params.get("status")
        return Response([row for row in rows if not wanted or row["status"] == wanted])


class MyTrainingView(APIView):
    """The signed-in employee's own training and certificates."""

    permission_classes = (TenantContextPermission, TenantRBACPermission)
    required_module = "CORE_HR"

    def get_required_permission(self):
        return "home.view"

    @extend_schema(responses={200: OpenApiTypes.OBJECT})
    def get(self, request):
        employee = get_object_or_404(Employee.objects.for_institution(request.institution), user=request.user)
        enrollments = TrainingEnrollment.objects.for_institution(request.institution).filter(employee=employee).select_related("course")
        return Response({
            "enrollments": TrainingEnrollmentSerializer(enrollments.order_by("-planned_start", "-created_at"), many=True).data,
            "certifications": current_certifications(enrollments),
        })
