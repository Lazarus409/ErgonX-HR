from rest_framework.decorators import action
from django.utils.dateparse import parse_date
from rest_framework.exceptions import MethodNotAllowed, ValidationError
from rest_framework.response import Response

from apps.attendance.models import AttendanceAdjustment, AttendanceRecord, OvertimeRecord
from apps.attendance.serializers import (
    AdjustmentDecisionSerializer,
    AdjustmentDelegateSerializer,
    AdjustmentResubmitSerializer,
    AttendanceAdjustmentSerializer,
    AttendanceClassificationSerializer,
    AttendanceRecordSerializer,
    ClockInSerializer,
    ClockOutSerializer,
    OvertimeDecisionSerializer,
    OvertimeRecordSerializer,
)
from apps.attendance.services import (
    classify_attendance_date,
    clock_in,
    clock_out,
    adjustment_review_context,
    decide_adjustment,
    delegate_adjustment,
    resubmit_adjustment,
    return_adjustment,
    decide_overtime,
)
from common.scoping import ATTENDANCE_BROAD, scope_to_employees
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet


class EmployeeScopedQuerysetMixin:
    def scope_to_employee(self, queryset, employee_field="employee"):
        return scope_to_employees(queryset, self.request, employee_field, broad=ATTENDANCE_BROAD)


