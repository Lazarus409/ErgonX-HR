from django.utils.dateparse import parse_date
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.audit.services import record_audit_event
from apps.compensation.models import (
    EmployeeCompensation,
    EmployeePayComponent,
    PayComponent,
    SalaryStructure,
    SalaryStructureComponent,
)
from apps.compensation.serializers import (
    EmployeeCompensationSerializer,
    EmployeePayComponentSerializer,
    OverrideEndSerializer,
    PayComponentSerializer,
    ResolvedCompensationSerializer,
    SalaryStructureComponentSerializer,
    SalaryStructureSerializer,
)
from apps.compensation.services import (
    deactivate_employee_pay_component,
    resolve_compensation,
)
from common.scoping import scope_to_employees
from common.serializers import call_validated_service
from common.viewsets import TenantModelViewSet


class CompensationConfigurationViewSet(TenantModelViewSet):
    required_module = "PAYROLL"

    def get_required_permission(self):
        return "compensation.configure"

    def perform_create(self, serializer):
        super().perform_create(serializer)
        record_audit_event(
            actor=self.request.user,
            institution=self.request.institution,
            entity=serializer.instance,
            action="compensation.configuration.created",
        )

    def perform_update(self, serializer):
        serializer.save()
        record_audit_event(
            actor=self.request.user,
            institution=self.request.institution,
            entity=serializer.instance,
            action="compensation.configuration.updated",
        )

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        record_audit_event(
            actor=self.request.user,
            institution=self.request.institution,
            entity=instance,
            action="compensation.configuration.deactivated",
        )


class PayComponentViewSet(CompensationConfigurationViewSet):
    model = PayComponent
    serializer_class = PayComponentSerializer
    filterset_fields = (
        "component_type",
        "calculation_type",
        "taxable",
        "pensionable",
        "recurring",
        "is_active",
    )
    search_fields = ("name", "code")
    ordering_fields = ("name", "code", "component_type", "created_at", "updated_at")


class SalaryStructureViewSet(CompensationConfigurationViewSet):
    model = SalaryStructure
    serializer_class = SalaryStructureSerializer
    filterset_fields = ("is_active",)
    search_fields = ("name", "code", "description")
    ordering_fields = ("name", "code", "created_at", "updated_at")


class SalaryStructureComponentViewSet(CompensationConfigurationViewSet):
    model = SalaryStructureComponent
    serializer_class = SalaryStructureComponentSerializer
    filterset_fields = ("salary_structure", "pay_component", "is_required")
    ordering_fields = ("sequence", "created_at", "updated_at")

    def get_queryset(self):
        return super().get_queryset().select_related(
            "salary_structure", "pay_component", "percentage_base_component"
        )


class EmployeeCompensationViewSet(TenantModelViewSet):
    model = EmployeeCompensation
    serializer_class = EmployeeCompensationSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("employee", "salary_structure", "currency", "is_current")
    ordering_fields = ("effective_from", "effective_to", "created_at", "updated_at")

    def get_required_permission(self):
        if self.action == "create":
            return "compensation.manage"
        return "compensation.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related("employee", "salary_structure")
        return scope_to_employees(queryset, self.request, allow_team=False)

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @extend_schema(responses=ResolvedCompensationSerializer)
    @action(detail=True, methods=("get",))
    def resolved(self, request, pk=None):
        as_of = request.query_params.get("as_of")
        if as_of:
            as_of = parse_date(as_of)
            if as_of is None:
                raise ValidationError({"as_of": "Use YYYY-MM-DD."})
        result = call_validated_service(
            resolve_compensation,
            compensation=self.get_object(),
            as_of_date=as_of,
        )
        return Response(ResolvedCompensationSerializer(result).data)


class EmployeePayComponentViewSet(TenantModelViewSet):
    model = EmployeePayComponent
    serializer_class = EmployeePayComponentSerializer
    required_module = "PAYROLL"
    http_method_names = ("get", "post", "head", "options")
    filterset_fields = ("employee_compensation", "pay_component", "is_active")
    ordering_fields = ("effective_from", "effective_to", "created_at", "updated_at")

    def get_required_permission(self):
        if self.action in {"create", "end"}:
            return "compensation.manage"
        return "compensation.view"

    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            "employee_compensation__employee", "pay_component"
        )
        return scope_to_employees(
            queryset, self.request, "employee_compensation__employee", allow_team=False
        )

    def perform_create(self, serializer):
        serializer.save(institution=self.request.institution, actor=self.request.user)

    @action(detail=True, methods=("post",))
    def end(self, request, pk=None):
        payload = OverrideEndSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        override = call_validated_service(
            deactivate_employee_pay_component,
            override=self.get_object(),
            actor=request.user,
            **payload.validated_data,
        )
        return Response(self.get_serializer(override).data)