class AttendanceRecordViewSet(EmployeeScopedQuerysetMixin, TenantModelViewSet):
    model = AttendanceRecord
    serializer_class = AttendanceRecordSerializer
    required_module = "ATTENDANCE"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("employee", "attendance_date", "status", "source")
    search_fields = ("employee__employee_number", "employee__first_name", "employee__last_name")
    ordering_fields = ("attendance_date", "check_in", "check_out", "created_at")

    def get_required_permission(self):
        if self.action == "classify":
            return "attendance.manage"
        if self.action in {"clock_in", "clock_out"}:
            return "attendance.clock"
        return "attendance.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related("employee", "schedule_assignment")
        queryset = self.scope_to_employee(queryset)
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            parsed = parse_date(date_from)
            if parsed is None:
                raise ValidationError({"date_from": "Use YYYY-MM-DD."})
            queryset = queryset.filter(attendance_date__gte=parsed)
        if date_to:
            parsed = parse_date(date_to)
            if parsed is None:
                raise ValidationError({"date_to": "Use YYYY-MM-DD."})
            queryset = queryset.filter(attendance_date__lte=parsed)
        return queryset

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST", detail="Use the clock-in action.")

    @action(detail=False, methods=("get",))
    def calendar(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            return self.get_paginated_response(self.get_serializer(page, many=True).data)
        return Response(self.get_serializer(queryset, many=True).data)

    @action(detail=False, methods=("post",), url_path="clock-in")
    def clock_in(self, request):
        payload = ClockInSerializer(data=request.data, context=self.get_serializer_context())
        payload.is_valid(raise_exception=True)
        record = call_validated_service(
            clock_in, actor=request.user, **payload.validated_data
        )
        return Response(self.get_serializer(record).data)

    @action(detail=False, methods=("post",))
    def classify(self, request):
        payload = AttendanceClassificationSerializer(
            data=request.data, context=self.get_serializer_context()
        )
        payload.is_valid(raise_exception=True)
        record = call_validated_service(
            classify_attendance_date,
            actor=request.user,
            **payload.validated_data,
        )
        return Response(self.get_serializer(record).data)

    @action(detail=True, methods=("post",), url_path="clock-out")
    def clock_out(self, request, pk=None):
        payload = ClockOutSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        record = call_validated_service(
            clock_out,
            attendance_record=self.get_object(),
            actor=request.user,
            **payload.validated_data,
        )
        return Response(self.get_serializer(record).data)


class AttendanceAdjustmentViewSet(EmployeeScopedQuerysetMixin, TenantModelViewSet):
    model = AttendanceAdjustment
    serializer_class = AttendanceAdjustmentSerializer
    required_module = "ATTENDANCE"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("attendance_record", "requested_by", "status", "adjustment_type", "assigned_to")
    ordering_fields = ("created_at", "acted_at")

    def get_required_permission(self):
        if self.action in {"approve", "reject", "request_changes", "delegate", "delegates"}:
            return "attendance.approve"
        if self.action in {"create", "resubmit"}:
            return "attendance.adjust"
        return "attendance.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "attendance_record__employee", "requested_by", "approved_by", "assigned_to"
        )
        return self.scope_to_employee(queryset, "attendance_record__employee")

    def _decide(self, request, approve):
        payload = AdjustmentDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        adjustment = call_validated_service(
            decide_adjustment,
            adjustment=self.get_object(),
            actor=request.user,
            approve=approve,
            comment=payload.validated_data.get("comment", ""),
        )
        return Response(self.get_serializer(adjustment).data)

    @action(detail=True, methods=("post",))
    def approve(self, request, pk=None):
        return self._decide(request, True)

    @action(detail=True, methods=("post",))
    def reject(self, request, pk=None):
        return self._decide(request, False)

    @action(detail=True, methods=("post",), url_path="request-changes")
    def request_changes(self, request, pk=None):
        payload = AdjustmentDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        adjustment = call_validated_service(
            return_adjustment,
            adjustment=self.get_object(),
            actor=request.user,
            comment=payload.validated_data.get("comment", ""),
        )
        return Response(self.get_serializer(adjustment).data)

    @action(detail=True, methods=("post",))
    def resubmit(self, request, pk=None):
        payload = AdjustmentResubmitSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        values = dict(payload.validated_data)
        if "evidence" in values:
            from apps.documents.models import Document

            evidence_id = values["evidence"]
            values["evidence"] = (
                Document.objects.for_institution(request.institution).filter(pk=evidence_id).first()
                if evidence_id
                else None
            )
            if evidence_id and values["evidence"] is None:
                raise ValidationError({"evidence": "Document not found."})
        adjustment = call_validated_service(
            resubmit_adjustment, adjustment=self.get_object(), actor=request.user, **values
        )
        return Response(self.get_serializer(adjustment).data)

    @action(detail=True, methods=("post",))
    def delegate(self, request, pk=None):
        payload = AdjustmentDelegateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        from django.contrib.auth import get_user_model

        delegate_user = get_user_model().objects.filter(pk=payload.validated_data["delegate"]).first()
        adjustment = call_validated_service(
            delegate_adjustment,
            adjustment=self.get_object(),
            actor=request.user,
            delegate=delegate_user,
            comment=payload.validated_data.get("comment", ""),
        )
        return Response(self.get_serializer(adjustment).data)

    @action(detail=True, methods=("get",))
    def delegates(self, request, pk=None):
        from apps.institutions.models import InstitutionMembership

        adjustment = self.get_object()
        members = (
            InstitutionMembership.objects.filter(
                institution=request.institution,
                status=InstitutionMembership.Status.ACTIVE,
                role__permissions__code="attendance.approve",
            )
            .exclude(user_id=adjustment.attendance_record.employee.user_id)
            .exclude(user_id=request.user.id)
            .select_related("user", "role")
            .distinct()
            .order_by("user__first_name", "user__last_name")
        )
        return Response([
            {"id": str(item.user_id), "name": item.user.get_full_name() or item.user.email, "role": item.role.name}
            for item in members
        ])

    @action(detail=True, methods=("get",))
    def review(self, request, pk=None):
        return Response(adjustment_review_context(adjustment=self.get_object(), user=request.user))


class OvertimeRecordViewSet(EmployeeScopedQuerysetMixin, TenantModelViewSet):
    model = OvertimeRecord
    serializer_class = OvertimeRecordSerializer
    required_module = "ATTENDANCE"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("employee", "status")
    ordering_fields = ("created_at", "approved_at", "calculated_minutes")

    def get_required_permission(self):
        if self.action in {"approve", "reject"}:
            return "attendance.approve"
        return "attendance.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "employee", "attendance_record", "approved_by"
        )
        return self.scope_to_employee(queryset)

    def create(self, request, *args, **kwargs):
        raise MethodNotAllowed("POST", detail="Overtime is generated from attendance.")

    @action(detail=True, methods=("post",))
    def approve(self, request, pk=None):
        payload = OvertimeDecisionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        overtime = call_validated_service(
            decide_overtime,
            overtime_record=self.get_object(),
            actor=request.user,
            approve=True,
            **payload.validated_data,
        )
        return Response(self.get_serializer(overtime).data)

    @action(detail=True, methods=("post",))
    def reject(self, request, pk=None):
        overtime = call_validated_service(
            decide_overtime,
            overtime_record=self.get_object(),
            actor=request.user,
            approve=False,
        )
        return Response(self.get_serializer(overtime).data)
